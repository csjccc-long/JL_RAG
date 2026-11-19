// 任务分发看板的纯数据层：把"运行期进度"和"节点最终 delegations"合并成卡片。
//
// 两个来源各有用途：
// - progress：后端每分派一个子任务就写一条（running → ok/error），负责实时效果；
// - delegations：node_finished 里 AgentTeam 输出的权威记录，进度 key 过期或
//   轮询错过时用它兜底。
// 同一次分派只保留一张卡片，优先级：progress > delegation。

import {
  AgentTeamProgressStatus,
  IAgentTeamProgressEntry,
  IAgentTeamTask,
} from '@/interfaces/database/agent';

export type TeamCardStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ITeamBoardCard {
  id: string;
  workerId: string;
  workerName: string;
  role: string;
  task: string;
  status: TeamCardStatus;
  round: number;
  taskIndex: number;
  elapsedMs: number | null;
  error: string;
  result: string;
  source: 'plan' | 'live';
}

export interface IDelegationLike {
  sequence?: number;
  worker_id?: string;
  task?: string;
  status?: string;
  result?: string;
  error?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

const toCardStatus = (status: AgentTeamProgressStatus): TeamCardStatus => {
  if (status === 'running') return 'running';
  if (status === 'ok') return 'done';
  return 'failed';
};

const delegationStatus = (status?: string): TeamCardStatus =>
  status === 'ok' ? 'done' : 'failed';

const cardKey = (workerId: string, task: string, round: number) =>
  `${round}::${workerId}::${task.trim()}`;

export interface ITeamWorkerLike {
  id: string;
  name?: string;
}

export const buildBoardCards = ({
  progress,
  delegations,
  planTasks,
  workers = [],
}: {
  progress: IAgentTeamProgressEntry[];
  delegations: IDelegationLike[];
  planTasks: IAgentTeamTask[];
  workers?: ITeamWorkerLike[];
}): ITeamBoardCard[] => {
  // 团队配置里的 worker 名字只在计划卡上有意义（后端进度/委派记录已带名字），
  // 但计划卡若只显示 id，看板一开始就是一堆英文 id，认不出是谁。
  const workerName = (workerId: string) =>
    workers.find((item) => item.id === workerId)?.name || workerId;
  const cards: ITeamBoardCard[] = [];
  const claimed = new Set<string>();

  progress.forEach((entry) => {
    claimed.add(cardKey(entry.worker_id, entry.task, entry.round));
    cards.push({
      id: entry.id,
      workerId: entry.worker_id,
      workerName: entry.worker_name || entry.worker_id,
      role: entry.role,
      task: entry.task,
      status: toCardStatus(entry.status),
      round: entry.round,
      taskIndex: entry.task_index,
      elapsedMs: entry.elapsed_ms,
      error: entry.error,
      result: entry.result,
      source: 'live',
    });
  });

  delegations.forEach((record, index) => {
    const workerId = record.worker_id ?? '';
    const task = record.task ?? '';
    const round = Number(record.metadata?.round ?? 0) || 0;
    const key = cardKey(workerId, task, round);
    if (claimed.has(key)) return;
    claimed.add(key);
    cards.push({
      id: `delegation:${record.sequence ?? index}:${index}`,
      workerId,
      workerName: workerName(workerId),
      role: String(record.metadata?.role ?? 'participant'),
      task,
      status: delegationStatus(record.status),
      round,
      taskIndex: Number(record.metadata?.task_index ?? index),
      elapsedMs: record.duration_ms ?? null,
      error: record.error ?? '',
      result: record.result ?? '',
      source: 'live',
    });
  });

  // 还没开始跑（或 hierarchical 尚未决定分派）时，先把团队配置里的任务摆在
  // "待分发"一列，让看板一开始就有明确的待办清单。
  planTasks.forEach((task, index) => {
    const workerId = task.worker ?? '';
    const text = task.task ?? '';
    const key = cardKey(workerId, text, 1);
    if (claimed.has(key)) return;
    const alreadyDispatched = cards.some(
      (card) => card.round === 1 && card.taskIndex === index,
    );
    if (alreadyDispatched) return;
    claimed.add(key);
    cards.push({
      id: `plan:${index}`,
      workerId,
      workerName: workerName(workerId),
      role: 'participant',
      task: text,
      status: 'pending',
      round: 1,
      taskIndex: index,
      elapsedMs: null,
      error: '',
      result: '',
      source: 'plan',
    });
  });

  return cards.sort(
    (a, b) =>
      a.round - b.round ||
      a.taskIndex - b.taskIndex ||
      a.workerId.localeCompare(b.workerId),
  );
};

export const BOARD_COLUMNS: TeamCardStatus[] = [
  'pending',
  'running',
  'done',
  'failed',
];

export const groupCardsByColumn = (cards: ITeamBoardCard[]) => {
  const grouped: Record<TeamCardStatus, ITeamBoardCard[]> = {
    pending: [],
    running: [],
    done: [],
    failed: [],
  };
  cards.forEach((card) => {
    grouped[card.status].push(card);
  });
  return grouped;
};