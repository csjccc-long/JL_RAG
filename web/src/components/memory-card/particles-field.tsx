'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { BRAIN_LOGO_PATHS, BRAIN_LOGO_STROKE } from '../brain-logo';
import './particles-field.css';

type Dot = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hx: number;
  hy: number;
  alpha: number;
  /** 0..1 visibility, eased; the field thins out when the net takes over. */
  fade: number;
  fadeTarget: number;
  size: number;
  sizeTarget: number;
};

type Point = { x: number; y: number };

type Seat = Point & { layer: 0 | 1 | 2 };

/** The frame the dots gather into on hover: inputs, hidden, outputs. */
const SEAT_X = [0.16, 0.5, 0.84];
const SEAT_Y: number[][] = [
  [0.2, 0.4, 0.6, 0.8],
  [0.12, 0.31, 0.5, 0.69, 0.88],
  [0.34, 0.66],
];

const seatsOf = (width: number, height: number): Seat[] => {
  const top = height * 0.06;
  const tall = height * 0.74;
  const out: Seat[] = [];
  SEAT_Y.forEach((rows, layer) => {
    rows.forEach((ty) => {
      out.push({
        x: width * SEAT_X[layer],
        y: top + tall * ty,
        layer: layer as 0 | 1 | 2,
      });
    });
  });
  return out;
};

/**
 * A dot field that traces the memory glyph and fills the whole card. The dots
 * are drawn along the glyph's stroke, so the fissure, the folds and the space
 * around the stem stay empty.
 *
 * On hover the dots that already exist nearest each node of a small network
 * are kept — nothing is drawn anew — and drift onto those nodes while the rest
 * of the field falls away; then the wires grow out of both sides at once.
 */
export const ParticleField = ({ className }: { className?: string }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [net, setNet] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const host = canvas.parentElement;
    if (!host) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const probe = document.createElement('canvas').getContext('2d');
    let dots: Dot[] = [];
    let homes: Point[] = [];
    let seats: Seat[] = [];
    let width = 0;
    let height = 0;
    let colour = '#3fd8c0';
    let raf = 0;
    let alive = true;
    let inNet = false;
    let pointer: Point | null = null;

    const logoPath = () => {
      const size = Math.max(24, Math.min(width * 0.6, height * 0.82));
      const cx = width / 2;
      const cy = height * 0.44;
      const scale = size / 24;
      const path = new Path2D();
      const matrix = new DOMMatrix([scale, 0, 0, scale, cx - size / 2, cy - size / 2]);
      for (const d of BRAIN_LOGO_PATHS) path.addPath(new Path2D(d), matrix);
      return { path, size };
    };

    const layout = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      colour = window.getComputedStyle(canvas).color || colour;
    };

    const collect = (): Point[] => {
      const { path, size } = logoPath();
      if (!probe) return [];
      const stroke = (BRAIN_LOGO_STROKE * size * 0.78) / 24;
      probe.lineWidth = stroke;
      probe.lineCap = 'round';
      probe.lineJoin = 'round';
      const step = Math.max(3.6, size / 44);
      const points: Point[] = [];
      let row = 0;
      const pad = size * 0.62;
      for (let y = height * 0.44 - pad; y <= height * 0.44 + pad; y += step * 0.88) {
        const offset = row % 2 === 0 ? 0 : step / 2;
        for (let x = width / 2 - pad + offset; x <= width / 2 + pad; x += step) {
          if (probe.isPointInStroke(path, x, y)) points.push({ x, y });
        }
        row += 1;
      }
      return points;
    };

    const paint = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = colour;
      for (const dot of dots) {
        if (dot.fade < 0.01) continue;
        const speed = Math.hypot(dot.vx, dot.vy);
        const stretch = 1 + Math.min(1.5, speed * 0.09);
        const radius = dot.size;
        ctx.globalAlpha = dot.alpha * dot.fade;
        if (radius > 1.6) {
          ctx.globalAlpha = dot.alpha * dot.fade * 0.14;
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, radius * 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = dot.alpha * dot.fade;
        }
        if (stretch > 1.05) {
          ctx.save();
          ctx.translate(dot.x, dot.y);
          ctx.rotate(Math.atan2(dot.vy, dot.vx));
          ctx.beginPath();
          ctx.ellipse(0, 0, radius * stretch, radius, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const tick = () => {
      raf = 0;
      if (!alive) return;
      let moving = false;
      for (const dot of dots) {
        dot.vx += (dot.hx - dot.x) * 0.075;
        dot.vy += (dot.hy - dot.y) * 0.075;
        if (pointer && !inNet) {
          const dx = dot.x - pointer.x;
          const dy = dot.y - pointer.y;
          const dist = Math.hypot(dx, dy);
          const reach = Math.max(58, width * 0.28);
          if (dist < reach && dist > 0.001) {
            const force = ((1 - dist / reach) ** 2) * 7.5;
            dot.vx += (dx / dist) * force;
            dot.vy += (dy / dist) * force;
          }
        }
        dot.vx *= 0.86;
        dot.vy *= 0.86;
        dot.x += dot.vx;
        dot.y += dot.vy;
        dot.fade += (dot.fadeTarget - dot.fade) * 0.16;
        dot.size += (dot.sizeTarget - dot.size) * 0.18;
        if (
          Math.abs(dot.vx) > 0.04 ||
          Math.abs(dot.vy) > 0.04 ||
          Math.abs(dot.hx - dot.x) > 0.35 ||
          Math.abs(dot.hy - dot.y) > 0.35 ||
          Math.abs(dot.fadeTarget - dot.fade) > 0.01 ||
          Math.abs(dot.sizeTarget - dot.size) > 0.01
        ) {
          moving = true;
        }
      }
      paint();
      if (moving) raf = window.requestAnimationFrame(tick);
    };

    const wake = () => {
      if (!raf && alive) raf = window.requestAnimationFrame(tick);
    };

    const toggleNet = (on: boolean) => {
      inNet = on;
      setNet(on);
      seats = seatsOf(width, height);
      if (!on) {
        for (const dot of dots) {
          dot.fadeTarget = 1;
          dot.sizeTarget = 1.15;
        }
        homes.forEach((home, index) => {
          const dot = dots[index];
          if (dot) {
            dot.hx = home.x;
            dot.hy = home.y;
          }
        });
        pointer = null;
        wake();
        return;
      }
      const taken = new Set<number>();
      seats.forEach((seat) => {
        let best = -1;
        let bestDist = Infinity;
        dots.forEach((_dot, index) => {
          if (taken.has(index) || !homes[index]) return;
          const dist = Math.hypot(homes[index].x - seat.x, homes[index].y - seat.y);
          if (dist < bestDist) {
            bestDist = dist;
            best = index;
          }
        });
        if (best < 0) return;
        taken.add(best);
        const dot = dots[best];
        dot.hx = seat.x;
        dot.hy = seat.y;
        dot.fadeTarget = 1;
        dot.sizeTarget = 2.3;
      });
      dots.forEach((dot, index) => {
        if (taken.has(index)) return;
        dot.fadeTarget = 0;
      });
      wake();
    };

    const build = () => {
      layout();
      homes = collect();
      if (!homes.length) return;
      dots = homes.map((point) => ({
        x: point.x,
        y: point.y,
        vx: 0,
        vy: 0,
        hx: point.x,
        hy: point.y,
        alpha: 0.36 + 0.64 * Math.max(0, 1 - Math.hypot(point.x - width / 2, point.y - height * 0.44) / (width * 0.5)),
        fade: 1,
        fadeTarget: 1,
        size: 1.15,
        sizeTarget: 1.15,
      }));
      if (inNet) toggleNet(true);
      paint();
    };

    build();

    if (reduced) {
      return () => {
        alive = false;
      };
    }

    const onResize = () => {
      build();
    };
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      wake();
    };
    const onLeave = () => {
      pointer = null;
      wake();
    };
    const onEnter = () => toggleNet(true);
    const onExit = () => toggleNet(false);

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    observer?.observe(host);
    canvas.addEventListener('pointerenter', onEnter);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    host.addEventListener('pointerenter', onEnter);
    host.addEventListener('pointerleave', onExit);

    return () => {
      alive = false;
      if (raf) window.cancelAnimationFrame(raf);
      observer?.disconnect();
      canvas.removeEventListener('pointerenter', onEnter);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('pointerenter', onEnter);
      host.removeEventListener('pointerleave', onExit);
    };
  }, []);

  const wires = useMemo(() => {
    const inWires: { d: string; i: number }[] = [];
    const outWires: { d: string; i: number }[] = [];
    const at = (layer: 0 | 1 | 2, index: number) => ({
      x: SEAT_X[layer] * 100,
      y: 6 + 74 * SEAT_Y[layer][index],
    });
    SEAT_Y[0].forEach((_, i) => {
      SEAT_Y[1].forEach((__, j) => {
        const from = at(0, i);
        const to = at(1, j);
        inWires.push({ d: 'M' + from.x + ' ' + from.y + 'L' + to.x + ' ' + to.y, i: i * 5 + j });
      });
    });
    SEAT_Y[1].forEach((_, i) => {
      SEAT_Y[2].forEach((__, j) => {
        const from = at(1, i);
        const to = at(2, j);
        outWires.push({ d: 'M' + from.x + ' ' + from.y + 'L' + to.x + ' ' + to.y, i: i * 2 + j });
      });
    });
    return [...inWires, ...outWires];
  }, []);

  return (
    <div className={className ? `${net ? 'pfield is-net' : 'pfield'} ${className}` : net ? 'pfield is-net' : 'pfield'}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <svg
        className="pfield-wires"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {wires.map((wire) => (
          <path
            key={wire.d}
            d={wire.d}
            vectorEffect="non-scaling-stroke"
            style={{ '--i': wire.i } as React.CSSProperties}
          />
        ))}
      </svg>
    </div>
  );
};

export default ParticleField;
