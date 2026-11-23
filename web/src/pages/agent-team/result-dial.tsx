import type { CSSProperties } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
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

/* 云：几团圆叠在一起，沿射线取"最远摸得到的边"，得到一条没有接缝的云轮廓。
   上面三团（左小、中间大、右中），下面两团撑出平底，和参考图那块云一致。 */
const CloudPath = (radius: number): string => {
  const r = radius;
  const puffs = [
    { x: -r * 0.62, y: r * 0.04, r: r * 0.38 },
    { x: r * 0.0, y: -r * 0.26, r: r * 0.5 },
    { x: r * 0.6, y: r * 0.02, r: r * 0.4 },
    { x: -r * 0.32, y: r * 0.26, r: r * 0.42 },
    { x: r * 0.3, y: r * 0.26, r: r * 0.4 },
  ];
  const samples = 180;
  const points: Pt[] = [];
  for (let index = 0; index < samples; index += 1) {
    const angle = (index / samples) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let reach = r * 0.2;
    for (const puff of puffs) {
      const projection = dx * puff.x + dy * puff.y;
      const gap = puff.x * puff.x + puff.y * puff.y - projection * projection;
      const inside = puff.r * puff.r - gap;
      if (inside <= 0) continue;
      const edge = projection + Math.sqrt(inside);
      if (edge > reach) reach = edge;
    }
    points.push({ x: dx * reach, y: dy * reach });
  }
  return smoothClosed(points);
};

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

/* 盾牌：上缘微拱、两侧收到底部一个圆点，参考图里那块盾。 */
const ShieldPath = (radius: number): string => {
  const r = radius;
  return 'M ' + round(-r * 0.76) + ' ' + round(-r * 0.72) +
    ' Q 0 ' + round(-r * 1.02) + ' ' + round(r * 0.76) + ' ' + round(-r * 0.72) +
    ' C ' + round(r * 0.84) + ' ' + round(-r * 0.4) + ' ' + round(r * 0.8) + ' ' + round(-r * 0.06) + ' ' + round(r * 0.66) + ' ' + round(r * 0.28) +
    ' C ' + round(r * 0.5) + ' ' + round(r * 0.62) + ' ' + round(r * 0.26) + ' ' + round(r * 0.86) + ' 0 ' + round(r * 0.96) +
    ' C ' + round(-r * 0.26) + ' ' + round(r * 0.86) + ' ' + round(-r * 0.5) + ' ' + round(r * 0.62) + ' ' + round(-r * 0.66) + ' ' + round(r * 0.28) +
    ' C ' + round(-r * 0.8) + ' ' + round(-r * 0.06) + ' ' + round(-r * 0.84) + ' ' + round(-r * 0.4) + ' ' + round(-r * 0.76) + ' ' + round(-r * 0.72) +
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
  if (shape === 'shield') return ShieldPath(radius);
  return CloudPath(radius);
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

/* 尖角形状（星、心）收不住眼睛，用同一块外形做裁剪，眼睛只出现在脸里面。 */
const ShapeClip = ({ shape, radius, id }: { shape: DialShape; radius: number; id: string }) => (
  <clipPath id={id}>
    {shape === 'circle' ? <circle r={radius} /> : shape === 'squircle'
      ? <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} rx={radius * 0.44} />
      : shape === 'diamond'
        ? <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} rx={radius * 0.32} transform={DiamondTransform} />
        : <path d={pathOf(shape, radius)} />}
  </clipPath>
);

/* 星和心的胖处在偏上，眼睛要跟着抬一点，不然会挤在尖端。 */
const ShapeEyeLift: Record<DialShape, number> = {
  circle: 0,
  squircle: 0,
  diamond: 0,
  egg: 0.02,
  cloud: 0.02,
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
const OrbitEyes = ({ variant, unit, index }: { variant: number; unit: number; index: number }) => {
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
      const far = 0.42 + Math.random() * 0.18;
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
  }, [gap, index, unit]);

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
            <EyeArt variant={variant} side={side === 0 ? -1 : 1} ink={EyeInk} unit={unit} />
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
 * 上层跟着光的方向平移（--dial-lx / --dial-ly 由舞台每帧写），底层不动，
 * 于是偏移那一侧露出影、另一侧露出脸的边——阴影的变动是"挪出来的"，不是画上去的。
 * 眼睛和上层一起走，所以光一偏，眼神也跟着偏。
 */
const Face = ({ shape, variant, index, unit = 1, faceUnit, picked = false, center = false, onPick }: FaceProps) => {
  const radius = 21 * unit;
  const clipId = 'dial-face-' + useId().replace(/:/g, '');
  /* 参考图是一块浅色贴纸 + 一块深色侧面：上层往左上错开一点，右下就露出一条厚度。 */
  const shift = radius * (shape === 'star' || shape === 'cloud' || shape === 'shield' ? 0.11 : 0.085);
  return (
    <g
      className="team-dial-face"
      data-shape={shape}
      data-eyes={variant}
      data-center={center ? 'true' : undefined}
      data-picked={picked ? 'true' : undefined}
      onClick={onPick}
    >
      {picked ? <circle r={radius * 1.42} fill={Ink} fillOpacity={0.16} /> : null}
      <ShapeBody shape={shape} radius={radius} fill={ShadeInk} />
      <g className="team-dial-top" style={{ '--face-shift': shift + 'px' } as CSSProperties}>
        <ShapeBody shape={shape} radius={radius} fill={BodyInk} />
      </g>
      <ShapeClip shape={shape} radius={radius} id={clipId} />
      <g clipPath={'url(#' + clipId + ')'} transform={'translate(0 ' + round(-ShapeEyeLift[shape] * radius) + ')'}>
        <OrbitEyes variant={variant} unit={faceUnit ?? unit} index={index} />
      </g>
    </g>
  );
};

const AgentOrbitRadius = 130;

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
      /* 光慢慢摆：上层贴纸跟着偏，右下的厚度就一宽一窄。
         眼睛不跟这束光走——每张脸各自张望，两者互不牵连。 */
      const seconds = now / 1000;
      const lx = still ? -0.6 : -(0.55 + Math.sin(seconds * 0.42) * 0.45);
      const ly = still ? -0.55 : -(0.5 + Math.sin(seconds * 0.27 + 1.2) * 0.4);
      node.style.setProperty('--dial-lx', lx.toFixed(3));
      node.style.setProperty('--dial-ly', ly.toFixed(3));
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
                <g className="team-dial-agent">
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
              unit={shape === 'star' ? 3 : shape === 'heart' ? 2.9 : 2.5}
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
