// 从智能体画布的 DSL 中抽出多智能体团队节点。
//
// 后端 /v1/agents 列表接口不返回 dsl，所以团队信息只能逐个取详情后解析
// components 里的 AgentTeam 节点。这里保持纯函数，便于单测。

import {
  AgentTeamProcess,
  DSL,
  IAgentTeamForm,
  IAgentTeamTask,
  IAgentTeamWorker,
} from '@/interfaces/database/agent';

export const AGENT_TEAM_COMPONENT_NAME = 'AgentTeam';

export interface IAgentTeamNodeConfig {
  componentId: string;
  process: AgentTeamProcess;
  workers: IAgentTeamWorker[];
  tasks: IAgentTeamTask[];
  judge: string;
  managerLlmId: string;
  maxDelegations: number;
  maxDepth: number;
}

export interface IAgentTeamSummary extends IAgentTeamNodeConfig {
  agentId: string;
  agentTitle: string;
}

const DEFAULT_PROCESS: AgentTeamProcess = 'hierarchical';

const normalizeWorkers = (value: unknown): IAgentTeamWorker[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (worker): worker is IAgentTeamWorker =>
      !!worker && typeof worker === 'object' && typeof (worker as any).id === 'string',
  );
};

const normalizeTasks = (value: unknown): IAgentTeamTask[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (task): task is IAgentTeamTask =>
      !!task && typeof task === 'object' && typeof (task as any).task === 'string',
  );
};

const normalizeProcess = (value: unknown): AgentTeamProcess => {
  const processes: AgentTeamProcess[] = [
    'sequential',
    'hierarchical',
    'parallel',
    'vote',
    'debate',
    'consensus',
  ];
  return processes.includes(value as AgentTeamProcess)
    ? (value as AgentTeamProcess)
    : DEFAULT_PROCESS;
};

export const extractTeamNodes = (
  dsl?: Partial<DSL> | null,
): IAgentTeamNodeConfig[] => {
  const components = dsl?.components;
  if (!components || typeof components !== 'object') return [];

  return Object.entries(components).flatMap(([componentId, operator]) => {
    const obj = operator?.obj;
    if (!obj || obj.component_name !== AGENT_TEAM_COMPONENT_NAME) return [];

    const params = (obj.params ?? {}) as Partial<IAgentTeamForm>;
    const managerLlmId =
      typeof (params.manager as any)?.params?.llm_id === 'string'
        ? ((params.manager as any).params.llm_id as string)
        : '';

    return [
      {
        componentId,
        process: normalizeProcess(params.process),
        workers: normalizeWorkers(params.workers),
        tasks: normalizeTasks(params.tasks),
        judge: typeof params.judge === 'string' ? params.judge : '',
        managerLlmId,
        maxDelegations:
          typeof params.max_delegations === 'number' ? params.max_delegations : 8,
        maxDepth: typeof params.max_depth === 'number' ? params.max_depth : 3,
      },
    ];
  });
};
