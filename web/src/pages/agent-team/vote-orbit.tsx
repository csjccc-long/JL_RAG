import { useTranslation } from 'react-i18next';

import { IAgentTeamWorker } from '@/interfaces/database/agent';
import { cn } from '@/lib/utils';
import { AgentAvatar } from './result-dial';
import { ITeamBoardCard } from './utils/board';
import VoteCoreVisual from './vote-core-visual';
import './vote-orbit.css';

/**
 * 投票模式的分发盘：一张带外环、连接曲线和粒子流的调度核心，队伍里每个成员围在它外面。
 *
 * 这里不做“表情环 + 形状贴纸”那一套装饰：投票阶段真正要读的是
 * 谁已投完、谁还在跑、谁在等下一轮。因此中心是一块可读的调度盘，
 * 成员用矩形卡片承载——头像、名字、当前状态，一眼扫过去就知道票卡在哪。
 *
 * 状态不是另一份数据：它从看板同一份 cards（进度 > 最终委派 > 计划）
 * 推出来，和底部任务状态、四列看板永远一致。
 */
export type VoteAgentStatus =
  | 'running'
  | 'waiting'
  | 'waitingResult'
  | 'done'
  | 'failed';

export interface IVoteAgent {
  workerId: string;
  name: string;
  avatarSeed: string;
  status: VoteAgentStatus;
}

const STATUS_KEY: Record<VoteAgentStatus, string> = {
  running: 'flow.agentTeam.page.workerStatus.running',
  waiting: 'flow.agentTeam.page.workerStatus.waiting',
  waitingResult: 'flow.agentTeam.page.workerStatus.waitingResult',
  done: 'flow.agentTeam.page.workerStatus.done',
  failed: 'flow.agentTeam.page.workerStatus.failed',
};

const STATUS_TEXT: Record<VoteAgentStatus, string> = {
  running: 'text-accent-primary',
  waiting: 'text-text-secondary',
  waitingResult: 'text-state-warning',
  done: 'text-state-success',
  failed: 'text-state-error',
};

const STATUS_DOT: Record<VoteAgentStatus, string> = {
  running: 'bg-accent-primary',
  waiting: 'bg-text-disabled',
  waitingResult: 'bg-state-warning',
  done: 'bg-state-success',
  failed: 'bg-state-error',
};

const STATUS_BORDER: Record<VoteAgentStatus, string> = {
  running: 'border-accent-primary/40',
  waiting: 'border-border-button',
  waitingResult: 'border-state-warning/35',
  done: 'border-state-success/35',
  failed: 'border-state-error/40',
};

/**
 * 一个成员此刻在做什么。
 *
 * - 有 running 卡：正在执行任务；
 * - 有失败卡：失败（先于 done 判断，避免一轮失败被另一轮成功盖掉）；
 * - 自己的卡全 done 但整队还在跑：票已投完，等待其他成员/最终结果；
 * - 其余运行中：等待任务（还没轮到自己，或下一轮还没分发）；
 * - 没在跑：等待任务（尚未开始）。
 */
export const voteAgentStatus = ({
  cards,
  running,
}: {
  cards: ITeamBoardCard[];
  running: boolean;
}): VoteAgentStatus => {
  if (cards.some((card) => card.status === 'running')) return 'running';
  if (cards.some((card) => card.status === 'failed')) return 'failed';
  if (cards.length > 0 && cards.every((card) => card.status === 'done')) {
    return running ? 'waitingResult' : 'done';
  }
  return 'waiting';
};

export const buildVoteAgents = ({
  workers,
  cards,
  running,
}: {
  workers: IAgentTeamWorker[];
  cards: ITeamBoardCard[];
  running: boolean;
}): IVoteAgent[] => {
  // workers 是团队配置里的完整名单；看板只会有分到任务的人。这里以名单为准，
  // 还没拿到任务的成员也要留在盘上，否则“队伍里所有人”会缺一角。
  const crew: IAgentTeamWorker[] =
    workers.length > 0
      ? workers
      : Array.from(new Set(cards.map((card) => card.workerId))).map((id) => ({
          id,
          name: cards.find((card) => card.workerId === id)?.workerName || id,
          agent: { params: {} },
        }));

  return crew.map((worker, index) => {
    const workerCards = cards.filter((card) => card.workerId === worker.id);
    return {
      workerId: worker.id || 'worker-' + index,
      name: worker.name || worker.id || 'worker-' + index,
      avatarSeed: worker.agent_id || worker.id || worker.name || String(index),
      status: voteAgentStatus({ cards: workerCards, running }),
    };
  });
};

/* 页面中间的空区：一张 464px 的调度盘，外面套一圈 810px 的环形轨道，
   四张成员卡落在轨道内侧。端点网络只画在圆盘里面，圆盘到轨道之间留空，环外是粒子流。 */
const StageW = 880;
const StageH = 820;
const DiscSize = 464;
const DiscRadius = DiscSize / 2;
const RingSize = 810;
const RingRadius = RingSize / 2;
const CardRadius = 310;
const MemberPortRadius = DiscRadius - 8;
const CenterX = StageW / 2;
const CenterY = StageH / 2;

/* 成员端口占据上右下左；中间再补 28 个背景端点，让环内始终有 32 个可读的点。
   总点数取不小于 32 且能被成员数整除的数，保证成员端口始终落在正方向。 */
const MIN_PORT_COUNT = 32;

const cardWidthOf = (count: number) => {
  if (count <= 4) return 272;
  if (count <= 6) return 248;
  return 224;
};

const orbitOf = (index: number, count: number, radius: number) => {
  const degrees = -90 + (index * 360) / Math.max(count, 1);
  const angle = (degrees * Math.PI) / 180;
  // 卡片的宽边朝向圆心：容器转到该点的切线方向；再折回 [-90, 90]，
  // 让圆盘下方的卡片不会倒过来，文字始终是正着或侧着可读的。
  const tangent = ((((degrees + 90 + 90) % 180) + 180) % 180) - 90;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    tilt: tangent,
  };
};

/* 轨道上的一个点。角度沿用卡片的角度，0° 指向右侧，-90° 指向正上方。 */
const pointAt = (degrees: number, radius: number) => {
  const angle = (degrees * Math.PI) / 180;
  return {
    x: CenterX + Math.cos(angle) * radius,
    y: CenterY + Math.sin(angle) * radius,
  };
};

const round = (value: number) => value.toFixed(1);

/* 每个端口都连到除自己外的所有端口：N 个点形成 N*(N-1) 条有向连线。
   两个方向的控制点落在弦的两侧，所以每一对点之间是一组对称的弧线。
   弧高按两点间的圆心角缩放，相邻端点之间不会拱成一大团。 */
const connectionOf = (
  fromDegrees: number,
  toDegrees: number,
  fromRadius: number,
  toRadius: number,
) => {
  const start = pointAt(fromDegrees, fromRadius);
  const end = pointAt(toDegrees, toRadius);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const bow =
    12 + length * 0.2 + (Math.round(Math.abs(fromDegrees - toDegrees)) % 5) * 3;
  const controlA = {
    x: start.x + dx * 0.34 + nx * bow,
    y: start.y + dy * 0.34 + ny * bow,
  };
  const controlB = {
    x: start.x + dx * 0.66 + nx * bow,
    y: start.y + dy * 0.66 + ny * bow,
  };

  return [
    'M',
    round(start.x),
    round(start.y),
    'C',
    round(controlA.x),
    round(controlA.y),
    round(controlB.x),
    round(controlB.y),
    round(end.x),
    round(end.y),
  ].join(' ');
};

/* 粒子流：用固定种子生成，重渲染时不会跳动。
   四束主粒子落在四张卡片之间的对角空隙里，再撒一层低透明度散点。 */
const mulberry32 = (seed: number) => {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
};

interface IParticle {
  key: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  opacity: number;
  delay: number;
  dash?: string;
  dot?: boolean;
  dotRadius?: number;
}

const buildParticles = (): IParticle[] => {
  const random = mulberry32(0x5eed);
  const beams = [45, 135, 225, 315];
  const particles: IParticle[] = [];

  for (let index = 0; index < 260; index += 1) {
    const inBeam = index < 220;
    const beam = beams[index % beams.length];
    const degrees = inBeam ? beam + (random() - 0.5) * 36 : random() * 360;
    const angle = (degrees * Math.PI) / 180;
    const start = RingRadius + 2 + random() * 8;
    const length = inBeam ? 22 + random() * 90 : 3 + random() * 22;
    const end = start + length;
    const x1 = CenterX + Math.cos(angle) * start;
    const y1 = CenterY + Math.sin(angle) * start;
    const x2 = CenterX + Math.cos(angle) * end;
    const y2 = CenterY + Math.sin(angle) * end;
    const dashRoll = random();

    particles.push({
      key: index,
      x1,
      y1,
      x2,
      y2,
      width: 0.4 + random() * 1.3,
      opacity: inBeam ? 0.08 + random() * 0.34 : 0.04 + random() * 0.16,
      delay: Math.round(random() * 4200),
      dash: dashRoll < 0.28 ? '2 9' : dashRoll < 0.5 ? '7 15' : undefined,
      dot: index % 5 === 0,
      dotRadius: 0.7 + random() * 1.2,
    });
  }

  return particles;
};

const PARTICLES = buildParticles();

interface VoteOrbitProps {
  workers: IAgentTeamWorker[];
  cards: ITeamBoardCard[];
  running: boolean;
}

const VoteOrbit = ({ workers, cards, running }: VoteOrbitProps) => {
  const { t } = useTranslation();
  const agents = buildVoteAgents({ workers, cards, running });
  const radius = CardRadius;
  const cardWidth = cardWidthOf(agents.length);
  const compact = agents.length > 4;
  const agentPorts = agents.map((agent, index) => {
    const degrees = -90 + (index * 360) / Math.max(agents.length, 1);
    const point = pointAt(degrees, MemberPortRadius);
    return {
      key: agent.workerId,
      degrees,
      point,
      agent,
      transform:
        'rotate(' +
        round(degrees + 90) +
        ' ' +
        round(point.x) +
        ' ' +
        round(point.y) +
        ')',
    };
  });
  const portCount = Math.max(
    MIN_PORT_COUNT,
    Math.max(agents.length, 1) *
      Math.ceil(MIN_PORT_COUNT / Math.max(agents.length, 1)),
  );
  const agentSlots = new Set(
    agents.map((_, index) =>
      Math.round((index * portCount) / Math.max(agents.length, 1)),
    ),
  );
  const portDegrees = Array.from(
    { length: portCount },
    (_, index) => -90 + (index * 360) / portCount,
  );
  const backgroundPorts = portDegrees.flatMap((degrees, index) =>
    agentSlots.has(index)
      ? []
      : [
          {
            key: 'background-' + index,
            degrees,
            point: pointAt(degrees, MemberPortRadius),
          },
        ],
  );
  const nodes = [
    ...agentPorts.map((port) => ({
      key: port.key,
      degrees: port.degrees,
      point: port.point,
      member: true,
    })),
    ...backgroundPorts.map((port) => ({
      ...port,
      member: false,
    })),
  ];
  // 32 个端点两两相连：4 个成员端口 + 28 个背景端点，每个点连向其余 31 个点。
  // 连线分两层：成员端口相关的线在上层、颜色深一点；纯背景端点之间只做很淡的底纹。
  // 所有端点都落在圆环内侧，弧线再由 clipPath 收在环内，圆环本身不挂线。
  const connections = nodes.flatMap((from, fromIndex) =>
    nodes.flatMap((to, toIndex) => {
      if (fromIndex === toIndex) return [];
      const upper = from.member || to.member;
      return [
        {
          key: from.key + '-' + to.key,
          path: connectionOf(
            from.degrees,
            to.degrees,
            MemberPortRadius,
            MemberPortRadius,
          ),
          layer: upper ? 'upper' : 'base',
          opacity: upper ? 0.42 : 0.04,
          width: upper ? 0.9 : 0.4,
        },
      ];
    }),
  );
  const baseConnections = connections.filter(
    (connection) => connection.layer === 'base',
  );
  const upperConnections = connections.filter(
    (connection) => connection.layer === 'upper',
  );

  return (
    <div
      data-testid="vote-orbit"
      className="flex h-full w-full select-none items-center justify-center"
    >
      <div
        data-testid="vote-stage"
        className="relative"
        style={{ width: StageW, height: StageH }}
      >
        <div
          data-testid="vote-disc"
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border border-text-secondary/40 bg-bg-base"
          style={{
            width: DiscSize,
            height: DiscSize,
            backgroundImage:
              'radial-gradient(circle at 50% 46%, rgb(var(--text-primary) / 0.05), transparent 68%)',
          }}
        >
          <VoteCoreVisual />
        </div>

        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
          viewBox={'0 0 ' + StageW + ' ' + StageH}
          fill="none"
        >
          <g
            data-testid="vote-particles"
            className="text-text-secondary"
            stroke="currentColor"
          >
            {PARTICLES.map((particle) => (
              <g
                key={particle.key}
                className="vote-particle"
                style={{ animationDelay: particle.delay + 'ms' }}
              >
                <line
                  x1={particle.x1}
                  y1={particle.y1}
                  x2={particle.x2}
                  y2={particle.y2}
                  strokeWidth={particle.width}
                  strokeOpacity={particle.opacity}
                  strokeLinecap="round"
                  strokeDasharray={particle.dash}
                />
                {particle.dot ? (
                  <circle
                    cx={particle.x2}
                    cy={particle.y2}
                    r={particle.dotRadius}
                    fill="currentColor"
                    stroke="none"
                    fillOpacity={Math.min(0.72, particle.opacity * 1.8)}
                  />
                ) : null}
              </g>
            ))}
          </g>

          <g
            data-testid="vote-ring"
            className="text-text-primary"
            stroke="currentColor"
          >
            <circle
              cx={CenterX}
              cy={CenterY}
              r={RingRadius - 8}
              strokeWidth={16}
              strokeOpacity={0.07}
            />
            <circle
              cx={CenterX}
              cy={CenterY}
              r={RingRadius}
              strokeWidth={4.5}
              strokeOpacity={0.42}
            />
            <circle
              cx={CenterX}
              cy={CenterY}
              r={RingRadius - 13}
              strokeWidth={1}
              strokeOpacity={0.3}
            />
            <circle
              cx={CenterX}
              cy={CenterY}
              r={RingRadius + 9}
              strokeWidth={1}
              strokeOpacity={0.26}
            />
          </g>

          <g
            data-testid="vote-core"
            className="text-text-secondary"
            stroke="currentColor"
          >
            <circle
              cx={CenterX}
              cy={CenterY}
              r={DiscRadius - 2}
              strokeWidth={0.9}
              strokeOpacity={0.24}
            />
            <defs>
              <clipPath id="vote-link-clip">
                <circle cx={CenterX} cy={CenterY} r={DiscRadius - 2} />
              </clipPath>
              <radialGradient
                id="vote-link-fade"
                gradientUnits="userSpaceOnUse"
                cx={CenterX}
                cy={CenterY}
                r={DiscRadius}
              >
                <stop offset="0%" stopColor="currentColor" stopOpacity={0} />
                <stop
                  offset="30%"
                  stopColor="currentColor"
                  stopOpacity={0.015}
                />
                <stop
                  offset="60%"
                  stopColor="currentColor"
                  stopOpacity={0.12}
                />
                <stop
                  offset="85%"
                  stopColor="currentColor"
                  stopOpacity={0.62}
                />
                <stop offset="100%" stopColor="currentColor" stopOpacity={1} />
              </radialGradient>
            </defs>
            <g clipPath="url(#vote-link-clip)">
              {baseConnections.map((connection) => (
                <path
                  key={connection.key}
                  data-testid="vote-link"
                  data-layer="base"
                  d={connection.path}
                  stroke="url(#vote-link-fade)"
                  strokeWidth={connection.width}
                  strokeOpacity={connection.opacity}
                  strokeLinecap="round"
                />
              ))}
              {upperConnections.map((connection) => (
                <path
                  key={connection.key}
                  data-testid="vote-link"
                  data-layer="upper"
                  d={connection.path}
                  stroke="url(#vote-link-fade)"
                  strokeWidth={connection.width}
                  strokeOpacity={connection.opacity}
                  strokeLinecap="round"
                />
              ))}
            </g>

            {agentPorts.map((port) => (
              <g key={port.key} className="text-text-primary">
                <rect
                  x={port.point.x - 5}
                  y={port.point.y - 2}
                  width={10}
                  height={4}
                  rx={2}
                  fill="currentColor"
                  stroke="none"
                  fillOpacity={0.9}
                  transform={port.transform}
                />
                {port.agent.status === 'running' ? (
                  <circle
                    cx={port.point.x}
                    cy={port.point.y}
                    r={7}
                    className="vote-port-pulse"
                    strokeWidth={1}
                    strokeOpacity={0.7}
                  />
                ) : null}
              </g>
            ))}

            <g data-testid="vote-background" stroke="currentColor">
              {backgroundPorts.map((port) => (
                <g key={port.key} data-testid="vote-background-port">
                  <circle
                    cx={port.point.x}
                    cy={port.point.y}
                    r={4.5}
                    strokeWidth={0.7}
                    strokeOpacity={0.16}
                  />
                  <circle
                    cx={port.point.x}
                    cy={port.point.y}
                    r={1.7}
                    fill="currentColor"
                    stroke="none"
                    fillOpacity={0.5}
                  />
                </g>
              ))}
            </g>

            <g className="text-text-primary">
              <circle
                cx={CenterX}
                cy={CenterY}
                r={4}
                fill="currentColor"
                stroke="none"
                fillOpacity={0.4}
              />
            </g>
          </g>
        </svg>

        {agents.map((agent, index) => {
          const point = orbitOf(index, agents.length, radius);
          return (
            <div
              key={agent.workerId}
              data-testid={'vote-agent-' + agent.workerId}
              data-status={agent.status}
              title={agent.name}
              className={cn(
                'absolute z-20 flex flex-col gap-3 rounded-2xl border bg-bg-component px-5 py-4 shadow-sm',
                STATUS_BORDER[agent.status],
              )}
              style={{
                left: 'calc(50% + ' + Math.round(point.x) + 'px)',
                top: 'calc(50% + ' + Math.round(point.y) + 'px)',
                width: cardWidth,
                transform:
                  'translate(-50%, -50%) rotate(' + point.tilt + 'deg)',
              }}
            >
              <div className="flex min-w-0 items-center gap-3">
                <AgentAvatar
                  seed={agent.avatarSeed}
                  size={compact ? 44 : 52}
                  className="shrink-0"
                />
                <p
                  className={cn(
                    'min-w-0 flex-1 truncate font-medium leading-8 text-text-primary',
                    compact ? 'text-[22px]' : 'text-2xl',
                  )}
                >
                  {agent.name}
                </p>
              </div>
              <p
                className={cn(
                  'flex min-w-0 items-center gap-2 text-[22px] leading-7',
                  STATUS_TEXT[agent.status],
                )}
              >
                <span
                  className={cn(
                    'size-3 shrink-0 rounded-full',
                    STATUS_DOT[agent.status],
                    agent.status === 'running' && 'animate-pulse',
                  )}
                />
                <span className="truncate">{t(STATUS_KEY[agent.status])}</span>
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VoteOrbit;
