import { AgentOrbit, AgentPresets } from './agent-presets';
import './result-dial.css';

const Size = 400;
const Center = Size / 2;

const polar = (radius: number, degrees: number) => {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return {
    x: Center + radius * Math.cos(radians),
    y: Center + radius * Math.sin(radians),
  };
};

const arc = (radius: number, from: number, to: number) => {
  const start = polar(radius, from);
  const end = polar(radius, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} 1 ${end.x} ${end.y}`;
};

const RingRadius = [196, 150, 104, 60];
const LaneRadius = [176, 128];
const Ticks = Array.from({ length: 72 }, (_, index) => index);

/* 每个预置 agent 只用眼睛区分：同一套画法，六种眼神。
   预置列表将来换成真实 agent 头像时，只要把 <Face> 换成 <image>。 */
const EyeVariants = 6;

const Eyes = ({ variant, ink, unit }: { variant: number; ink: string; unit: number }) => {
  const dx = 6.2 * unit;
  const dy = -1.2 * unit;
  const bar = (side: number) => (
    <rect
      key={side}
      x={side * dx - 2.1 * unit}
      y={dy - 4.2 * unit}
      width={4.2 * unit}
      height={8.4 * unit}
      rx={2.1 * unit}
      fill={ink}
    />
  );
  const arc = (up: boolean) => (
    <path
      d={
        up
          ? 'M ' + (-dx - 4 * unit) + ' ' + (dy + 1.4 * unit) +
            ' q ' + 4 * unit + ' ' + -6 * unit + ' ' + 8 * unit + ' 0'
          : 'M ' + (-dx - 4 * unit) + ' ' + (dy - 1.4 * unit) +
            ' q ' + 4 * unit + ' ' + 6 * unit + ' ' + 8 * unit + ' 0'
      }
      stroke={ink}
      strokeWidth={2.4 * unit}
      strokeLinecap="round"
      fill="none"
    />
  );

  switch (variant % EyeVariants) {
    case 0:
      return <>{bar(-1)}{bar(1)}</>;
    case 1:
      return (
        <>
          <circle cx={-dx} cy={dy} r={2.5 * unit} fill={ink} />
          <circle cx={dx} cy={dy} r={2.5 * unit} fill={ink} />
        </>
      );
    case 2:
      return (
        <>
          {arc(true)}
          <g transform={'translate(' + 2 * dx + ' 0)'}>{arc(true)}</g>
        </>
      );
    case 3:
      return (
        <>
          <rect x={-dx - 3.2 * unit} y={dy - 1.3 * unit} width={6.4 * unit} height={2.6 * unit} rx={1.3 * unit} fill={ink} />
          <rect x={dx - 3.2 * unit} y={dy - 1.3 * unit} width={6.4 * unit} height={2.6 * unit} rx={1.3 * unit} fill={ink} />
        </>
      );
    case 4:
      return (
        <>
          {bar(-1)}
          {bar(1)}
          <path
            d={'M ' + (-dx - 5 * unit) + ' ' + (dy - 6.6 * unit) + ' L ' + (-dx + 4 * unit) + ' ' + (dy - 3.4 * unit)}
            stroke={ink}
            strokeWidth={1.8 * unit}
            strokeLinecap="round"
          />
          <path
            d={'M ' + (dx + 5 * unit) + ' ' + (dy - 6.6 * unit) + ' L ' + (dx - 4 * unit) + ' ' + (dy - 3.4 * unit)}
            stroke={ink}
            strokeWidth={1.8 * unit}
            strokeLinecap="round"
          />
        </>
      );
    default:
      return (
        <>
          {bar(-1)}
          <g transform={'translate(' + 2 * dx + ' 0)'}>{arc(true)}</g>
        </>
      );
  }
};

const Face = ({ variant, ink, face, edge, unit = 1 }: {
  variant: number;
  ink: string;
  face: string;
  edge: string;
  unit?: number;
}) => {
  const r = 21 * unit;
  return (
    <>
      {/* 不透明的底：头像坐在轨道上时，下面的弧线不该从脸里穿过去 */}
      <circle cx={0} cy={0} r={r} fill="var(--bg-base)" fillOpacity={0.96} />
      <circle
        cx={0}
        cy={0}
        r={r}
        fill={face}
        fillOpacity={0.16}
        stroke={edge}
        strokeOpacity={0.55}
        strokeWidth={1.2}
      />
      <Eyes variant={variant} ink={ink} unit={unit} />
    </>
  );
};

const Agents = AgentPresets.map((agent, index) => ({
  ...agent,
  point: polar(AgentOrbit, (index * 360) / AgentPresets.length + 12),
}));


/**
 * 分发盘的占位：四分之三的圆盘，剩下四分之一被面板右上角切走。
 *
 * 之后任务分发的每条链路（谁派给谁、跑在哪个阶段）都会落在这几圈同心轨道上，
 * 所以现在先把刻度、轨道和外圈扫掠画出来，尺寸与角度都以这里为准。
 */
const ResultDial = () => (
  <div
    aria-hidden
    data-testid="result-dial"
    className="team-dial pointer-events-none absolute -right-[99px] -top-[99px] h-[440px] w-[440px] select-none"
  >
    <svg viewBox={`0 0 ${Size} ${Size}`} className="h-full w-full">
      <defs>
        <radialGradient id="dial-face" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="currentColor" stopOpacity="0" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.14" />
        </radialGradient>
      </defs>

      <circle cx={Center} cy={Center} r={RingRadius[0]} fill="url(#dial-face)" />

      <g className="team-dial-rings" fill="none" stroke="currentColor">
        {RingRadius.map((radius, index) => (
          <circle
            key={radius}
            cx={Center}
            cy={Center}
            r={radius}
            strokeWidth={index === 0 ? 1.2 : 0.8}
            strokeOpacity={index === 0 ? 0.4 : 0.22}
          />
        ))}
      </g>

      <g className="team-dial-sweep" fill="none" stroke="currentColor">
        {LaneRadius.map((radius) => (
          <circle
            key={radius}
            cx={Center}
            cy={Center}
            r={radius}
            strokeWidth={1}
            strokeOpacity={0.34}
            strokeDasharray="2 9"
          />
        ))}
      </g>


      {/* 预置 agent 排在第二圈上：整圈缓慢旋转，每个头像反向自转保持正脸，
          所以被右上角切掉的那几个会随着转动露出来 */}
      <g className="team-dial-agents">
        {Agents.map((agent) => (
          <g
            key={agent.id}
            transform={'translate(' + agent.point.x + ' ' + agent.point.y + ')'}
          >
            <g className="team-dial-agent">
              <Face
                variant={agent.face}
                ink="rgb(var(--accent-primary))"
                face="rgb(var(--accent-primary))"
                edge="rgb(var(--accent-primary))"
              />
            </g>
          </g>
        ))}
      </g>

      <g stroke="currentColor" strokeLinecap="round">
        {Ticks.map((tick) => {
          const angle = tick * 5;
          const major = tick % 6 === 0;
          const outer = polar(RingRadius[0], angle);
          const inner = polar(RingRadius[0] - (major ? 16 : 8), angle);
          return (
            <line
              key={tick}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              strokeWidth={major ? 1.6 : 0.8}
              strokeOpacity={major ? 0.5 : 0.2}
            />
          );
        })}
      </g>

      <path
        d={arc(RingRadius[0], 90, 360)}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeOpacity={0.42}
        strokeLinecap="round"
      />

      {/* the accent arc is where a dispatch round will be drawn: a quarter is
          left open against the panel corner so the reading never closes */}
      <path
        d={arc(LaneRadius[1], 96, 354)}
        fill="none"
        stroke="rgb(var(--accent-primary))"
        strokeWidth={2.4}
        strokeOpacity={0.5}
        strokeLinecap="round"
      />

      <g fill="rgb(var(--accent-primary))" fillOpacity={0.55}>
        {[132, 196, 284, 332].map((angle) => {
          const point = polar(LaneRadius[0], angle);
          return <circle key={angle} cx={point.x} cy={point.y} r={3.4} />;
        })}
      </g>

      <circle
        cx={Center}
        cy={Center}
        r={RingRadius[3]}
        fill="currentColor"
        fillOpacity={0.06}
      />

      {/* 圆心是这一轮分发的召集者：比外圈头像大一号，实心 accent */}
      <g>
        <circle cx={Center} cy={Center} r={38} fill="rgb(var(--accent-primary))" fillOpacity={0.12} stroke="rgb(var(--accent-primary))" strokeOpacity={0.4} />
        <g transform={'translate(' + Center + ' ' + Center + ')'}>
          <Eyes variant={0} ink="rgb(var(--accent-primary))" unit={1.5} />
        </g>
      </g>

    </svg>
  </div>
);

export default ResultDial;