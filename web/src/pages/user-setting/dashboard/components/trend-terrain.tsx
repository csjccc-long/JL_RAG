/*
 * The range behind the line.
 *
 * The crest is the reading. Everything under it is scenery: a height field
 * drawn row by row, each row a different slice of the same massif, receding
 * toward the axis. Where a slice is tall its line stands alone, far from the
 * next; where it falls the slices all meet the axis and pile into a dense
 * edge. That is the whole of the depth — no perspective tricks, no shading.
 *
 * Each slice is displaced by its own slow ripple, so the rows are a range and
 * not one profile copied down the screen.
 */
import { useMemo } from 'react';

import { Pt, TrendCurve } from './trend-geometry';
import './trend-terrain.css';

type TrendTerrainProps = {
  line: TrendCurve;
  /* the scenery: quieter than the crest, so the data stays the loudest thing */
  fade: string;
  compact?: boolean;
};

type Frame = { rows: number; samples: number; widen: number };

const wideFrame: Frame = { rows: 64, samples: 460, widen: 1.06 };
const narrowFrame: Frame = { rows: 34, samples: 240, widen: 1.03 };

/* the range arrives as layers: each bank is one sheet, nearest first, and every
   sheet rises as a whole rather than its lines growing one by one */
const Banks = 3;
const BankStep = 240;
const BankRise = 820;

/* the crest is not drawn until the range has finished arriving */
export const CrestDelay = (Banks - 1) * BankStep + BankRise + 200;

type Row = { d: string; opacity: number };

type Bank = { key: string; delay: number; rows: Row[] };

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/* a hump with a point on top and a corner in the trough; a max of several is a
   range with summits of different heights and floors that never repeat */
const humps = [
  { rate: 0.032, weight: 1, shift: 0.31 },
  { rate: 0.051, weight: 0.93, shift: 2.17 },
  { rate: 0.079, weight: 0.8, shift: 4.03 },
  { rate: 0.118, weight: 0.63, shift: 1.29 },
  { rate: 0.177, weight: 0.47, shift: 5.61 },
];

const TopHeight = humps.reduce((peak, hump) => Math.max(peak, hump.weight), 0);

const floor = 0.26;

const massif = (x: number) => {
  let height = 0;

  for (const hump of humps) {
    const wave = Math.abs(Math.sin(Math.PI * (hump.rate * x + hump.shift)));
    const value = (1 - wave) * hump.weight;

    if (value > height) height = value;
  }

  return floor + (1 - floor) * (height / TopHeight) ** 0.9;
};

/* a straight-sided tooth, so a face is rock and not a straight edge */
const tooth = (x: number) => {
  const period = 1.28;
  const u = x / period - Math.floor(x / period);

  return 1 - Math.abs(2 * u - 1);
};

/* the height of the range at x, this far back (depth 0 = the far crest) */
const slice = (x: number, depth: number) => {
  const recede = (1 - depth) ** 0.62;

  const n1 = 0.5 + 0.5 * Math.sin(x * 0.83 + depth * 11.7);
  const n2 = 0.5 + 0.5 * Math.sin(x * 1.97 - depth * 7.3 + 1.7);
  const n3 = 0.5 + 0.5 * Math.sin(x * 3.7 + depth * 5.1 + 4.2);
  /* a displaced copy of the massif: same country, different ridge lines */
  const displaced = massif(x + depth * 1.9 + n1 * 0.5) * massif(x * 0.97 + depth * 0.9);
  const ripple = 0.84 + 0.16 * (0.62 * n1 + 0.28 * n2 + 0.1 * n3);
  const grain = (tooth(x + depth * 1.6) - 0.5) * 0.07;

  const raw = clamp(displaced * recede * ripple + grain * recede, 0, 1);

  /* lift the range toward the ceiling without ever flattening a summit: only a
     height of exactly 1 could saturate, and the field never reaches it */
  return 1 - Math.pow(1 - raw, 1.55);
};

const pointsToPath = (points: Pt[]) =>
  points
    .map((point, index) => (index === 0 ? 'M' : 'L') + point.x.toFixed(2) + ' ' + point.y.toFixed(2))
    .join(' ');

function build(line: TrendCurve, frame: Frame): Row[] {
  if (line.parts.length === 0) return [];

  const ground = line.height - 0.5;
  const middle = line.width / 2;

  /* the range sits under the reading: at every x it is given the room between
     the crest and the axis, so it rides the line instead of floating below it */
  const lastIndex = line.points.length - 1;
  const roomAt = (x: number) => Math.max(2, ground - line.at((x / line.width) * lastIndex).y - 1.1);

  const walked = Array.from({ length: frame.samples }, (_, index) => (index / (frame.samples - 1)) * line.width);

  return Array.from({ length: frame.rows }, (_, row) => {
    const depth = row / (frame.rows - 1);
    const scale = 1 + (frame.widen - 1) * depth;

    const points = walked.map((x) => ({
      x: middle + (x - middle) * scale,
      y: ground - slice(x, depth) * roomAt(x),
    }));

    return {
      d: pointsToPath(points),
      /* lines are drawn faint and allowed to overlap: where the range meets the
         axis the pile is the ink, exactly as it is in the reference */
      opacity: clamp(0.2 - 0.09 * depth, 0.07, 0.22),
    };
  });
}

/* split the range into sheets by how near the eye they are: the last rows of the
   field are the ones standing on the axis, so they are the near sheet */
function stack(rows: Row[]): Bank[] {
  if (rows.length === 0) return [];

  const banks: Bank[] = [];

  for (let index = 0; index < Banks; index += 1) {
    const from = Math.floor((index * rows.length) / Banks);
    const to = Math.floor(((index + 1) * rows.length) / Banks);

    /* painted far to near, so a near sheet covers the one behind it */
    banks.push({
      key: 'bank-' + index,
      delay: (Banks - 1 - index) * BankStep,
      rows: rows.slice(from, to),
    });
  }

  return banks;
}

export function TrendTerrain({ line, fade, compact = false }: TrendTerrainProps) {
  const rows = useMemo(
    () => build(line, compact ? narrowFrame : wideFrame),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [line, compact],
  );
  const banks = useMemo(() => stack(rows), [rows]);

  const viewBox = '0 0 ' + line.width + ' ' + line.height;

  return (
    <svg
      className="absolute inset-0 size-full overflow-hidden"
      viewBox={viewBox}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g className="trend-terrain">
        {banks.map((bank) => (
          <g
            key={bank.key}
            className="trend-terrain-bank"
            style={{ animationDelay: bank.delay + 'ms' }}
          >
            {bank.rows.map((row, index) => (
              <path
                key={bank.key + '-' + index}
                d={row.d}
                fill="none"
                stroke={fade}
                strokeWidth={1}
                strokeOpacity={row.opacity}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}