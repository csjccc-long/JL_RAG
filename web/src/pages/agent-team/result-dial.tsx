import type { CSSProperties, RefObject } from 'react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import './result-dial.css';

const Size = 400;
const Center = Size / 2;
const Ink = 'rgb(var(--accent-primary))';
const EyeInk = 'rgb(0 0 0 / 0.85)';
/* 参考图是浅色桃肉 + 深一档的同色投影，换成主题色就是"浅青的身子 + 青的影"。 */
const BodyInk = 'color-mix(in srgb, rgb(var(--accent-primary)) 72%, white)';
/* 卡通立体只靠一层：深色打底 + 浅色往左上偏一点，右下自然留出一道深边。 */
const ShadeInk = 'color-mix(in srgb, rgb(var(--accent-primary)) 78%, black)';

/* 环上只放表情：11 种眼神轮一遍，再补一个回来凑满 12 个位置。 */
export const Expressions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
/* 底部才是形状：参考图那排贴纸（方、菱形、蛋、云、星、心、盾）。 */
export const ShapeChoices = ['squircle', 'diamond', 'egg', 'cloud', 'star', 'heart', 'shield'] as const;

export type DialShape = 'circle' | 'squircle' | 'diamond' | 'egg' | 'cloud' | 'star' | 'heart' | 'shield';

/* 眼睛在脸上左右各偏多少：球面坐标里是"半间距占半径的比例"。
   笑眼这类要明显拉开，否则两弯眉会挤在中间，和参考图差得远。 */
const EyeGap = 0.34;
const WideEyeGap = 0.46;
const smiley = (variant: number) => variant === 2 || variant === 5 || variant === 7 || variant === 11;
const gapOf = (variant: number) => (smiley(variant) ? WideEyeGap : EyeGap);
/* 斜着看时两只眼睛一起歪多少度（到边缘时）。 */
const Tilt = 64;

type Pt = { x: number; y: number };

const round = (value: number) => Math.round(value * 100) / 100;

const polar = (radius: number, degrees: number): Pt => {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return { x: Center + radius * Math.cos(radians), y: Center + radius * Math.sin(radians) };
};

/* Catmull-Rom 转三次贝塞尔，闭合一圈；花和云朵这类轮廓都靠它抹平。 */
const smoothClosed = (points: Pt[]): string => {
  const count = points.length;
  const parts: string[] = ['M ' + round(points[0].x) + ' ' + round(points[0].y)];
  for (let index = 0; index < count; index += 1) {
    const p0 = points[(index - 1 + count) % count];
    const p1 = points[index];
    const p2 = points[(index + 1) % count];
    const p3 = points[(index + 2) % count];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    parts.push(
      'C ' + round(c1.x) + ' ' + round(c1.y) +
      ' ' + round(c2.x) + ' ' + round(c2.y) +
      ' ' + round(p2.x) + ' ' + round(p2.y),
    );
  }
  parts.push('Z');
  return parts.join(' ');
};

/* 圆角多边形：顶点处切一刀、用二次曲线从切口穿过顶点，棱角就被磨圆了。
   星和菱形都靠它——直接连直线是刀尖，这样才是贴纸上那种钝钝的角。 */
const roundedPolygon = (points: Pt[], cut: number): string => {
  const count = points.length;
  let data = '';
  for (let index = 0; index < count; index += 1) {
    const previous = points[(index - 1 + count) % count];
    const corner = points[index];
    const next = points[(index + 1) % count];
    const start = {
      x: corner.x + (previous.x - corner.x) * cut,
      y: corner.y + (previous.y - corner.y) * cut,
    };
    const end = {
      x: corner.x + (next.x - corner.x) * cut,
      y: corner.y + (next.y - corner.y) * cut,
    };
    data += (index === 0 ? 'M ' : ' L ') + round(start.x) + ' ' + round(start.y) +
      ' Q ' + round(corner.x) + ' ' + round(corner.y) + ' ' + round(end.x) + ' ' + round(end.y);
  }
  return data + ' Z';
};

/* 云和盾的轮廓直接从参考图上描下来（沿像素边界走一圈、等距重采样 56 点、
   归一化到 ±1），所以起伏、缺口的比例和图里那块贴纸一致，不靠猜。 */
type Outline = ReadonlyArray<readonly [number, number]>;

const CloudOutline: Outline = [[-0.017, -0.723], [0.084, -0.712], [0.18, -0.685], [0.265, -0.635], [0.342, -0.564], [0.398, -0.481], [0.434, -0.39], [0.488, -0.322], [0.583, -0.35], [0.687, -0.344], [0.778, -0.308], [0.855, -0.246], [0.91, -0.166], [0.945, -0.074], [0.965, 0.024], [0.993, 0.119], [1, 0.222], [0.981, 0.321], [0.945, 0.412], [0.887, 0.49], [0.814, 0.563], [0.729, 0.614], [0.634, 0.64], [0.532, 0.651], [0.43, 0.661], [0.329, 0.675], [0.228, 0.689], [0.128, 0.703], [0.026, 0.714], [-0.077, 0.721], [-0.183, 0.723], [-0.289, 0.723], [-0.396, 0.723], [-0.502, 0.723], [-0.608, 0.723], [-0.709, 0.71], [-0.801, 0.674], [-0.882, 0.613], [-0.943, 0.532], [-0.98, 0.441], [-1, 0.343], [-0.993, 0.239], [-0.98, 0.139], [-0.938, 0.05], [-0.876, -0.031], [-0.793, -0.087], [-0.706, -0.135], [-0.612, -0.164], [-0.606, -0.262], [-0.573, -0.355], [-0.512, -0.436], [-0.429, -0.492], [-0.341, -0.536], [-0.243, -0.557], [-0.177, -0.613], [-0.103, -0.673]];

const ShieldOutline: Outline = [[-0.059, -1], [0.053, -0.992], [0.148, -0.942], [0.237, -0.877], [0.331, -0.827], [0.43, -0.786], [0.528, -0.743], [0.631, -0.712], [0.738, -0.691], [0.844, -0.669], [0.917, -0.599], [0.925, -0.487], [0.925, -0.371], [0.933, -0.259], [0.941, -0.147], [0.941, -0.031], [0.941, 0.084], [0.925, 0.194], [0.894, 0.296], [0.846, 0.392], [0.783, 0.481], [0.713, 0.559], [0.627, 0.63], [0.543, 0.705], [0.459, 0.782], [0.372, 0.852], [0.286, 0.923], [0.195, 0.982], [0.087, 1], [-0.019, 0.977], [-0.117, 0.934], [-0.211, 0.882], [-0.304, 0.827], [-0.399, 0.778], [-0.49, 0.719], [-0.581, 0.659], [-0.667, 0.588], [-0.744, 0.504], [-0.814, 0.418], [-0.862, 0.322], [-0.886, 0.217], [-0.902, 0.108], [-0.909, -0.005], [-0.925, -0.114], [-0.925, -0.229], [-0.933, -0.342], [-0.941, -0.454], [-0.911, -0.557], [-0.814, -0.591], [-0.712, -0.623], [-0.614, -0.666], [-0.516, -0.708], [-0.42, -0.756], [-0.325, -0.805], [-0.236, -0.87], [-0.15, -0.941]];

const outlinePath = (outline: Outline, radius: number): string =>
  smoothClosed(outline.map(([x, y]) => ({ x: x * radius, y: y * radius })));

/* 菱形要"瘦"：先做一个圆角方，转 45°，再横向压到 0.78——角还是圆的，不是尖的。 */
const DiamondTransform = 'scale(0.78 1) rotate(45)';

/* 星：五个角、内径 0.55，所有角都磨圆——参考图那颗星是钝钝的、有点肉感的。 */
const StarPath = (radius: number): string => {
  const points: Pt[] = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2 - Math.PI / 2;
    const reach = index % 2 === 0 ? radius : radius * 0.55;
    points.push({ x: Math.cos(angle) * reach, y: Math.sin(angle) * reach });
  }
  return roundedPolygon(points, 0.2);
};

const HeartPath = (radius: number): string => {
  const r = radius;
  return 'M 0 ' + round(r * 0.8) +
    ' C ' + round(-r * 1.14) + ' ' + round(r * 0.06) + ' ' + round(-r * 0.94) + ' ' + round(-r * 0.8) + ' ' + round(-r * 0.42) + ' ' + round(-r * 0.74) +
    ' C ' + round(-r * 0.12) + ' ' + round(-r * 0.7) + ' 0 ' + round(-r * 0.44) + ' 0 ' + round(-r * 0.26) +
    ' C 0 ' + round(-r * 0.44) + ' ' + round(r * 0.12) + ' ' + round(-r * 0.7) + ' ' + round(r * 0.42) + ' ' + round(-r * 0.74) +
    ' C ' + round(r * 0.94) + ' ' + round(-r * 0.8) + ' ' + round(r * 1.14) + ' ' + round(r * 0.06) + ' 0 ' + round(r * 0.8) +
    ' Z';
};



const EggPath = (radius: number): string => {
  const r = radius;
  return 'M 0 ' + round(-r * 0.98) +
    ' C ' + round(r * 0.56) + ' ' + round(-r * 0.98) + ' ' + round(r * 0.98) + ' ' + round(-r * 0.54) + ' ' + round(r * 0.98) + ' ' + round(r * 0.06) +
    ' C ' + round(r * 0.98) + ' ' + round(r * 0.62) + ' ' + round(r * 0.54) + ' ' + round(r * 0.98) + ' 0 ' + round(r * 0.98) +
    ' C ' + round(-r * 0.54) + ' ' + round(r * 0.98) + ' ' + round(-r * 0.98) + ' ' + round(r * 0.62) + ' ' + round(-r * 0.98) + ' ' + round(r * 0.06) +
    ' C ' + round(-r * 0.98) + ' ' + round(-r * 0.54) + ' ' + round(-r * 0.56) + ' ' + round(-r * 0.98) + ' 0 ' + round(-r * 0.98) +
    ' Z';
};

interface ShapeBodyProps {
  shape: DialShape;
  radius: number;
  fill: string;
  fillOpacity?: number;
}

const pathOf = (shape: DialShape, radius: number): string => {
  if (shape === 'star') return StarPath(radius);
  if (shape === 'heart') return HeartPath(radius);
  if (shape === 'egg') return EggPath(radius);
  if (shape === 'shield') return outlinePath(ShieldOutline, radius);
  return outlinePath(CloudOutline, radius);
};

/* 扁平一块颜色，没有描边——参考图就是靠"一块实色 + 一块偏移实色"立起来的。 */
const ShapeBody = ({ shape, radius, fill, fillOpacity = 1 }: ShapeBodyProps) => {
  if (shape === 'circle') return <circle r={radius} fill={fill} fillOpacity={fillOpacity} />;
  if (shape === 'squircle') {
    return <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} rx={radius * 0.44} fill={fill} fillOpacity={fillOpacity} />;
  }
  if (shape === 'diamond') {
    return (
      <rect
        x={-radius}
        y={-radius}
        width={radius * 2}
        height={radius * 2}
        rx={radius * 0.32}
        fill={fill}
        fillOpacity={fillOpacity}
        transform={DiamondTransform}
      />
    );
  }
  return (
    <path
      d={pathOf(shape, radius)}
      fill={fill}
      fillOpacity={fillOpacity}
      stroke={shape === 'star' || shape === 'shield' ? fill : undefined}
      strokeWidth={shape === 'star' || shape === 'shield' ? radius * 0.07 : undefined}
      strokeLinejoin="round"
    />
  );
};

/* 裁剪 = 外形 ∪ 一块"眼球活动区"。
   只用外形裁时，云朵顶上那道凹口会把路过它的眼睛切掉一块（凹口是轮廓的凹陷，
   眼睛明明还在脸里）；并上一块以眼位为心的圆，凹口就被填平，而外缘仍按外形收，
   所以眼睛只在各自形状的安全半径内活动，不会被切。 */
const EyeField: Record<DialShape, number> = {
  circle: 1,
  squircle: 0.94,
  egg: 0.92,
  diamond: 0.62,
  cloud: 0.86,
  star: 0.6,
  heart: 0.72,
  shield: 0.78,
};

const ShapeClip = ({ shape, radius, id }: { shape: DialShape; radius: number; id: string }) => (
  <clipPath id={id}>
    <circle r={radius * EyeField[shape]} />
    {shape === 'circle' ? <circle r={radius} /> : shape === 'squircle'
      ? <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} rx={radius * 0.44} />
      : shape === 'diamond'
        ? <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} rx={radius * 0.32} transform={DiamondTransform} />
        : <path d={pathOf(shape, radius)} />}
  </clipPath>
);

/* ── 塑形过渡：把任意一个外形摊成同一圈等距采样点 ───────────────
   换形状时不再整块替换，而是把这 96 个点在两套轮廓之间插值——像捏橡皮泥，
   角会先被拉过去、肚子再跟上。所以每个形状都必须能摊成同样多的点：
   圆、圆角方、菱形直接用解析采样，星、心、蛋、云、盾沿 SVG 路径按弧长取点。 */
const MorphSamples = 120;

const resample = (points: Pt[], count: number): Pt[] => {
  const lengths: number[] = [0];
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    total += Math.hypot(next.x - points[index].x, next.y - points[index].y);
    lengths.push(total);
  }
  const out: Pt[] = [];
  let cursor = 0;
  for (let sample = 0; sample < count; sample += 1) {
    const at = (sample / count) * total;
    while (cursor < points.length - 1 && lengths[cursor + 1] < at) cursor += 1;
    const span = lengths[cursor + 1] - lengths[cursor] || 1;
    const t = (at - lengths[cursor]) / span;
    const a = points[cursor];
    const b = points[(cursor + 1) % points.length];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
};

const roundedRectLoop = (radius: number, corner: number): Pt[] => {
  const half = radius;
  const r = Math.min(corner, half);
  const points: Pt[] = [];
  const steps = 14;
  const arc = (cx: number, cy: number, from: number, to: number) => {
    for (let step = 0; step <= steps; step += 1) {
      const angle = ((from + ((to - from) * step) / steps) * Math.PI) / 180;
      points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    }
  };
  for (let y = -half + r; y <= half - r; y += 2) points.push({ x: half, y });
  arc(half - r, half - r, 0, 90);
  for (let x = half - r; x >= -half + r; x -= 2) points.push({ x, y: half });
  arc(-half + r, half - r, 90, 180);
  for (let y = half - r; y >= -half + r; y -= 2) points.push({ x: -half, y });
  arc(-half + r, -half + r, 180, 270);
  for (let x = -half + r; x <= half - r; x += 2) points.push({ x, y: -half });
  arc(half - r, -half + r, 270, 360);
  return resample(points, MorphSamples);
};

const sampleCache = new Map<string, Pt[]>();

/* 把形状摊成 MorphSamples 个等距点（局部坐标、未套 transform）。 */
const faceOutline = (shape: DialShape, radius: number): Pt[] => {
  const key = shape + ':' + radius.toFixed(2);
  const cached = sampleCache.get(key);
  if (cached) return cached;

  let points: Pt[];
  if (shape === 'circle') {
    points = [];
    for (let index = 0; index < MorphSamples; index += 1) {
      const angle = (index / MorphSamples) * Math.PI * 2 - Math.PI / 2;
      points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
  } else if (shape === 'squircle') {
    points = roundedRectLoop(radius, radius * 0.44);
  } else if (shape === 'diamond') {
    /* 菱形 = 圆角方转 45° 再横向压到 0.78，烘焙进点里，过渡时才没有 transform 要一起插值。 */
    const cos = Math.cos(Math.PI / 4);
    const sin = Math.sin(Math.PI / 4);
    points = roundedRectLoop(radius, radius * 0.32).map((point) => {
      const x = point.x * cos - point.y * sin;
      const y = point.x * sin + point.y * cos;
      return { x: x * 0.78, y };
    });
  } else {
    const data = pathOf(shape, radius);
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    node.setAttribute('d', data);
    /* jsdom 没有路径测量：退化成按 d 里的锚点/控制点取点（只有测试会走到这里）。 */
    if (typeof node.getTotalLength !== 'function') {
      const numbers = (data.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const anchors: Pt[] = [];
      for (let index = 0; index + 1 < numbers.length; index += 2) {
        anchors.push({ x: numbers[index], y: numbers[index + 1] });
      }
      points = resample(anchors, MorphSamples);
    } else {
      const total = node.getTotalLength();
      points = [];
      for (let index = 0; index < MorphSamples; index += 1) {
        const point = node.getPointAtLength((index / MorphSamples) * total);
        points.push({ x: point.x, y: point.y });
      }
    }
  }
  sampleCache.set(key, points);
  return points;
};

/* 两点集之间找一圈最省力的错位：星转成心时不要整张脸拧 40°。 */
const alignOutline = (from: Pt[], to: Pt[]): Pt[] => {
  const count = from.length;
  let bestShift = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let shift = 0; shift < count; shift += 2) {
    let score = 0;
    for (let index = 0; index < count; index += 5) {
      const a = from[index];
      const b = to[(index + shift) % count];
      score += (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    }
    if (score < bestScore) {
      bestScore = score;
      bestShift = shift;
    }
  }
  const out: Pt[] = [];
  for (let index = 0; index < count; index += 1) out.push(to[(index + bestShift) % count]);
  return out;
};

const MorphMs = 480;

/* 视频里换形状约 0.47s：头三成时间只走一成（先"吸"一下），中间几乎匀速，
   最后一段收得很慢；没有回弹、没有旋转。 */
const morphEase = (raw: number): number => {
  if (raw < 0.3) return 0.15 * (raw / 0.3) ** 2;
  if (raw < 0.85) return 0.15 + (raw - 0.3) * 0.898;
  return 0.644 + 0.356 * (1 - (1 - (raw - 0.85) / 0.15) ** 2);
};

/* 两套轮廓之间逐点插值；中途沿法线鼓起一点点让边像软的，首尾归零所以两端形状永远精确。 */
export const morphOutline = (from: Pt[], to: Pt[], t: number, radius: number): Pt[] =>
  from.map((point, at) => {
    const x = point.x + (to[at].x - point.x) * t;
    const y = point.y + (to[at].y - point.y) * t;
    const length = Math.hypot(x, y) || 1;
    const wave = Math.sin(at * 0.47 + t * 7.4) * 0.014 * radius * Math.sin(Math.PI * t);
    return { x: x + (x / length) * wave, y: y + (y / length) * wave };
  });

/* 星和心的胖处在偏上，眼睛要跟着抬一点，不然会挤在尖端。 */
const ShapeEyeLift: Record<DialShape, number> = {
  circle: 0,
  squircle: 0,
  diamond: 0,
  egg: 0.02,
  /* 参考图里云的眼睛落在下面那团大弧里，盾的眼睛略高于中线。 */
  cloud: -0.16,
  star: 0.04,
  heart: 0.12,
  shield: 0.06,
};

/* 单只眼睛，画在自己的原点（0,0）上——球面计算只负责把它整体挪到该在的位置。
   十种眼神都是同一套笔画：竖条、圆点、笑眼、平眼、怒眉、半睁、斜看、闭眼笑、细高、厚眼皮。 */
const EyeArt = ({ variant, side, ink, unit: base }: { variant: number; side: number; ink: string; unit: number }) => {
  const unit = base * 1.3;
  const bar = (height = 8.6, width = 4.2) => (
    <rect
      x={-(width * unit) / 2}
      y={-(height * unit) / 2}
      width={width * unit}
      height={height * unit}
      rx={(width * unit) / 2}
      fill={ink}
    />
  );
  const dot = (radius = 2.5) => <circle r={radius * unit} fill={ink} />;
  const smile = (up = true, half = 4.2) => (
    <path
      d={'M ' + round(-half * unit) + ' ' + round((up ? 1.8 : -1.8) * unit) +
        ' q ' + round(half * unit) + ' ' + round((up ? -6.6 : 6.6) * unit) + ' ' + round(half * 2 * unit) + ' 0'}
      stroke={ink}
      strokeWidth={2.4 * unit}
      strokeLinecap="round"
      fill="none"
    />
  );
  const brow = (side: number) => (
    <line
      x1={round(-3.2 * unit)}
      y1={round(side < 0 ? -8.4 * unit : -7.2 * unit)}
      x2={round(3.2 * unit)}
      y2={round(side < 0 ? -7.2 * unit : -8.4 * unit)}
      stroke={ink}
      strokeWidth={1.6 * unit}
      strokeLinecap="round"
    />
  );

  switch (variant % 12) {
    case 0:
      return bar();
    case 1:
      return dot();
    case 2:
      return smile();
    case 3:
      return <rect x={-3.3 * unit} y={-1.2 * unit} width={6.6 * unit} height={2.4 * unit} rx={1.2 * unit} fill={ink} />;
    case 4:
      return (
        <>
          {bar()}
          {brow(side)}
        </>
      );
    case 5:
      return side < 0 ? bar() : smile();
    case 6:
      return <circle cx={1.7 * unit} r={2.4 * unit} fill={ink} />;
    case 7:
      return smile(false);
    case 8:
      return bar(10.4, 3.1);
    case 9:
      return <rect x={-3 * unit} y={-3.6 * unit} width={6 * unit} height={7.2 * unit} rx={3 * unit} fill={ink} />;
    case 11:
      /* 单眼一笑一睁 */
      return (
        <>
          {side < 0 ? smile() : dot(2.8)}
        </>
      );
    default:
      return (
        <>
          {bar(9.4, 5)}
          <line
            x1={round(-5.4 * unit)}
            y1={round(-7.4 * unit)}
            x2={round(5.4 * unit)}
            y2={round(-7.4 * unit)}
            stroke={ink}
            strokeWidth={1.6 * unit}
            strokeLinecap="round"
          />
        </>
      );
  }
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * 球面眼睛：把两只眼睛当成球面上的两个点。
 *
 * 看左时是球在转，所以一只眼睛沿弧线走、靠近边缘的那只被透视压窄、另一只甩得更开；
 * 斜着看时一对眼睛一起歪（Tilt）。
 *
 * 每张脸各看各的：自己隔几秒挑一个方向、停一下、回正，再眨眨眼。频率沿用最初那版，
 * 不要整盘朝同一个方向转头——那样像被一只手统一拎着。
 *
 * 每帧直接写 DOM（transform 与 opacity），不走 React 状态：一次张望不是一次渲染。
 */
const OrbitEyes = ({
  variant,
  unit,
  index,
  layer,
  reach = 1,
  eyeScale = 1,
}: {
  variant: number;
  unit: number;
  index: number;
  /* 这张脸的根节点：贴纸上层靠它上面的两个变量挪位置。 */
  layer: RefObject<SVGGElement | null>;
  /* 视线能走多远：圆脸是整张脸，异形（云、盾、星…）的轮廓更窄，走太远会被裁掉。 */
  reach?: number;
  /* 只放大眼珠、不改变眼距与位置：小头像里表情才看得清。 */
  eyeScale?: number;
}) => {
  const gap = gapOf(variant);
  const eyes = useRef<(SVGGElement | null)[]>([]);

  useEffect(() => {
    const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const radius = 21 * unit;
    const turn = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
    let raf = 0;
    let previous = 0;
    let blinkStart = 0;
    let nextBlink = performance.now() + 1500 + index * 240;

    const paint = (now: number) => {
      let lid = 1;
      if (now > nextBlink) {
        blinkStart = now;
        nextBlink = now + 2400 + Math.random() * 3200;
      }
      const since = now - blinkStart;
      if (since < 160) lid = 1 - 0.9 * Math.sin((since / 160) * Math.PI);

      const asin = (value: number) => Math.asin(clamp(value, -0.92, 0.92));
      const yaw = asin(turn.x);
      const pitch = -asin(turn.y);
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const tilt = Tilt * turn.x * turn.y;

      /* 贴纸上层不按固定轨迹漂——它跟着这张脸的眼神走：
         眼睛往右，上层也往右挪，左边那条厚度就变宽；往左同理。
         基准偏移留 0.62，所以右下那道边永远都在，只是随视线宽窄。 */
      const board = layer.current;
      if (board) {
        board.style.setProperty('--face-lx', clamp(-0.62 + turn.x * 0.55, -0.95, -0.3).toFixed(3));
        board.style.setProperty('--face-ly', clamp(-0.6 + turn.y * 0.55, -0.95, -0.3).toFixed(3));
      }

      for (let side = 0; side < 2; side += 1) {
        const node = eyes.current[side];
        if (!node) continue;
        const base = side === 0 ? -gap : gap;
        /* 眼睛在单位球面上的点，被这次转头带到哪儿 */
        const depth0 = Math.sqrt(1 - base * base);
        const x1 = base * cosY + depth0 * sinY;
        const z1 = -base * sinY + depth0 * cosY;
        const y2 = -z1 * sinP;
        const z2 = z1 * cosP;
        /* 越靠边缘离你越远：整体变小，横着再窄一层 */
        const near = clamp(z2, 0, 1);
        const shade = 0.45 + 0.55 * near;
        const squeeze = shade * (0.7 + 0.3 * near);

        node.setAttribute(
          'transform',
          'translate(' + (x1 * radius).toFixed(2) + ' ' + (y2 * radius).toFixed(2) + ') rotate(' + tilt.toFixed(2) + ')',
        );
        node.style.opacity = z2 < 0.05 ? '0' : '1';
        const inner = node.firstElementChild as SVGGElement | null;
        if (inner) {
          inner.setAttribute('transform', 'scale(' + squeeze.toFixed(3) + ' ' + (shade * lid).toFixed(3) + ')');
        }
      }
    };

    const tick = (now: number) => {
      if (document.hidden) {
        raf = 0;
        previous = 0;
        return;
      }
      const dt = previous ? Math.min(2.5, (now - previous) / 16.67) : 1;
      previous = now;
      if (still) {
        turn.x = turn.tx;
        turn.y = turn.ty;
      } else {
        /* 一根弹簧管两个轴；阻尼按帧数取幂，掉帧时才不会走样 */
        const stiffness = 0.06;
        const damping = 0.274;
        turn.vx += ((turn.tx - turn.x) * stiffness - turn.vx * damping) * dt;
        turn.vy += ((turn.ty - turn.y) * stiffness - turn.vy * damping) * dt;
        turn.x += turn.vx * dt;
        turn.y += turn.vy * dt;
      }
      paint(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const resume = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', resume);

    let glance = 0;
    const look = () => {
      const angle = Math.random() * Math.PI * 2;
      const far = (0.42 + Math.random() * 0.18) * reach;
      turn.tx = Math.cos(angle) * far;
      turn.ty = Math.sin(angle) * far;
      glance = window.setTimeout(() => {
        turn.tx = 0;
        turn.ty = 0;
        glance = window.setTimeout(look, 4200 + Math.random() * 2600);
      }, 900);
    };
    if (!still) glance = window.setTimeout(look, 2200 + index * 330);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', resume);
      window.clearTimeout(glance);
    };
  }, [gap, index, layer, reach, unit]);

  return (
    <g>
      {[0, 1].map((side) => (
        <g
          key={side}
          className="team-dial-eye"
          ref={(node) => {
            eyes.current[side] = node;
          }}
        >
          <g className="team-dial-eye-art">
            <EyeArt variant={variant} side={side === 0 ? -1 : 1} ink={EyeInk} unit={unit * eyeScale} />
          </g>
        </g>
      ))}
    </g>
  );
};

interface FaceProps {
  shape: DialShape;
  variant: number;
  index: number;
  unit?: number;
  faceUnit?: number;
  picked?: boolean;
  center?: boolean;
  onPick?: () => void;
}

/**
 * 一张脸 = 两层同形状实色：底层是影，上层是脸。
 *
 * 上层往哪儿挪，由这张脸的眼睛决定：OrbitEyes 每帧把视线方向写成
 * --face-lx / --face-ly，底层不动，于是偏移那一侧露出影、另一侧露出脸的边——
 * 厚度是"眼睛看出来的"，不是画上去的，也不是整盘一起摆。
 */
const Face = ({ shape, variant, index, unit = 1, faceUnit, picked = false, center = false, onPick }: FaceProps) => {
  const radius = 21 * unit;
  const clipId = 'dial-face-' + useId().replace(/:/g, '');
  /* 这张脸的根节点：眼睛每帧往它上面写偏移方向。 */
  const board = useRef<SVGGElement | null>(null);
  /* 影、脸、裁剪共用同一条轮廓：换形状时三条 d 一起被逐帧改写，所以三者永远对得上。 */
  const skin = useRef<SVGGElement | null>(null);
  const shadePath = useRef<SVGPathElement | null>(null);
  const topPath = useRef<SVGPathElement | null>(null);
  const clipPathRef = useRef<SVGPathElement | null>(null);
  const wasShape = useRef(shape);
  const wasRadius = useRef(radius);
  /* 此刻真正画在屏幕上的那圈点。换形状时从它出发，半路再换就接着揉。 */
  const live = useRef<Pt[]>(faceOutline(shape, radius));
  /* 参考图是一块浅色贴纸 + 一块深色侧面：上层往左上错开一点，右下就露出一条厚度。 */
  const shift = radius * (shape === 'star' || shape === 'cloud' || shape === 'shield' ? 0.11 : 0.085);
  const outline = smoothClosed(faceOutline(shape, radius));

  /* 换形状 = 捏：起手先把"此刻真正画在屏幕上的那圈点"写回去（发生在绘制之前，所以不会闪一下新形状），
     再从这圈点插到新形状。中途又换形状，就从半路接着揉。 */
  useLayoutEffect(() => {
    const fromShape = wasShape.current;
    const fromRadius = wasRadius.current;
    wasShape.current = shape;
    wasRadius.current = radius;
    const elements = [shadePath.current, topPath.current, clipPathRef.current];
    if (!elements[0]) return;

    const end = alignOutline(live.current, faceOutline(shape, radius));
    if (fromShape === shape && fromRadius === radius) {
      live.current = end;
      return;
    }
    const still =
      typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      live.current = end;
      const settled = smoothClosed(end);
      elements.forEach((element) => element?.setAttribute('d', settled));
      return;
    }

    const start = live.current;
    const seed = smoothClosed(start);
    elements.forEach((element) => element?.setAttribute('d', seed));
    const started = performance.now();
    let raf = 0;

    const paint = (now: number) => {
      const raw = Math.min(1, (now - started) / MorphMs);
      const points = morphOutline(start, end, morphEase(raw), radius);
      live.current = points;
      const data = smoothClosed(points);
      elements.forEach((element) => element?.setAttribute('d', data));
      /* 捏的那一下：中点略鼓、略压，收尾回到正形。 */
      const sway = Math.sin(Math.PI * raw);
      skin.current?.setAttribute(
        'transform',
        'scale(' + round(1 + 0.03 * sway) + ' ' + round(1 - 0.035 * sway) + ')',
      );
      if (raw < 1) raf = requestAnimationFrame(paint);
      else {
        live.current = end;
        skin.current?.removeAttribute('transform');
      }
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [shape, radius]);

  return (
    <g
      ref={board}
      className="team-dial-face"
      data-shape={shape}
      data-eyes={variant}
      data-center={center ? 'true' : undefined}
      data-picked={picked ? 'true' : undefined}
      onClick={onPick}
    >
      {picked ? <circle r={radius * 1.42} fill={Ink} fillOpacity={0.16} /> : null}
      <g ref={skin}>
        <path ref={shadePath} d={outline} fill={ShadeInk} />
        <g className="team-dial-top" style={{ '--face-shift': shift + 'px' } as CSSProperties}>
          <path ref={topPath} d={outline} fill={BodyInk} />
        </g>
        <clipPath id={clipId}>
          <circle r={radius * EyeField[shape]} />
          <path ref={clipPathRef} d={outline} />
        </clipPath>
        <g clipPath={'url(#' + clipId + ')'} transform={'translate(0 ' + round(-ShapeEyeLift[shape] * radius) + ')'}>
          <OrbitEyes
            variant={variant}
            unit={faceUnit ?? unit}
            index={index}
            layer={board}
            reach={shape === 'circle' ? 1 : 0.62}
          />
        </g>
      </g>
    </g>
  );
};

/* ── 小头像：给已有智能体一个固定的脸 ─────────────────────
   同一个 id 永远长成同一张脸（形状 + 眼神都从 id 里算），换个地方出现也是它。
   眼睛和圆盘上的一样会自己张望，贴纸上层也跟着眼神挪——一张脸的厚度和它的视线是一回事。 */
const seedOf = (seed: string) => {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const avatarOf = (seed: string): { shape: DialShape; variant: number } => {
  const hash = seedOf(seed);
  return {
    shape: ShapeChoices[hash % ShapeChoices.length],
    variant: Math.floor(hash / ShapeChoices.length) % 12,
  };
};

export const AgentAvatar = ({
  seed,
  size = 28,
  className,
}: {
  seed: string;
  size?: number;
  className?: string;
}) => {
  const { shape, variant } = avatarOf(seed);
  const id = 'avatar-' + useId().replace(/:/g, '');
  const board = useRef<SVGGElement | null>(null);
  const radius = 21;
  const shift = (shape === 'star' || shape === 'cloud' || shape === 'shield' ? 0.1 : 0.08) * radius;
  return (
    <svg
      viewBox="-30 -30 60 60"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-hidden="true"
      focusable="false"
      data-avatar={shape + ':' + variant}
    >
      <g ref={board}>
        <ShapeBody shape={shape} radius={radius} fill={ShadeInk} />
        <g className="team-dial-top" style={{ '--face-shift': shift + 'px' } as CSSProperties}>
          <ShapeBody shape={shape} radius={radius} fill={BodyInk} />
        </g>
        <ShapeClip shape={shape} radius={radius} id={id} />
        <g clipPath={'url(#' + id + ')'} transform={'translate(0 ' + round(-ShapeEyeLift[shape] * radius) + ')'}>
          {/* 小尺寸下眼珠要放大一档，不然 24px 里看不出是哪种表情 */}
          <OrbitEyes
            variant={variant}
            unit={1}
            index={seedOf(seed) % 12}
            layer={board}
            reach={shape === 'circle' ? 1 : 0.62}
            eyeScale={1.34}
          />
        </g>
      </g>
    </svg>
  );
};

const AgentOrbitRadius = 130;

/* 舞台是 440px 见方的 div，里面是 400 单位的 viewBox（缩放 1.1）。
   面板真正露出来的左上角在舞台 (99px, 99px)，换成 viewBox 就是 90 单位：
   右边线 x = 400 - 90 = 310、上边线 y = 90。脸转到这两条线附近就开始糊、变淡。 */
const AgentClipRight = Size - 90;
const AgentClipTop = 90;
/* 羽化从离边 47 单位（约 52px）就开始，贴到边上刚好糊成一团、看不见。 */
const AgentFadeSpan = 47;
/* 模糊比淡出晚一点开始：边缘的脸先变淡，再糊开，否则一离开中心就全是毛毛的。 */
const AgentBlurSpan = 34;
const AgentBlurMax = 2.2;

const RingFaces = Expressions.map((variant, index) => ({
  variant,
  index,
  point: polar(AgentOrbitRadius, (index * 360) / Expressions.length + 12),
}));

/* 底部那排形状：和参考图一样是一块实色 + 偏移投影，没有描边。 */
const ShapeChip = ({ shape, picked, onPick }: { shape: DialShape; picked: boolean; onPick: () => void }) => {
  return (
  <button
    type="button"
    data-shape={shape}
    data-picked={picked ? 'true' : undefined}
    aria-pressed={picked}
    onClick={onPick}
    className="team-dial-chip"
  >
    <svg viewBox="-30 -30 60 60" className="h-[38px] w-[38px]">
      <ShapeBody shape={shape} radius={20} fill={ShadeInk} />
      <g transform="translate(-1.8 -2.1)">
        <ShapeBody shape={shape} radius={20} fill={BodyInk} />
      </g>
    </svg>
  </button>
  );
};

/**
 * 分发盘的占位：四分之三的圆盘，剩下四分之一被面板右上角切走。
 *
 * 环上全是表情，底部一排是形状，中间只负责展示当前选中的组合。
 * 之后任务分发的每条链路（谁派给谁、跑在哪个阶段）都会落在这几圈同心轨道上。
 */
const ResultDial = () => {
  const { t } = useTranslation();
  const [expression, setExpression] = useState(4);
  const [shape, setShape] = useState<DialShape>('cloud');
  const stage = useRef<HTMLDivElement | null>(null);
  const spin = useRef({ angle: 0, dragging: false, moved: false, startX: 0, base: 0, lastDrag: 0 });
  /* 环上每张脸自己的节点：边缘羽化的模糊是逐张算的，不是整块遮罩一刀切。 */
  const agents = useRef<Array<SVGGElement | null>>([]);
  const agentBlur = useRef<number[]>([]);

  /* 转到边缘那几张：越贴边越糊、越淡。参考视频里被裁掉的那一截是糊进背景的。 */
  const featherAgents = (angle: number) => {
    RingFaces.forEach((_, index) => {
      const node = agents.current[index];
      if (!node) return;
      const theta = (((index * 360) / Expressions.length + 12 + angle) - 90) * (Math.PI / 180);
      const x = Center + Math.cos(theta) * AgentOrbitRadius;
      const y = Center + Math.sin(theta) * AgentOrbitRadius;
      const edge = Math.min(AgentClipRight - x, y - AgentClipTop);
      const near = Math.min(1, Math.max(0, (AgentFadeSpan - edge) / AgentFadeSpan));
      const blur = Math.min(1, Math.max(0, (AgentBlurSpan - edge) / AgentBlurSpan)) * AgentBlurMax;
      if (Math.abs(blur - (agentBlur.current[index] ?? 0)) > 0.18) {
        agentBlur.current[index] = blur;
        node.style.filter = blur > 0.18 ? 'blur(' + blur.toFixed(1) + 'px)' : '';
        node.style.opacity = (1 - near * 0.22).toFixed(2);
      }
    });
  };

  /* 环自己慢慢转，鼠标按住可以直接拖；拖动时暂停自转，松手后从当前角度继续。 */
  useEffect(() => {
    const node = stage.current;
    if (!node) return undefined;
    const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let previous = 0;
    let hovered = false;

    const apply = () => {
      node.style.setProperty('--dial-angle', spin.current.angle.toFixed(2) + 'deg');
    };

    const paint = (now: number) => {
      const delta = previous ? Math.min(64, now - previous) : 16;
      previous = now;
      if (!still && !spin.current.dragging && !hovered) spin.current.angle += (delta / 1000) * 3.75;
      apply();
      featherAgents(spin.current.angle);
      raf = requestAnimationFrame(paint);
    };

    const enter = () => {
      hovered = true;
    };
    const leave = () => {
      hovered = false;
    };
    /* 不用 setPointerCapture：它会把随后的 click 重定向到舞台上，
       表情就再也点不中了。改成拖动期间临时挂 window 上的监听。 */
    const move = (event: PointerEvent) => {
      if (!spin.current.dragging) return;
      const dx = event.clientX - spin.current.startX;
      if (Math.abs(dx) > 3) spin.current.moved = true;
      spin.current.angle = spin.current.base + dx * 0.55;
      apply();
    };
    const up = () => {
      if (!spin.current.dragging) return;
      spin.current.dragging = false;
      if (spin.current.moved) spin.current.lastDrag = performance.now();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    const down = (event: PointerEvent) => {
      spin.current.dragging = true;
      spin.current.moved = false;
      spin.current.startX = event.clientX;
      spin.current.base = spin.current.angle;
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };

    raf = requestAnimationFrame(paint);
    node.addEventListener('pointerenter', enter);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('pointerdown', down);
    return () => {
      cancelAnimationFrame(raf);
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  /* 刚拖完的那一下 click 不要当成"选表情"。 */
  const pickExpression = (index: number) => {
    if (performance.now() - spin.current.lastDrag < 300) return;
    setExpression(index);
  };

  return (
    <div data-testid="result-dial" className="pointer-events-none absolute inset-0 select-none">
      <div ref={stage} className="team-dial-stage absolute -right-[99px] -top-[99px] hidden h-[440px] w-[440px] lg:block">
        <svg viewBox={'0 0 ' + Size + ' ' + Size} className="h-full w-full">
          <g className="team-dial-agents">
            {RingFaces.map((face) => (
              <g
                key={face.index}
                transform={'translate(' + round(face.point.x) + ' ' + round(face.point.y) + ')'}
              >
                <g
                  className="team-dial-agent"
                  ref={(node) => {
                    agents.current[face.index] = node;
                  }}
                >
                  <Face
                    shape="circle"
                    variant={face.variant}
                    index={face.index}
                    picked={expression === face.index}
                    onPick={() => pickExpression(face.index)}
                  />
                </g>
              </g>
            ))}
          </g>

          <g transform={'translate(' + Center + ' ' + Center + ')'}>
            <Face
              shape={shape}
              variant={Expressions[expression]}
              index={3}
              unit={shape === 'star' ? 3 : shape === 'heart' ? 2.9 : shape === 'cloud' ? 2.9 : 2.5}
              faceUnit={shape === 'star' ? 1.5 : shape === 'heart' ? 1.9 : 2.5}
              center
            />
          </g>
        </svg>
      </div>

      <div className="pointer-events-auto absolute inset-x-0 top-[352px] hidden flex-wrap justify-center gap-1 px-2 lg:flex">
        {ShapeChoices.map((choice) => (
          <ShapeChip
            key={choice}
            shape={choice}
            picked={shape === choice}
            onPick={() => setShape(choice)}
          />
        ))}
        <p className="w-full pt-1 text-center text-[11px] text-text-secondary">{t('flow.agentTeam.page.dialHint')}</p>
      </div>
    </div>
  );
};

export default ResultDial;
