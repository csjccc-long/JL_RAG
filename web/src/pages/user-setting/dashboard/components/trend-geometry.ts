/*
 * The curve both views are built from.
 *
 * Catmull-Rom converted to cubic beziers: the line passes through every reading
 * exactly and takes its control points from the neighbours, so nothing is
 * invented and nothing overshoots. The control points are kept rather than
 * thrown away with the path string — reading a point off them is what keeps the
 * scrub dot on the curve instead of beside it, and the terrain view needs the
 * same geometry at every depth or its rows would drift off the line they are
 * supposed to be the same reading of.
 */

export type Pt = { x: number; y: number };

export type Segment = { p1: Pt; p2: Pt; c1: Pt; c2: Pt };

export function segments(points: Pt[]): Segment[] {
  return points.slice(0, -1).map((point, index) => {
    const before = points[index - 1] ?? point;
    const next = points[index + 1];
    const after = points[index + 2] ?? next;

    return {
      p1: point,
      p2: next,
      c1: {
        x: point.x + (next.x - before.x) / 6,
        y: point.y + (next.y - before.y) / 6,
      },
      c2: {
        x: next.x - (after.x - point.x) / 6,
        y: next.y - (after.y - point.y) / 6,
      },
    };
  });
}

export function trace(parts: Segment[]) {
  let d = `M${parts[0].p1.x.toFixed(2)} ${parts[0].p1.y.toFixed(2)}`;

  parts.forEach((segment) => {
    d += ` C${segment.c1.x.toFixed(2)} ${segment.c1.y.toFixed(2)} ${segment.c2.x.toFixed(2)} ${segment.c2.y.toFixed(2)} ${segment.p2.x.toFixed(2)} ${segment.p2.y.toFixed(2)}`;
  });

  return d;
}
export type TrendCurve = {
  d: string;
  /* a point anywhere along the line, at a fractional index */
  at: (u: number) => Pt;
  /* the readings themselves, in plot units */
  points: Pt[];
  /* the clamped control points, so a copy of the line is a transform of it */
  parts: Segment[];
  width: number;
  height: number;
  pad: number;
};

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

export function curve(
  values: number[],
  width: number,
  height: number,
  pad: number,
  /* how far the lowest reading sits above the bottom: the landscape needs the
     room under the line, because that is where its body hangs */
  floor = pad,
): TrendCurve {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const points = values.map((value, index) => ({
    x: values.length === 1 ? 0 : (index / (values.length - 1)) * width,
    y:
      height -
      floor -
      ((value - low) / (high - low || 1)) * (height - pad - floor),
  }));
  /*
   * Held inside the plot: an untouched Catmull-Rom tangent at a step can pull
   * the curve past the level it is stepping up to, and a token count that dips
   * below zero on its way up is a lie the reader has to un-see.
   */
  const parts = segments(points).map((part) => ({
    ...part,
    c1: { ...part.c1, y: clamp(part.c1.y, pad, height - floor) },
    c2: { ...part.c2, y: clamp(part.c2.y, pad, height - floor) },
  }));
  const d = trace(parts);

  /*
   * Anywhere along the line, not just at a reading: the same cubic the path is
   * made of, evaluated at a fractional index. That is why the control points are
   * kept — lerping between two readings would put the dot on the chord, which is
   * beside the curve wherever it bends.
   */
  const at = (u: number) => {
    const index = Math.min(parts.length - 1, Math.max(0, Math.floor(u)));
    const part = parts[index];
    const t = Math.min(1, Math.max(0, u - index));
    const m = 1 - t;

    return {
      x:
        m ** 3 * part.p1.x +
        3 * m * m * t * part.c1.x +
        3 * m * t * t * part.c2.x +
        t ** 3 * part.p2.x,
      y:
        m ** 3 * part.p1.y +
        3 * m * m * t * part.c1.y +
        3 * m * t * t * part.c2.y +
        t ** 3 * part.p2.y,
    };
  };

  return { d, at, points, parts, width, height, pad };
}
