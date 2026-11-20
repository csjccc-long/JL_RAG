import { useEffect, useRef } from 'react';

import './search-lens.css';

/**
 * The magnifier is the product logo, drawn as a field of dots — not a circle
 * laid over the logo. It rides the very window the veil opens (same size, same
 * place, same growth), so the wiped area and the lens are one shape.
 *
 * The silhouette comes from the same mask the veil uses: the image's alpha is
 * sampled on a hex grid and a dot is kept wherever the logo is solid.
 */
const MASK_SRC = '/logo-mask-soft.png';
const DOT_STEP = 4.2;

type Point = { x: number; y: number };

const sampleLogo = (image: HTMLImageElement, width: number, height: number): Point[] => {
  const size = Math.max(1, Math.round(Math.max(width, height)));
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const octx = off.getContext('2d');
  if (!octx) return [];
  const scale = Math.min(size / image.width, size / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  octx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
  let data: Uint8ClampedArray;
  try {
    data = octx.getImageData(0, 0, size, size).data;
  } catch {
    return [];
  }
  const points: Point[] = [];
  let row = 0;
  for (let y = 0; y < size; y += DOT_STEP * 0.88) {
    const offset = row % 2 === 0 ? 0 : DOT_STEP / 2;
    for (let x = 0; x < size; x += DOT_STEP) {
      const px = Math.round(x + offset);
      if (px >= size) continue;
      const alpha = data[(Math.round(y) * size + px) * 4 + 3];
      if (alpha > 120) points.push({ x: px, y });
    }
    row += 1;
  }
  return points;
};

export function SearchLens({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let alive = true;
    let points: Point[] = [];
    let colour = '#38d6c2';
    let raf = 0;
    let width = 0;
    let height = 0;

    const paint = () => {
      raf = 0;
      if (!alive) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (!points.length) return;
      const scale = Math.max(1, Math.round(Math.max(width, height)));
      const sx = width / scale;
      const sy = height / scale;
      ctx.fillStyle = colour;
      const radius = Math.max(0.9, Math.min(1.6, width / 210));
      for (const point of points) {
        ctx.globalAlpha = 0.34 + 0.5 * (point.y / Math.max(1, height));
        ctx.beginPath();
        ctx.ellipse(point.x * sx, point.y * sy, radius, radius, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(paint);
    };

    const relayout = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      colour = window.getComputedStyle(canvas).color || colour;
      if (image.complete && image.naturalWidth) {
        points = sampleLogo(image, width, height);
        schedule();
      }
    };

    const image = new Image();
    image.decoding = 'async';
    image.src = MASK_SRC;
    image.onload = () => {
      if (!alive) return;
      relayout();
    };

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(relayout) : null;
    observer?.observe(canvas);
    relayout();

    return () => {
      alive = false;
      if (raf) window.cancelAnimationFrame(raf);
      observer?.disconnect();
      image.onload = null;
    };
  }, []);

  return (
    <div aria-hidden="true" className={className ? 'slens ' + className : 'slens'}>
      <canvas ref={canvasRef} />
    </div>
  );
}

export default SearchLens;
