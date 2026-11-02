export type AgentTeamRunStatus =
  | 'notRun'
  | 'success'
  | 'partial'
  | 'failed';

export interface NormalizedDelegation {
  sequence: number;
  worker_id: string;
  task: string;
  context: string;
  expected_output: string;
  status: string;
  result: string;
  error: string;
  duration_ms: number;
  round: number;
  task_index: number;
  role: string;
}

export interface NormalizedVote {
  task_index: number;
  worker_id: string;
  choice: string;
  confidence: number;
  rationale: string;
  status: string;
  error: string;
}

export interface NormalizedVoteGroup {
  choice: string;
  count: number;
  confidence: number;
  votes: NormalizedVote[];
}

export interface NormalizedResponse {
  task_index: number;
  worker_id: string;
  status: string;
  content: string;
  error: string;
  duration_ms: number;
}

export interface NormalizedRound {
  round: number;
  responses: NormalizedResponse[];
}

export interface NormalizedAgentTeamOutput {
  process: string;
  status: AgentTeamRunStatus;
  content: string;
  structured: Record<string, any>;
  structuredParseError: string;
  delegations: NormalizedDelegation[];
  votes: NormalizedVote[];
  voteGroups: NormalizedVoteGroup[];
  invalidVotes: NormalizedVote[];
  rounds: NormalizedRound[];
  consensus: boolean;
  hasConsensusValue: boolean;
  winner: string;
  resolution: string;
  judgeResult: string;
  tieBreak: string;
  summary: string;
  error: string;
  raw: unknown;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function asNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asRecord(value: unknown): Record<string, any> {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function lastRun(value: unknown): Record<string, any> | undefined {
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return isRecord(last) ? last : undefined;
  }
  return isRecord(value) ? value : undefined;
}

function parseStructured(value: unknown): {
  structured: Record<string, any>;
  error: string;
} {
  if (isRecord(value)) {
    return { structured: value, error: '' };
  }
  if (typeof value !== 'string' || !value.trim()) {
    return { structured: {}, error: '' };
  }
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed)
      ? { structured: parsed, error: '' }
      : {
          structured: {},
          error: 'Structured AgentTeam output is not a JSON object.',
        };
  } catch {
    return {
      structured: {},
      error: 'Structured AgentTeam output is not valid JSON.',
    };
  }
}

function normalizeDelegation(value: unknown): NormalizedDelegation {
  const item = asRecord(value);
  const metadata = asRecord(item.metadata);
  return {
    sequence: asNumber(item.sequence),
    worker_id: asText(item.worker_id),
    task: asText(item.task),
    context: asText(item.context),
    expected_output: asText(item.expected_output),
    status: asText(item.status),
    result: asText(item.result),
    error: asText(item.error),
    duration_ms: asNumber(item.duration_ms),
    round: asNumber(item.round, asNumber(metadata.round)),
    task_index: asNumber(item.task_index, asNumber(metadata.task_index)),
    role: asText(item.role) || asText(metadata.role),
  };
}

function normalizeVote(value: unknown): NormalizedVote {
  const item = asRecord(value);
  return {
    task_index: asNumber(item.task_index),
    worker_id: asText(item.worker_id),
    choice: asText(item.choice).trim(),
    confidence: asNumber(item.confidence),
    rationale: asText(item.rationale),
    status: asText(item.status) || 'invalid',
    error: asText(item.error),
  };
}

function normalizeResponse(value: unknown): NormalizedResponse {
  const item = asRecord(value);
  return {
    task_index: asNumber(item.task_index),
    worker_id: asText(item.worker_id),
    status: asText(item.status),
    content: asText(item.content) || asText(item.result),
    error: asText(item.error),
    duration_ms: asNumber(item.duration_ms),
  };
}

function normalizeRound(value: unknown, index: number): NormalizedRound {
  const item = asRecord(value);
  return {
    round: asNumber(item.round, index + 1),
    responses: asArray(item.responses).map(normalizeResponse),
  };
}

function groupVotes(votes: NormalizedVote[]): NormalizedVoteGroup[] {
  const groups = new Map<string, NormalizedVoteGroup>();
  votes
    .filter((vote) => vote.status === 'valid' && vote.choice)
    .forEach((vote) => {
      const current = groups.get(vote.choice) ?? {
        choice: vote.choice,
        count: 0,
        confidence: 0,
        votes: [],
      };
      current.count += 1;
      current.confidence += vote.confidence;
      current.votes.push(vote);
      groups.set(vote.choice, current);
    });
  return Array.from(groups.values()).sort(
    (left, right) =>
      right.count - left.count || left.choice.localeCompare(right.choice),
  );
}

function resolveStatus(
  raw: Record<string, any> | undefined,
  structuredStatus: string,
  delegations: NormalizedDelegation[],
  error: string,
  executionError: string,
): AgentTeamRunStatus {
  if (structuredStatus === 'partial') {
    return 'partial';
  }

  const successful = delegations.filter(
    (delegation) => delegation.status === 'ok',
  ).length;
  const failed = delegations.filter(
    (delegation) => delegation.status === 'error',
  ).length;
  if (error || executionError || failed > 0) {
    return successful > 0 ? 'partial' : 'failed';
  }
  if (!raw || Object.keys(raw).length === 0) {
    return 'notRun';
  }
  return 'success';
}

export function normalizeAgentTeamOutput(
  rawOutput: unknown,
  executionError?: string | null,
): NormalizedAgentTeamOutput {
  const raw = lastRun(rawOutput);
  const parsedStructured = parseStructured(raw?.structured);
  const structured = parsedStructured.structured;
  const delegations = asArray(raw?.delegations)
    .map(normalizeDelegation)
    .sort(
      (left, right) =>
        left.round - right.round ||
        left.sequence - right.sequence ||
        left.task_index - right.task_index,
    );
  const votes = asArray(raw?.votes).map(normalizeVote);
  const rounds = asArray(raw?.rounds).map(normalizeRound);
  const error = asText(raw?._ERROR) || asText(structured._ERROR);
  const structuredStatus = asText(structured.status) || asText(raw?.status);
  const hasConsensusValue =
    Object.prototype.hasOwnProperty.call(raw ?? {}, 'consensus') ||
    Object.prototype.hasOwnProperty.call(structured, 'consensus');

  return {
    process: asText(raw?.process) || asText(structured.process),
    status: resolveStatus(
      raw,
      structuredStatus,
      delegations,
      error,
      asText(executionError),
    ),
    content: asText(raw?.content) || asText(structured.content),
    structured,
    structuredParseError: parsedStructured.error,
    delegations,
    votes,
    voteGroups: groupVotes(votes),
    invalidVotes: votes.filter(
      (vote) => vote.status !== 'valid' || !vote.choice,
    ),
    rounds,
    consensus: Boolean(raw?.consensus ?? structured.consensus),
    hasConsensusValue,
    winner: asText(raw?.winner ?? structured.winner),
    resolution:
      asText(raw?.resolution) || asText(structured.resolution),
    judgeResult:
      asText(raw?.judge_result) || asText(structured.judge_result),
    tieBreak: asText(raw?.tie_break) || asText(structured.tie_break),
    summary: asText(raw?.summary) || asText(structured.summary),
    error,
    raw: rawOutput,
  };
}
