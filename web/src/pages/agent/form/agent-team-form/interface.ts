import { AgentTeamProcess } from '@/interfaces/database/agent';

export const AGENT_TEAM_PROCESSES: AgentTeamProcess[] = [
  'sequential',
  'hierarchical',
  'parallel',
  'vote',
  'debate',
  'consensus',
];

export const AGENT_TEAM_JUDGE_PROCESSES: AgentTeamProcess[] = [
  'vote',
  'debate',
  'consensus',
];

export interface AgentTeamValidationIssue {
  path: string;
  messageKey: string;
  values?: Record<string, unknown>;
}
