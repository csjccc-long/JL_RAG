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
    </svg>
  </div>
);

export default ResultDial;