import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';

import './mosaic-reveal.css';

export type MosaicRevealProps = {
  children: ReactNode;
  className?: string;
};

/** Base size of one mosaic cell, in CSS pixels. */
const CELL_PX = 14;
const MIN_COLS = 8;
const MAX_COLS = 24;
const MIN_ROWS = 6;
const MAX_ROWS = 16;
/** The last cell has cleared by then; the tile layer is dropped after it. */
const HOLD_MS = 1750;
/** Spread of the clearing, before the few lingering cells. */
const SCATTER_MS = 860;
/** A handful of cells stay behind for another beat, like the reference. */
const LINGER_MS = 460;

const LATTICE_X = 6;
const LATTICE_Y = 4;

type Cell = {
  key: string;
  delay: number;
  duration: number;
  ink: number;
  scale: number;
  blink: boolean;
  dx: number;
  dy: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Deterministic value in [0, 1): the same card always dissolves the same way. */
const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** Smooth 2D value noise: nearby cells share a patch value, so they clear together. */
const patchField = (u: number, v: number) => {
  const x = u * (LATTICE_X - 1);
  const y = v * (LATTICE_Y - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * sx;
  const bottom =
    hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * sx;
  return top + (bottom - top) * sy;
};

const buildCells = (cols: number, rows: number) => {
  const cells: Cell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const patch = patchField((col + 0.5) / cols, (row + 0.5) / rows);
      const grain = hash(col + 17, row + 31);
      const kind = hash(col + 91, row + 7);
      // Patches decide the broad order, grain keeps neighbours from moving as one.
      const order = clamp(patch * 0.62 + grain * 0.38, 0, 1);
      let delay = SCATTER_MS * Math.pow(order, 1.45);
      if (kind > 0.9) delay += LINGER_MS * (0.35 + kind);
      cells.push({
        key: col + '-' + row,
        delay: Math.round(delay),
        duration: Math.round(250 + grain * 430),
        ink: Math.round(3 + patch * 10 + grain * 22),
        scale: 1 + (kind > 0.62 ? 0.15 + hash(col + 3, row + 5) * 0.45 : 0),
        blink: kind > 0.82,
        // Nudged off the lattice, so the cells never read as a regular grid.
        dx: (hash(col + 71, row + 23) - 0.5) * 0.55,
        dy: (hash(col + 11, row + 53) - 0.5) * 0.55,
      });
    }
  }
  return cells;
};

/**
 * A card arriving on the page: it starts as a bed of blurred, uneven mosaic cells
 * and resolves into itself. Cells differ in size, tone and the moment they go, so
 * they clear in patches rather than in one sweep, and a few linger a beat longer -
 * the transition keeps changing shape instead of sliding one uniform curtain.
 */
export function MosaicReveal({ children, className = '' }: MosaicRevealProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [grid, setGrid] = useState<{ cols: number; rows: number; cells: Cell[] }>({
    cols: 0,
    rows: 0,
    cells: [],
  });
  const [revealing, setRevealing] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      setFinished(true);
      return undefined;
    }
    const host = hostRef.current;
    if (!host) return undefined;
    const rect = host.getBoundingClientRect();
    const cols = clamp(Math.round(rect.width / CELL_PX), MIN_COLS, MAX_COLS);
    const rows = clamp(Math.round(rect.height / CELL_PX), MIN_ROWS, MAX_ROWS);
    setGrid({ cols, rows, cells: buildCells(cols, rows) });
    let raf = 0;
    let timer = 0;
    // The cells must exist for one painted frame before they start clearing,
    // otherwise the first paint already catches them halfway gone.
    raf = requestAnimationFrame(() => {
      setRevealing(true);
      timer = window.setTimeout(() => setFinished(true), HOLD_MS);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, []);

  const withCells = revealing && !finished && grid.cells.length > 0;

  return (
    <div
      ref={hostRef}
      className={`mosaic-reveal ${finished ? 'mosaic-reveal--finished' : ''} ${className}`.trim()}
    >
      <div className="mosaic-reveal__content">{children}</div>
      {withCells ? (
        <div
          className="mosaic-reveal__grid"
          aria-hidden="true"
          style={{
            ['--cols' as string]: grid.cols,
            ['--rows' as string]: grid.rows,
          }}
        >
          {grid.cells.map((cell) => (
            <i
              key={cell.key}
              className={`mosaic-reveal__cell ${cell.blink ? 'mosaic-reveal__cell--blink' : ''}`.trim()}
              style={{
                ['--delay' as string]: cell.delay + 'ms',
                ['--dur' as string]: cell.duration + 'ms',
                ['--ink' as string]: cell.ink,
                ['--cell-scale' as string]: cell.scale.toFixed(2),
                ['--dx' as string]: cell.dx.toFixed(3),
                ['--dy' as string]: cell.dy.toFixed(3),
              } as CSSProperties}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
