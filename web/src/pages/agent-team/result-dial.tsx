import { useEffect, useRef, useState } from 'react';

import { AgentOrbit, AgentPresets, type AgentShape } from './agent-presets';
import './result-dial.css';

const Size = 400;
const Center = Size / 2;
const Ink = 'rgb(var(--accent-primary))';

const RingRadius = [196, 150, 104, 60];
const LaneRadius = [176, 128];

/* 眼睛在脸上左右各偏多少：球面坐标里是"半间距占半径的比例"。 */
const EyeGap = 0.3;
/* 斜着看时两只眼睛一起歪多少度（到边缘时）。 */
const Tilt = 64;

type Pt = { x: number; y: number };

const round = (value: number) => Math.round(value * 100) / 100;

const polar = (radius: number, degrees: number): Pt => {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return { x: Center + radius * Math.cos(radians), y: Center + radius * Math.sin(radians) };
};

const arc = (radius: number, from: number, to: number) => {
  const start = polar(radius, from);
  const end = polar(radius, to);
  const large = to - from > 180 ? 1 : 0;
  return 'M ' + round(start.x) + ' ' + round(start.y) + ' A ' + radius + ' ' + radius + ' 0 ' + large + ' 1 ' + round(end.x) + ' ' + round(end.y);
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

/* 六瓣花：采样"从花心朝外看最远能摸到哪"，得到一条完整外轮廓；
   叠圆做花会在花瓣内部留下接缝，这条不会。 */
const FlowerPath = (radius: number): string => {
  const lobes = 6;
  const petal = radius * 0.44;
  const distance = radius * 0.56;
  const samples = 168;
  const points: Pt[] = [];
  for (let index = 0; index < samples; index += 1) {
    const angle = (index / samples) * Math.PI * 2;
    let reach = radius * 0.5;
    for (let lobe = 0; lobe < lobes; lobe += 1) {
      const phi = (lobe / lobes) * Math.PI * 2;
      const delta = angle - phi;
      const inside = petal * petal - distance * distance * Math.sin(delta) ** 2;
      if (inside <= 0) continue;
      const edge = distance * Math.cos(delta) + Math.sqrt(inside);
      if (edge > reach) reach = edge;
    }
    points.push({ x: Math.cos(angle) * reach, y: Math.sin(angle) * reach });
  }
  return smoothClosed(points);
};

const StarPath = (radius: number): string => {
  const points: Pt[] = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2 - Math.PI / 2;
    const reach = index % 2 === 0 ? radius : radius * 0.48;
    points.push({ x: Math.cos(angle) * reach, y: Math.sin(angle) * reach });
  }
  return points
    .map((point, index) => (index === 0 ? 'M ' : 'L ') + round(point.x) + ' ' + round(point.y))
    .join(' ') + ' Z';
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
  shape: AgentShape;
  radius: number;
  fill: string;
  fillOpacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
}

const ShapeBody = ({ shape, radius, fill, fillOpacity = 1, stroke, strokeOpacity = 1, strokeWidth = 0 }: ShapeBodyProps) => {
  const shared = {
    fill,
    fillOpacity,
    stroke: stroke || fill,
    strokeOpacity,
    strokeWidth,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  };
  if (shape === 'circle') return <circle r={radius} {...shared} />;
  if (shape === 'squircle') {
    return <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} rx={radius * 0.44} {...shared} />;
  }
  if (shape === 'star') return <path d={StarPath(radius)} {...shared} />;
  if (shape === 'heart') return <path d={HeartPath(radius)} {...shared} />;
  if (shape === 'egg') return <path d={EggPath(radius)} {...shared} />;
  return <path d={FlowerPath(radius)} {...shared} />;
};

/* 单只眼睛，画在自己的原点（0,0）上——球面计算只负责把它整体挪到该在的位置。
   十种眼神都是同一套笔画：竖条、圆点、笑眼、平眼、怒眉、半睁、斜看、闭眼笑、细高、厚眼皮。 */
const EyeArt = ({ variant, side, ink, unit: base }: { variant: number; side: number; ink: string; unit: number }) => {
  const unit = base * 1.18;
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

  switch (variant % 11) {
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
 * 自动张望的眼睛：把两只眼睛当成球面上的两个点。
 *
 * 看左时是球在转，所以一只眼睛沿弧线走、靠近边缘的那只被透视压窄、另一只甩得更开；
 * 斜着看时一对眼睛一起歪（Tilt）。没有鼠标跟随——没人理它的时候它自己每隔几秒
 * 随便看一个方向、停一下、回正，再眨眨眼。
 *
 * 每帧直接写 DOM（transform 与 opacity），不走 React 状态：一次张望不是一次渲染。
 */
const OrbitEyes = ({ variant, ink, unit, index }: { variant: number; ink: string; unit: number; index: number }) => {
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
        const base = side === 0 ? -EyeGap : EyeGap;
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
  }, [index, unit]);

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
            <EyeArt variant={variant} side={side === 0 ? -1 : 1} ink={ink} unit={unit} />
          </g>
        </g>
      ))}
    </g>
  );
};

interface FaceProps {
  shape: AgentShape;
  variant: number;
  index: number;
  unit?: number;
  picked?: boolean;
  onPick?: () => void;
}

const Face = ({ shape, variant, index, unit = 1, picked = false, onPick }: FaceProps) => {
  const radius = 21 * unit;
  return (
    <g
      className="team-dial-face"
      data-shape={shape}
      data-picked={picked ? 'true' : undefined}
      onClick={onPick}
    >
      {picked ? <circle r={radius * 1.38} fill={Ink} fillOpacity={0.12} /> : null}
      <ShapeBody shape={shape} radius={radius * 1.1} fill="var(--bg-base)" />
      <g transform={'translate(' + round(1.9 * unit) + ' ' + round(2.6 * unit) + ')'}>
        <ShapeBody shape={shape} radius={radius} fill={Ink} fillOpacity={0.46} />
      </g>
      <ShapeBody
        shape={shape}
        radius={radius}
        fill={Ink}
        fillOpacity={0.18}
        stroke={Ink}
        strokeOpacity={0.62}
        strokeWidth={1.2}
      />
      <OrbitEyes variant={variant} ink="rgb(var(--text-primary))" unit={unit} index={index} />
      {picked ? (
        <circle r={radius * 1.24} fill="none" stroke={Ink} strokeOpacity={0.9} strokeWidth={1.6} />
      ) : null}
    </g>
  );
};

const Agents = AgentPresets.map((agent, index) => ({
  ...agent,
  point: polar(AgentOrbit, (index * 360) / AgentPresets.length + 12),
}));

/**
 * 分发盘的占位：四分之三的圆盘，剩下四分之一被面板右上角切走。
 *
 * 刻度、虚线轨道都去掉了，只留纯色圆环和一圈可点选的 agent。
 * 之后任务分发的每条链路（谁派给谁、跑在哪个阶段）都会落在这几圈同心轨道上。
 */
const ResultDial = () => {
  const [picked, setPicked] = useState(AgentPresets[0].id);
  return (
    <div
      aria-hidden
      data-testid="result-dial"
      className="team-dial pointer-events-none absolute -right-[99px] -top-[99px] hidden h-[440px] w-[440px] select-none lg:block"
    >
      <svg viewBox={'0 0 ' + Size + ' ' + Size} className="h-full w-full">
        <g className="team-dial-rings" fill="none" stroke="currentColor">
          {RingRadius.map((radius, index) => (
            <circle
              key={radius}
              cx={Center}
              cy={Center}
              r={radius}
              strokeWidth={index === 0 ? 1.2 : 0.8}
              strokeOpacity={index === 0 ? 0.38 : 0.16}
            />
          ))}
        </g>

        <circle cx={Center} cy={Center} r={RingRadius[3]} fill={Ink} fillOpacity={0.05} />

        <path
          d={arc(RingRadius[0], 90, 360)}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeOpacity={0.46}
          strokeLinecap="round"
        />

        <path
          d={arc(LaneRadius[1], 96, 354)}
          fill="none"
          stroke={Ink}
          strokeWidth={2.4}
          strokeOpacity={0.55}
          strokeLinecap="round"
        />

        <g className="team-dial-agents">
          {Agents.map((agent, index) => (
            <g
              key={agent.id}
              transform={'translate(' + round(agent.point.x) + ' ' + round(agent.point.y) + ')'}
            >
              <g className="team-dial-agent">
                <Face
                  shape={agent.shape}
                  variant={agent.face}
                  index={index}
                  picked={picked === agent.id}
                  onPick={() => setPicked(agent.id)}
                />
              </g>
            </g>
          ))}
        </g>

        <g transform={'translate(' + Center + ' ' + Center + ')'}>
          <Face shape="flower" variant={4} index={3} unit={2.5} />
        </g>
      </svg>
    </div>
  );
};

export default ResultDial;
