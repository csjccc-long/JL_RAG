import { isDarkTheme, watchTheme } from '@/components/live-orb';
import { useTranslate } from '@/hooks/common-hooks';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildBrainGeometry,
  buildLayout,
  Edge,
  Neuron,
  TYPE_COLORS,
  Vec3,
} from './brain-model';
import { IMemory } from './interface';
import { NEURON_SOMA, neuronSprite } from './neuron-shape';

interface IProps {
  memories: IMemory[];
  onOpen?: (id: string) => void;
  className?: string;
}

interface EdgePath extends Edge {
  control: Vec3;
}

interface Graph {
  neurons: Neuron[];
  edges: EdgePath[];
  types: string[];
}

/** scratch vector reused by every projection (single-threaded, safe) */
const PROJECTED = new Float32Array(3);
/** view basis, refreshed once per frame instead of per point */
let VIEW = { cosY: 1, sinY: 0, cosP: 1, sinP: 0, zoom: 1 };

/**
 * The memory brain: a holographic cortex built from a point cloud, with every
 * memory dropped into it as a neuron. Neurons are wired to their nearest kin,
 * and the pulses travelling along those wires are the "relations".
 */
export function MemoryBrain({ memories, onOpen, className }: IProps) {
  const { t } = useTranslate('memories');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometry = useMemo(() => buildBrainGeometry(), []);

  const graph = useMemo<Graph>(() => {
    const layout = buildLayout(memories);
    const edges = layout.edges.map((edge) => {
      const a = layout.neurons[edge.a].pos;
      const b = layout.neurons[edge.b].pos;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const side = edge.phase > 0.5 ? 1 : -1;
      return {
        ...edge,
        control: {
          x: (a.x + b.x) / 2 + (-dz / len) * edge.bend * side,
          y: (a.y + b.y) / 2 + edge.bend * side,
          z: (a.z + b.z) / 2 + (dx / len) * edge.bend * side,
        },
      };
    });
    const types = Array.from(
      new Set(layout.neurons.map((neuron) => neuron.type)),
    );
    return { neurons: layout.neurons, edges, types };
  }, [memories]);

  const graphRef = useRef(graph);
  graphRef.current = graph;
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  const [dark, setDark] = useState(() => isDarkTheme());
  const darkRef = useRef(dark);
  darkRef.current = dark;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverRef = useRef(-1);
  const pressedRef = useRef(-1);
  const enterRef = useRef<{ index: number; start: number } | null>(null);
  const enterTimer = useRef(0);
  const [entering, setEntering] = useState(false);

  // start from the lateral profile — the view everyone recognises as a brain —
  // and let it breathe around that angle instead of spinning away from it
  const camera = useRef({ yaw: 1.5, pitch: -0.04, zoom: 1 });
  const sway = useRef(true);
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const sizeState = useRef({ w: 0, h: 0 });

  useEffect(() => watchTheme(() => setDark(isDarkTheme())), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeState.current = { w: rect.width, h: rect.height };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const next = camera.current.zoom * (event.deltaY > 0 ? 0.94 : 1.06);
      camera.current.zoom = Math.min(1.8, Math.max(0.7, next));
    };
    canvas.addEventListener('wheel', wheel, { passive: false });

    let raf = 0;

    const project = (
      x: number,
      y: number,
      z: number,
      cx: number,
      cy: number,
      base: number,
    ) => {
      const { cosY, sinY, cosP, sinP, zoom } = VIEW;
      const x1 = x * cosY + z * sinY;
      const z1 = -x * sinY + z * cosY;
      const y1 = y * cosP - z1 * sinP;
      const z2 = y * sinP + z1 * cosP;
      const dist = 4.6;
      const persp = (dist / (dist - z2)) * base * zoom;
      PROJECTED[0] = cx + x1 * persp;
      PROJECTED[1] = cy - y1 * persp;
      PROJECTED[2] = z2;
      return PROJECTED;
    };

    const draw = (time: number) => {
      const { w, h } = sizeState.current;
      if (!w || !h) return;
      const isDark = darkRef.current;
      const cx = w / 2;
      const cy = h * 0.5;
      const base = Math.min(w * 0.32, h * 0.42);
      const { neurons, edges } = graphRef.current;

      const cam = camera.current;
      VIEW = {
        cosY: Math.cos(cam.yaw),
        sinY: Math.sin(cam.yaw),
        cosP: Math.cos(cam.pitch),
        sinP: Math.sin(cam.pitch),
        zoom: cam.zoom,
      };

      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      // ambient glow so the brain floats instead of sitting on a flat page
      const halo = ctx.createRadialGradient(
        cx,
        cy,
        base * 0.1,
        cx,
        cy,
        base * 1.7,
      );
      halo.addColorStop(
        0,
        isDark ? 'rgba(0, 190, 180, 0.13)' : 'rgba(0, 150, 145, 0.07)',
      );
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      // ---- entering a memory: the camera dives into its neuron, so opening
      // the detail page reads as travelling inward instead of a page swap
      const focus = enterRef.current;
      const focusNeuron = focus ? neurons[focus.index] : undefined;
      let focusEase = 0;
      let focusColour = '#54e3d6';
      if (focus && focusNeuron) {
        const span = Math.min(
          1,
          Math.max(0, (time * 1000 - focus.start) / 620),
        );
        focusEase = span * span * (3 - 2 * span);
        focusColour = TYPE_COLORS[focusNeuron.type][isDark ? 'dark' : 'light'];
        const fp = project(
          focusNeuron.pos.x,
          focusNeuron.pos.y,
          focusNeuron.pos.z,
          cx,
          cy,
          base,
        );
        ctx.save();
        ctx.translate(cx, cy);
        const z = 1 + 5.6 * focusEase * focusEase;
        ctx.scale(z, z);
        ctx.translate(-fp[0], -fp[1]);
      }

      // ---- neurons: project once, resolve hover once
      const projected: { x: number; y: number; z: number }[] = [];
      let hovered = -1;
      let hoveredDist = 26;
      for (const neuron of neurons) {
        const p = project(neuron.pos.x, neuron.pos.y, neuron.pos.z, cx, cy, base);
        projected.push({ x: p[0], y: p[1], z: p[2] });
        if (pointer.current && !drag.current && !enterRef.current) {
          const d = Math.hypot(p[0] - pointer.current.x, p[1] - pointer.current.y);
          if (d < hoveredDist) {
            hoveredDist = d;
            hovered = projected.length - 1;
          }
        }
      }
      if (hovered !== hoverRef.current) {
        hoverRef.current = hovered;
        setHoverId(hovered >= 0 ? neurons[hovered].id : null);
      }

      // ---- wires, drawn first so neurons read as sitting in front of them.
      // Each wire fades out at both ends, so the net reads as tendrils rather
      // than as a wireframe cage.
      const wireRgb = isDark ? '124, 226, 216' : '10, 120, 112';
      ctx.lineWidth = 1;
      for (const edge of edges) {
        const a = neurons[edge.a].pos;
        const b = neurons[edge.b].pos;
        const c = edge.control;
        const steps = 14;
        ctx.beginPath();
        for (let i = 0; i <= steps; i += 1) {
          const s = i / steps;
          const inv = 1 - s;
          const x = inv * inv * a.x + 2 * inv * s * c.x + s * s * b.x;
          const y = inv * inv * a.y + 2 * inv * s * c.y + s * s * b.y;
          const z = inv * inv * a.z + 2 * inv * s * c.z + s * s * b.z;
          const p = project(x, y, z, cx, cy, base);
          if (i === 0) {
            ctx.moveTo(p[0], p[1]);
          } else {
            ctx.lineTo(p[0], p[1]);
          }
        }
        const pa = projected[edge.a];
        const pb = projected[edge.b];
        const wire = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
        wire.addColorStop(0, `rgba(${wireRgb}, 0)`);
        wire.addColorStop(0.5, `rgba(${wireRgb}, 0.3)`);
        wire.addColorStop(1, `rgba(${wireRgb}, 0)`);
        ctx.strokeStyle = wire;
        ctx.stroke();
      }

      // ---- cortex: bucket the point cloud by depth, so no per-point sorting.
      // The same pass keeps the furthest point per angular bin: together those
      // points are the silhouette, so the outline always hugs the cloud.
      const buckets: number[][] = Array.from({ length: 14 }, () => []);
      const OUTLINE_BINS = 300;
      const hull: ({ x: number; y: number; r: number } | null)[] =
        new Array(OUTLINE_BINS).fill(null);
      const pushPoints = (pts: Float32Array) => {
        for (let i = 0; i < pts.length; i += 3) {
          const p = project(pts[i], pts[i + 1], pts[i + 2], cx, cy, base);
          const bucket = Math.min(
            13,
            Math.max(0, Math.round(((p[2] + 1.1) / 2.2) * 13)),
          );
          buckets[bucket].push(p[0], p[1]);
          const dx = p[0] - cx;
          const dy = p[1] - cy;
          const r = Math.hypot(dx, dy);
          const bin = Math.min(
            OUTLINE_BINS - 1,
            Math.max(
              0,
              Math.round(
                ((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) *
                  (OUTLINE_BINS - 1),
              ),
            ),
          );
          const cur = hull[bin];
          if (!cur || r > cur.r) hull[bin] = { x: p[0], y: p[1], r };
        }
      };
      pushPoints(geometry.cortex);
      pushPoints(geometry.cerebellum);
      // the stem is too thin to outline: it only adds teeth to the contour
      for (let i = 0; i < geometry.stem.length; i += 3) {
        const p = project(
          geometry.stem[i],
          geometry.stem[i + 1],
          geometry.stem[i + 2],
          cx,
          cy,
          base,
        );
        const bucket = Math.min(
          13,
          Math.max(0, Math.round(((p[2] + 1.1) / 2.2) * 13)),
        );
        buckets[bucket].push(p[0], p[1]);
      }

      const ring: { x: number; y: number }[] = [];
      for (const q of hull) {
        if (q) ring.push({ x: q.x, y: q.y });
      }
      // neighbour averaging: removes the scallops the folds leave on the hull,
      // leaving a clean marked contour
      for (let pass = 0; pass < 3; pass += 1) {
        const n = ring.length;
        if (n < 6) break;
        const smoothed = ring.map((q, i) => {
          const prev = ring[(i - 1 + n) % n];
          const next = ring[(i + 1) % n];
          return {
            x: (prev.x + q.x * 2 + next.x) / 4,
            y: (prev.y + q.y * 2 + next.y) / 4,
          };
        });
        for (let i = 0; i < n; i += 1) ring[i] = smoothed[i];
      }
      const traceOutline = () => {
        if (ring.length < 8) return false;
        const mid = (
          a: { x: number; y: number },
          b: { x: number; y: number },
        ) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        const n = ring.length;
        const start = mid(ring[n - 1], ring[0]);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        for (let i = 0; i < n; i += 1) {
          const cur = ring[i];
          const next = ring[(i + 1) % n];
          const m = mid(cur, next);
          ctx.quadraticCurveTo(cur.x, cur.y, m.x, m.y);
        }
        ctx.closePath();
        return true;
      };

      // the body of the brain: a soft volume under the point cloud
      if (traceOutline()) {
        const body = ctx.createLinearGradient(0, cy - base, 0, cy + base);
        body.addColorStop(
          0,
          isDark ? 'rgba(38, 120, 116, 0.16)' : 'rgba(190, 235, 230, 0.3)',
        );
        body.addColorStop(
          1,
          isDark ? 'rgba(12, 44, 44, 0.14)' : 'rgba(220, 246, 243, 0.22)',
        );
        ctx.fillStyle = body;
        ctx.fill();

        // volume shading: light falls from the upper left, the rim falls away
        ctx.save();
        ctx.clip();
        const shade = ctx.createRadialGradient(
          cx - base * 0.38,
          cy - base * 0.46,
          base * 0.08,
          cx,
          cy,
          base * 1.06,
        );
        shade.addColorStop(
          0,
          isDark ? 'rgba(168, 248, 238, 0.055)' : 'rgba(255, 255, 255, 0.5)',
        );
        shade.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
        shade.addColorStop(
          1,
          isDark ? 'rgba(2, 12, 12, 0.42)' : 'rgba(150, 205, 200, 0.42)',
        );
        ctx.fillStyle = shade;
        ctx.fillRect(cx - base * 1.4, cy - base * 1.4, base * 2.8, base * 2.8);
        ctx.restore();
      }

      for (let b = 0; b < buckets.length; b += 1) {
        const list = buckets[b];
        if (!list.length) continue;
        const depth = b / (buckets.length - 1);
        ctx.fillStyle = isDark
          ? `rgba(140, 236, 228, ${0.035 + 0.19 * depth * depth})`
          : `rgba(16, 96, 92, ${0.03 + 0.17 * depth * depth})`;
        const s = 1.1 + depth * 1.1;
        ctx.beginPath();
        for (let i = 0; i < list.length; i += 2) {
          ctx.rect(list[i] - s / 2, list[i + 1] - s / 2, s, s);
        }
        ctx.fill();
      }

      // ---- cortical mesh: latitudes and meridians, faded by depth. This is
      // what makes the shape read as a modelled 3D brain.
      ctx.lineWidth = 0.8;
      for (const line of geometry.mesh) {
        const screen: number[] = [];
        for (let i = 0; i < line.length; i += 3) {
          const p = project(line[i], line[i + 1], line[i + 2], cx, cy, base);
          screen.push(p[0], p[1], p[2]);
        }
        for (let i = 3; i < screen.length; i += 3) {
          const z = (screen[i - 1] + screen[i + 2]) / 2;
          const depth = Math.min(1, Math.max(0, (z + 1) / 2));
          const alpha = 0.05 + 0.2 * depth * depth;
          ctx.strokeStyle = isDark
            ? `rgba(146, 234, 226, ${alpha})`
            : `rgba(12, 104, 98, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(screen[i - 3], screen[i - 2]);
          ctx.lineTo(screen[i], screen[i + 1]);
          ctx.stroke();
        }
      }

      // ---- folds: front-to-back gyri. The sulcus (a dark trough) and its
      // crest sit side by side and both fade with depth, so the surface reads
      // as folded cortex rather than as a ruled grid.
      const drawFolds = (
        lines: Float32Array[],
        darkColour: string,
        lightColour: string,
        width: number,
        floor: number,
        gain: number,
      ) => {
        ctx.lineWidth = width;
        for (const line of lines) {
          const screen: number[] = [];
          for (let i = 0; i < line.length; i += 3) {
            const p = project(line[i], line[i + 1], line[i + 2], cx, cy, base);
            screen.push(p[0], p[1], p[2]);
          }
          for (let i = 3; i < screen.length; i += 3) {
            const z = (screen[i - 1] + screen[i + 2]) / 2;
            const depth = Math.min(1, Math.max(0, (z + 1) / 2));
            const alpha = floor + gain * depth * depth;
            ctx.strokeStyle = isDark
              ? `rgba(${darkColour}, ${alpha})`
              : `rgba(${lightColour}, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(screen[i - 3], screen[i - 2]);
            ctx.lineTo(screen[i], screen[i + 1]);
            ctx.stroke();
          }
        }
      };
      drawFolds(geometry.folds, '3, 22, 24', '14, 78, 74', 2.4, 0.06, 0.36);
      drawFolds(
        geometry.crests,
        '150, 246, 236',
        '255, 255, 255',
        1,
        0.04,
        0.3,
      );

      // ---- silhouette: the same ring, stroked on top so the contour is crisp
      if (traceOutline()) {
        ctx.strokeStyle = isDark
          ? 'rgba(158, 244, 234, 0.55)'
          : 'rgba(9, 118, 110, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // ---- neurons, sorted back to front
      const order = neurons
        .map((_, index) => ({ index, z: projected[index].z }))
        .sort((a, b) => a.z - b.z);

      for (const { index } of order) {
        const neuron = neurons[index];
        const p = projected[index];
        const isHover = index === hoverRef.current;
        const colour = TYPE_COLORS[neuron.type][isDark ? 'dark' : 'light'];
        const pulse = reduced
          ? 0.5
          : Math.sin(time * 1.8 + (neuron.seed % 6.28)) * 0.5 + 0.5;
        const r = neuron.radius * (1 + p.z * 0.04);
        const glowR = (isHover ? 30 : 17) + pulse * 4;

        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        glow.addColorStop(0, hexToRgba(colour, isHover ? 0.45 : 0.26));
        glow.addColorStop(0.45, hexToRgba(colour, 0.1));
        glow.addColorStop(1, hexToRgba(colour, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
        ctx.fill();

        // the neuron itself: a cached morphology sprite, so the dendrites,
        // spines and boutons keep their detail at 3px as well as at 300px
        const sprite = neuronSprite(neuron.seed, colour, isDark);
        const unit = (r * (isHover ? 1.28 : 1)) / NEURON_SOMA;
        const drawSize = sprite.width * (unit / 22);
        ctx.drawImage(
          sprite,
          p.x - drawSize / 2,
          p.y - drawSize / 2,
          drawSize,
          drawSize,
        );

        if (isHover) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, glowR * 0.8, 0, Math.PI * 2);
          ctx.strokeStyle = hexToRgba(colour, 0.32);
          ctx.setLineDash([3, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // ---- travelling pulses: the relations being replayed
      if (!reduced) {
        for (const edge of edges) {
          const a = neurons[edge.a].pos;
          const b = neurons[edge.b].pos;
          const c = edge.control;
          const s = (time * edge.speed + edge.phase) % 1;
          const inv = 1 - s;
          const x = inv * inv * a.x + 2 * inv * s * c.x + s * s * b.x;
          const y = inv * inv * a.y + 2 * inv * s * c.y + s * s * b.y;
          const z = inv * inv * a.z + 2 * inv * s * c.z + s * s * b.z;
          const p = project(x, y, z, cx, cy, base);
          const alpha = Math.sin(Math.PI * s) * 0.85;
          const dot = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 5);
          dot.addColorStop(
            0,
            isDark
              ? `rgba(170, 255, 246, ${alpha})`
              : `rgba(8, 130, 122, ${alpha})`,
          );
          dot.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = dot;
          ctx.beginPath();
          ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ---- labels: always on for a small brain, on hover for a dense one
      const alwaysLabel = neurons.length <= 9;
      const taken: { x: number; y: number; w: number; h: number }[] = [];
      for (const { index } of order) {
        const neuron = neurons[index];
        const p = projected[index];
        const isHover = index === hoverRef.current;
        if (!isHover && !alwaysLabel) continue;
        const colour = TYPE_COLORS[neuron.type][isDark ? 'dark' : 'light'];
        // labels must not stack on top of each other: nudge down, then give up
        let ly = p.y + 14;
        let placed = false;
        for (let attempt = 0; attempt < 4 && !placed; attempt += 1) {
          const probe = {
            x: p.x - 70,
            y: ly - 2,
            w: 140,
            h: neuron.date ? 40 : 24,
          };
          placed = taken.every(
            (r) =>
              probe.x + probe.w < r.x ||
              r.x + r.w < probe.x ||
              probe.y + probe.h < r.y ||
              r.y + r.h < probe.y,
          );
          if (placed) taken.push(probe);
          else ly += 34;
        }
        if (!placed) continue;
        drawLabel(ctx, p.x, ly, {
          name: neuron.name,
          date: neuron.date,
          colour,
          strong: isHover,
          isDark,
          width: w,
          height: h,
        });
      }

      if (focus && focusNeuron) {
        ctx.restore();
        // flash: the neuron's light fills the frame just before the route flips
        const flash = ctx.createRadialGradient(
          cx,
          cy,
          0,
          cx,
          cy,
          Math.max(w, h) * 0.6,
        );
        flash.addColorStop(0, hexToRgba(focusColour, 0.5 * focusEase));
        flash.addColorStop(0.5, hexToRgba(focusColour, 0.18 * focusEase));
        flash.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = flash;
        ctx.fillRect(0, 0, w, h);
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      if (!reduced && sway.current && !enterRef.current) {
        camera.current.yaw = 1.5 + Math.sin(now / 1000 * 0.16) * 0.42;
      }
      draw(now / 1000);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('wheel', wheel);
      window.clearTimeout(enterTimer.current);
    };
  }, [geometry, t]);

  return (
    <div className={cn('relative min-h-0', className)}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t('brainView')}
        className={cn(
          'absolute inset-0 h-full w-full touch-none select-none',
          entering ? 'cursor-wait' : hoverId ? 'cursor-pointer' : 'cursor-grab',
        )}
        onPointerDown={(event) => {
          if (enterRef.current) return;
          (event.target as HTMLElement).setPointerCapture(event.pointerId);
          sway.current = false;
          // remember what is under the cursor now: the first frame after the
          // press clears the hover, so the click target has to be captured here
          pressedRef.current = hoverRef.current;
          drag.current = { x: event.clientX, y: event.clientY, moved: 0 };
        }}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          pointer.current = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          };
          const state = drag.current;
          if (!state) return;
          const dx = event.clientX - state.x;
          const dy = event.clientY - state.y;
          state.moved += Math.abs(dx) + Math.abs(dy);
          state.x = event.clientX;
          state.y = event.clientY;
          camera.current.yaw += dx * 0.006;
          camera.current.pitch = Math.max(
            -0.6,
            Math.min(0.6, camera.current.pitch + dy * 0.004),
          );
        }}
        onPointerUp={() => {
          const state = drag.current;
          drag.current = null;
          if (enterRef.current) return;
          const index = state && state.moved < 6 ? pressedRef.current : -1;
          pressedRef.current = -1;
          if (index < 0) return;
          const neuron = graphRef.current.neurons[index];
          if (!neuron) return;
          // dive into the neuron first: the detail page is the inside of it
          sway.current = false;
          enterRef.current = { index, start: performance.now() };
          setEntering(true);
          window.clearTimeout(enterTimer.current);
          enterTimer.current = window.setTimeout(() => {
            openRef.current?.(neuron.id);
          }, 680);
        }}
        onPointerLeave={() => {
          pointer.current = null;
          drag.current = null;
        }}
      />

      <div className="pointer-events-none absolute left-4 top-3 flex flex-col gap-1">
        <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-text-secondary/70">
          {t('brainView')}
        </p>
        <p className="text-xs text-text-secondary">
          <span className="text-sm font-semibold text-text-primary">
            {graph.neurons.length}
          </span>{' '}
          {t('neurons')} ·{' '}
          <span className="text-sm font-semibold text-text-primary">
            {graph.edges.length}
          </span>{' '}
          {t('synapses')}
        </p>
      </div>

      <div className="pointer-events-none absolute right-4 top-3 flex flex-col items-end gap-1.5">
        {graph.types.map((type) => (
          <span
            key={type}
            className="flex items-center gap-1.5 text-[11px] text-text-secondary"
          >
            {t(type)}
            <i
              className="size-1.5 rounded-full"
              style={{
                backgroundColor:
                  TYPE_COLORS[type as keyof typeof TYPE_COLORS][
                    dark ? 'dark' : 'light'
                  ],
              }}
            />
          </span>
        ))}
      </div>

      {!entering && (
        <p className="pointer-events-none absolute bottom-2 left-1/2 max-w-full -translate-x-1/2 px-4 text-center text-[11px] text-text-secondary/60">
          {t('brainHint')}
        </p>
      )}
    </div>
  );
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface LabelOptions {
  name: string;
  date: string;
  colour: string;
  strong: boolean;
  isDark: boolean;
  width: number;
  height: number;
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  options: LabelOptions,
) {
  const { name, date, colour, strong, isDark, width, height } = options;
  const title = name.length > 22 ? `${name.slice(0, 22)}…` : name;
  const titleFont = strong
    ? '600 13px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    : '500 12px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.font = titleFont;
  const titleWidth = ctx.measureText(title).width;
  ctx.font = '400 11px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  const dateWidth = date ? ctx.measureText(date).width : 0;
  const boxWidth = Math.max(titleWidth, dateWidth) + (strong ? 34 : 18);
  const boxHeight = date ? 40 : 24;
  let bx = x - boxWidth / 2;
  let by = y;
  if (bx < 8) bx = 8;
  if (bx + boxWidth > width - 8) bx = width - 8 - boxWidth;
  if (by + boxHeight > height - 8) by = height - 8 - boxHeight;

  if (strong) {
    ctx.beginPath();
    ctx.roundRect(bx, by, boxWidth, boxHeight, 8);
    ctx.fillStyle = isDark
      ? 'rgba(14, 17, 19, 0.9)'
      : 'rgba(255, 255, 255, 0.94)';
    ctx.fill();
    ctx.strokeStyle = hexToRgba(colour, 0.45);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(bx + 12, by + 14, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
  }

  // legibility over the mesh: a soft shadow instead of an opaque chip
  ctx.shadowColor = isDark ? 'rgba(3, 10, 10, 0.85)' : 'rgba(255, 255, 255, 0.9)';
  ctx.shadowBlur = strong ? 0 : 5;
  ctx.fillStyle = isDark ? '#eaf7f4' : '#12312f';
  ctx.font = titleFont;
  ctx.fillText(title, bx + (strong ? 22 : 9), by + 13);
  ctx.shadowBlur = 0;

  if (date) {
    ctx.font =
      '400 11px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = isDark
      ? 'rgba(198, 218, 215, 0.72)'
      : 'rgba(38, 74, 72, 0.66)';
    ctx.fillText(date, bx + (strong ? 22 : 9), by + 29);
  }
}
