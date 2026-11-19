'use client';

import { useEffect, useRef } from 'react';

import './particles-field.css';

export const PARTICLE_SHAPES = ['circle', 'square', 'flower'] as const;

export type ParticleShape = (typeof PARTICLE_SHAPES)[number];

type Dot = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hx: number;
  hy: number;
  alpha: number;
};

type Point = { x: number; y: number };

const roundRect = (path: Path2D, x: number, y: number, w: number, h: number, r: number) => {
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  path.closePath();
};

const buildPath = (shape: ParticleShape, cx: number, cy: number, r: number) => {
  const path = new Path2D();
  if (shape === 'square') {
    const s = r * 0.9;
    roundRect(path, cx - s, cy - s, s * 2, s * 2, s * 0.16);
    return path;
  }
  if (shape === 'flower') {
    const petals = 6;
    const steps = 260;
    for (let i = 0; i <= steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      const wobble = 0.72 + 0.28 * Math.cos(petals * angle);
      const x = cx + Math.cos(angle) * r * wobble;
      const y = cy + Math.sin(angle) * r * wobble;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    return path;
  }
  path.arc(cx, cy, r, 0, Math.PI * 2);
  return path;
};

/**
 * A dot field that gathers into a shape and fills the whole card. Dots are
 * paired by angle, so a shape change sweeps around the centre instead of
 * cutting through it; the pointer pushes them aside and a press throws them
 * out before they regroup.
 */
export const ParticleField = ({
  shape,
  className,
}: {
  shape: ParticleShape;
  className?: string;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const regroupRef = useRef<((next: ParticleShape) => void) | null>(null);
  const firstShape = useRef(true);

  useEffect(() => {
    if (firstShape.current) {
      firstShape.current = false;
      return;
    }
    regroupRef.current?.(shape);
  }, [shape]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const probe = document.createElement('canvas').getContext('2d');
    let dots: Dot[] = [];
    let width = 0;
    let height = 0;
    let cx = 0;
    let cy = 0;
    let radius = 0;
    let colour = '#3fd8c0';
    let raf = 0;
    let alive = true;
    let pointer: Point | null = null;

    const layout = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      colour = window.getComputedStyle(canvas).color || colour;
      cx = width / 2;
      cy = height * 0.44;
      radius = Math.max(24, Math.min(width * 0.4, height * 0.44));
    };

    const collect = (target: ParticleShape) => {
      const path = buildPath(target, cx, cy, radius);
      const step = Math.max(4.4, Math.min(7, radius / 20));
      const points: Point[] = [];
      let row = 0;
      for (let y = cy - radius * 1.05; y <= cy + radius * 1.05; y += step * 0.88) {
        const offset = row % 2 === 0 ? 0 : step / 2;
        for (let x = cx - radius * 1.05 + offset; x <= cx + radius * 1.05; x += step) {
          if (probe && probe.isPointInPath(path, x, y)) points.push({ x, y });
        }
        row += 1;
      }
      return points;
    };

    const scatter = (target: ParticleShape) => {
      const points = collect(target);
      if (!points.length) return;
      points.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
      const alphaOf = (point: Point) =>
        0.34 + 0.66 * Math.max(0, 1 - Math.hypot(point.x - cx, point.y - cy) / (radius * 1.2));

      if (!dots.length) {
        dots = points.map((point) => ({
          x: point.x,
          y: point.y,
          vx: 0,
          vy: 0,
          hx: point.x,
          hy: point.y,
          alpha: alphaOf(point),
        }));
        return;
      }

      const ordered = dots
        .map((dot) => ({ dot, angle: Math.atan2(dot.y - cy, dot.x - cx) }))
        .sort((a, b) => a.angle - b.angle)
        .map((entry) => entry.dot);

      const count = Math.min(ordered.length, points.length);
      for (let i = 0; i < count; i += 1) {
        const dot = ordered[i];
        const point = points[Math.round((i / count) * (points.length - 1))];
        dot.hx = point.x;
        dot.hy = point.y;
        dot.alpha = alphaOf(point);
      }
      if (ordered.length > points.length) {
        dots = ordered.slice(0, points.length);
      } else if (points.length > ordered.length) {
        for (let i = ordered.length; i < points.length; i += 1) {
          const point = points[i];
          dots.push({
            x: point.x,
            y: point.y,
            vx: 0,
            vy: 0,
            hx: point.x,
            hy: point.y,
            alpha: alphaOf(point),
          });
        }
      }
    };

    const paint = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = colour;
      for (const dot of dots) {
        const speed = Math.hypot(dot.vx, dot.vy);
        const stretch = 1 + Math.min(1.5, speed * 0.09);
        ctx.globalAlpha = dot.alpha;
        if (stretch > 1.05) {
          ctx.save();
          ctx.translate(dot.x, dot.y);
          ctx.rotate(Math.atan2(dot.vy, dot.vx));
          ctx.beginPath();
          ctx.ellipse(0, 0, 1.05 * stretch, 1.05, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, 1.05, 0, Math.PI * 2);
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
        if (pointer) {
          const dx = dot.x - pointer.x;
          const dy = dot.y - pointer.y;
          const dist = Math.hypot(dx, dy);
          const reach = Math.max(58, radius * 0.85);
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
        if (
          Math.abs(dot.vx) > 0.04 ||
          Math.abs(dot.vy) > 0.04 ||
          Math.abs(dot.hx - dot.x) > 0.35 ||
          Math.abs(dot.hy - dot.y) > 0.35
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

    const shock = (x: number, y: number) => {
      for (const dot of dots) {
        const dx = dot.x - x;
        const dy = dot.y - y;
        const dist = Math.hypot(dx, dy);
        if (dist < 230 && dist > 0.001) {
          const force = (1 - dist / 230) * 26;
          dot.vx += (dx / dist) * force;
          dot.vy += (dy / dist) * force;
        }
      }
      wake();
    };

    layout();
    scatter(shape);
    paint();

    regroupRef.current = (next: ParticleShape) => {
      scatter(next);
      wake();
    };

    if (reduced) {
      return () => {
        alive = false;
        regroupRef.current = null;
      };
    }

    const onResize = () => {
      layout();
      scatter(shape);
      paint();
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
    const onDown = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      shock(event.clientX - rect.left, event.clientY - rect.top);
    };

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    observer?.observe(canvas);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);

    return () => {
      alive = false;
      regroupRef.current = null;
      if (raf) window.cancelAnimationFrame(raf);
      observer?.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
    };
  }, [shape]);

  return (
    <div className={className ? 'pfield ' + className : 'pfield'}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
};

export default ParticleField;
