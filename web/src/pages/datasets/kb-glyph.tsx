import { useEffect, useRef } from 'react';

import './kb-glyph.css';

/**
 * The knowledge base's mark: its database logo drawn as a halftone of dots.
 * A pointer dragged across it leaves a wake — the dots under the hand thicken
 * into glyphs and cool back into dots along the path they came from, and a
 * press sends a ring out across the field. Nothing is downloaded: the shape is
 * stroked into a Path2D, the ink is the page's own colour.
 */

const W = 196;
const H = 96;
/** How far apart the dots sit, in canvas units. Tight enough that the mark
 * reads as one inked figure rather than a dotted outline. */
const STEP = 4.8;
/** Below this much heat a cell is still the resting field. */
const COLD = 0.04;
/** Seconds for a press's ring to spread and fade. */
const RING_S = 2.2;
/** Lightest to densest; the first entry is a blank. */
const RAMP = [' ', '·', '•', '●'];

type Ring = { x: number; y: number; t: number };

/**
 * The database mark in the icon's own 24-unit box: three rims joined by two
 * continuous sides, the stock icon's own geometry.
 */
function buildMark(): Path2D {
  const path = new Path2D();
  const ring = (cy: number) => path.ellipse(12, cy, 9, 2.1, 0, 0, Math.PI * 2);
  ring(4.4);
  ring(12);
  ring(19.6);
  path.moveTo(3, 4.4);
  path.lineTo(3, 19.6);
  path.moveTo(21, 4.4);
  path.lineTo(21, 19.6);
  return path;
}

export function KbGlyph({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({
    cols: 0,
    rows: 0,
    cw: STEP,
    ch: STEP,
    ox: 0,
    oy: 0,
    ratio: 1,
    mask: new Float32Array(0),
    heat: new Float32Array(0),
    rings: [] as Ring[],
    raf: 0,
    hx: -999,
    hy: -999,
    inside: false,
    font: '',
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const state = stateRef.current;
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return;

    const mark = buildMark();
    probe.lineCap = 'round';
    probe.lineJoin = 'round';

    const build = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * ratio);
      canvas.height = Math.round(H * ratio);
      state.ratio = ratio;
      state.cw = STEP;
      state.ch = STEP * 0.88;
      state.cols = Math.floor(W / state.cw);
      state.rows = Math.floor(H / state.ch);
      state.ox = (W - state.cols * state.cw) / 2;
      state.oy = (H - state.rows * state.ch) / 2;
      state.mask = new Float32Array(state.cols * state.rows);
      state.heat = new Float32Array(state.cols * state.rows);
      state.font = '600 9px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      // The 24-unit icon box is scaled to fill the block, then pushed to the
      // card's right edge; the sample points are canvas units, so the transform
      // has to be live while isPointInStroke walks them.
      const size = Math.min(W * 0.82, H * 0.94);
      const k = size / 24;
      probe.save();
      probe.setTransform(k, 0, 0, k, W - size - 6, (H - size) / 2);
      probe.lineWidth = 2.1;
      for (let j = 0; j < state.rows; j += 1) {
        for (let i = 0; i < state.cols; i += 1) {
          const x = state.ox + (i + 0.5 + (j & 1) * 0.5) * state.cw;
          const y = state.oy + (j + 0.5) * state.ch;
          state.mask[j * state.cols + i] = probe.isPointInStroke(mark, x, y) ? 1 : 0;
        }
      }
      probe.restore();
    };

    const stamp = (x: number, y: number, radius: number, amount: number) => {
      const c0 = Math.max(0, Math.floor((x - radius) / state.cw));
      const c1 = Math.min(state.cols - 1, Math.ceil((x + radius) / state.cw));
      const r0 = Math.max(0, Math.floor((y - radius) / state.ch));
      const r1 = Math.min(state.rows - 1, Math.ceil((y + radius) / state.ch));
      const rr = radius * radius;
      for (let j = r0; j <= r1; j += 1) {
        const dy = state.oy + (j + 0.5) * state.ch - y;
        for (let i = c0; i <= c1; i += 1) {
          const dx = state.ox + (i + 0.5 + (j & 1) * 0.5) * state.cw - x;
          const q = (dx * dx + dy * dy) / rr;
          if (q >= 1) continue;
          const fall = (1 - q) * (1 - q);
          const cell = j * state.cols + i;
          state.heat[cell] = Math.min(1, state.heat[cell] + amount * fall);
        }
      }
    };

    const paint = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx || !state.cols) return;
      ctx.setTransform(state.ratio, 0, 0, state.ratio, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const ink = getComputedStyle(canvas).color;
      ctx.fillStyle = ink;
      ctx.font = state.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // A dot well under its cell: the mark reads as a field of points with
      // gaps between them, not as a drawn stroke.
      const dot = Math.min(state.cw, state.ch) * 0.36;
      const top = RAMP.length - 1;
      const rings = state.rings.map((ring) => {
        const p = ring.t / RING_S;
        const ease = 1 - Math.pow(1 - p, 3);
        return {
          x: ring.x,
          y: ring.y,
          R: 6 + ease * 150,
          amp: 0.7 * (1 - p) * (1 - p) * Math.min(1, p * 6),
        };
      });
      for (let j = 0; j < state.rows; j += 1) {
        const y = state.oy + (j + 0.5) * state.ch;
        for (let i = 0; i < state.cols; i += 1) {
          const cell = j * state.cols + i;
          if (!state.mask[cell]) continue;
          const x = state.ox + (i + 0.5 + (j & 1) * 0.5) * state.cw;
          let heat = state.heat[cell];
          if (state.inside) {
            const q = ((x - state.hx) ** 2 + (y - state.hy) ** 2) / (34 * 34);
            if (q < 1) heat = Math.max(heat, 0.95 * (1 - q) * (1 - q));
          }
          for (const ring of rings) {
            const d = (Math.hypot(x - ring.x, y - ring.y) - ring.R) / 18;
            if (d > -2.5 && d < 2.5) heat += ring.amp * Math.exp(-d * d);
          }
          const level = Math.min(1, heat);
          if (level <= COLD) {
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0.5, dot), 0, Math.PI * 2);
            ctx.fill();
            continue;
          }
          const index = Math.max(1, Math.min(top, Math.round(level * top)));
          ctx.fillText(RAMP[index], x, y);
        }
      }
    };

    const run = () => {
      if (state.raf) return;
      let previous = performance.now();
      const step = (now: number) => {
        const dt = Math.min(0.05, (now - previous) / 1000);
        previous = now;
        const keep = Math.exp(-dt * 2.2);
        let warm = 0;
        for (let i = 0; i < state.heat.length; i += 1) {
          const heat = state.heat[i] * keep;
          state.heat[i] = heat < 0.004 ? 0 : heat;
          if (heat > warm) warm = heat;
        }
        state.rings = state.rings.filter((ring) => (ring.t += dt) < RING_S);
        paint();
        const still = warm === 0 && !state.rings.length && !state.inside;
        state.raf = still ? 0 : window.requestAnimationFrame(step);
      };
      state.raf = window.requestAnimationFrame(step);
    };

    const point = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      const scale = box.width ? W / box.width : 1;
      return {
        x: (event.clientX - box.left) * scale,
        y: (event.clientY - box.top) * scale,
      };
    };

    let lastX = Number.NaN;
    let lastY = Number.NaN;
    const onMove = (event: PointerEvent) => {
      const { x, y } = point(event);
      if (Number.isNaN(lastX)) {
        lastX = x;
        lastY = y;
      }
      const distance = Math.hypot(x - lastX, y - lastY);
      const steps = Math.max(1, Math.ceil(distance / 8));
      for (let i = 1; i <= steps; i += 1) {
        const f = i / steps;
        stamp(lastX + (x - lastX) * f, lastY + (y - lastY) * f, 26, 0.5);
      }
      lastX = x;
      lastY = y;
      state.hx = x;
      state.hy = y;
      state.inside = true;
      run();
    };
    const onLeave = () => {
      state.inside = false;
      lastX = Number.NaN;
      run();
    };
    const onDown = (event: PointerEvent) => {
      // The mark lives inside the card, and the card opens the knowledge base
      // on a press; a press here is for the ring, not for the navigation.
      event.stopPropagation();
      event.preventDefault();
      const { x, y } = point(event);
      state.rings.push({ x, y, t: 0 });
      run();
    };

    // A press here is for the ring; the click that follows must not reach the
    // card, which would open the knowledge base underneath the pointer.
    const swallow = (event: Event) => event.stopPropagation();

    build();
    paint();
    canvas.addEventListener('click', swallow);
    canvas.addEventListener('pointerenter', onMove);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);
    return () => {
      canvas.removeEventListener('click', swallow);
      canvas.removeEventListener('pointerenter', onMove);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      if (state.raf) window.cancelAnimationFrame(state.raf);
      state.raf = 0;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={['drow-glyph', className].filter(Boolean).join(' ')}
      style={{ width: W, height: H }}
      aria-hidden="true"
    />
  );
}

export default KbGlyph;
