import {
  AgentTeamProcess,
  DSL,
  IAgentTeamTask,
  IAgentTeamWorker,
} from '@/interfaces/database/agent';
import type { ProcessSeedText } from './apply-process';
import {
  JUDGE_PROCESSES,
  managerFor,
  requiredDelegations,
  tasksFor,
} from './apply-process';

/**
 * A brand-new team canvas.
 *
 * The canvas is the same three-node shape the board and the agent canvas already
 * understand — begin → the team → the message that reads its answer — so the new
 * team runs, saves and re-opens exactly like the seeded ones. Everything that
 * decides how the team behaves lives in the team node's params, written to both
 * the component (what the backend runs) and the graph node's form (what the
 * canvas shows).
 */

/* the key is also the DSL name and part of the {AgentTeam:x@content} expression,
   so it may not carry separators the expression would read as syntax */
export const teamNodeName = (name: string): string => {
  const cleaned = name
    .trim()
    /* separators the expression parser would read as syntax, and whitespace,
       all become the one safe separator */
    .replace(/[\s:：@]+/g, '-')
    .replace(/[^\p{L}\p{N}_·-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'Team';
};

export interface NewTeamSpec {
  /** what the canvas is called in the agent list */
  title: string;
  /** the node's own name, shown on the canvas */
  nodeName: string;
  process: AgentTeamProcess;
  workers: IAgentTeamWorker[];
  seed: ProcessSeedText;
  rounds?: number;
  prologue?: string;
  /** the line the team's opening message reads */
  welcome?: string;
}

export interface PlannedTeam {
  tasks: IAgentTeamTask[];
  judge: string;
  manager: Record<string, unknown>;
  maxDelegations: number;
}

/* Who does what under a given process, for a crew that has no tasks yet:
   a manager team decides at run time and gets none; a judging team keeps its
   last member back as the judge, since a judge that also answers has nothing to
   compare; everything else gets one task per member. */
export const planTeam = (
  process: AgentTeamProcess,
  workers: IAgentTeamWorker[],
  seed: ProcessSeedText,
  rounds = 1,
): PlannedTeam => {
  const judge =
    JUDGE_PROCESSES.includes(process) && workers.length > 1
      ? workers[workers.length - 1].id
      : '';
  const answering =
    process === 'hierarchical'
      ? []
      : judge
        ? workers.slice(0, -1)
        : workers;
  const tasks = answering.length ? tasksFor(answering, seed) : [];
  const manager =
    process === 'hierarchical'
      ? (managerFor(workers, seed) as Record<string, unknown>)
      : {};

  return {
    tasks,
    judge,
    manager,
    maxDelegations: Math.max(
      8,
      requiredDelegations(process, tasks.length, rounds, !!judge),
    ),
  };
};

export const buildTeamDsl = (spec: NewTeamSpec): DSL => {
  const name = teamNodeName(spec.nodeName);
  const componentId = `AgentTeam:${name}`;
  const rounds = spec.rounds ?? 1;
  const plan = planTeam(spec.process, spec.workers, spec.seed, rounds);
  const prologue = spec.prologue ?? '';
  const content = `{${componentId}@content}`;

  const params = {
    process: spec.process,
    manager: plan.manager,
    workers: spec.workers,
    tasks: plan.tasks,
    max_concurrency: 3,
    collaboration_rounds: rounds,
    judge: plan.judge,
    max_delegations: plan.maxDelegations,
    max_depth: 3,
    worker_timeout: 300,
    custom_header: {},
    outputs: {
      content: { type: 'string', value: '' },
      structured: { type: 'object', value: {} },
    },
  };

  return {
    components: {
      begin: {
        obj: {
          component_name: 'Begin',
          params: { mode: 'conversational', prologue },
        },
        downstream: [componentId],
        upstream: [],
      },
      [componentId]: {
        obj: { component_name: 'AgentTeam', params },
        downstream: ['Message:Out'],
        upstream: ['begin'],
      },
      'Message:Out': {
        obj: { component_name: 'Message', params: { content: [content] } },
        downstream: [],
        upstream: [componentId],
      },
    },
    graph: {
      nodes: [
        {
          id: 'begin',
          type: 'beginNode',
          position: { x: 60, y: 220 },
          data: {
            label: 'Begin',
            name: 'begin',
            form: { mode: 'conversational', prologue },
          },
          sourcePosition: 'left',
          targetPosition: 'right',
        },
        {
          id: componentId,
          type: 'agentTeamNode',
          position: { x: 420, y: 220 },
          data: { label: 'AgentTeam', name, form: params },
          sourcePosition: 'right',
          targetPosition: 'left',
        },
        {
          id: 'Message:Out',
          type: 'messageNode',
          position: { x: 820, y: 220 },
          data: {
            label: 'Message',
            name: 'Out',
            form: { content: [content] },
          },
          sourcePosition: 'right',
          targetPosition: 'left',
        },
      ],
      edges: [
        {
          id: `xy-edge__beginstart-${componentId}end`,
          source: 'begin',
          sourceHandle: 'start',
          target: componentId,
          targetHandle: 'end',
        },
        {
          id: `xy-edge__${componentId}start-Message:Outend`,
          source: componentId,
          sourceHandle: 'start',
          target: 'Message:Out',
          targetHandle: 'end',
        },
      ],
    },
    path: ['begin', componentId, 'Message:Out'],
    history: [],
    messages: [],
    variables: {},
    retrieval: [],
    globals: {
      'sys.query': '',
      'sys.user_id': '',
      'sys.conversation_turns': 0,
      'sys.files': [],
      'sys.history': [],
    },
  } as unknown as DSL;
};
