import { IAgentTeamProgressEntry, IAgentTeamTask } from '@/interfaces/database/agent';
import { buildBoardCards, groupCardsByColumn } from './board';

const progressEntry = (
  overrides: Partial<IAgentTeamProgressEntry> = {},
): IAgentTeamProgressEntry => ({
  id: 'entry-1',
  component_id: 'AgentTeam:1',
  worker_id: 'researcher',
  worker_name: 'Researcher',
  role: 'participant',
  task: 'collect sources',
  context: '',
  process: 'parallel',
  round: 1,
  task_index: 0,
  sequence: 1,
  status: 'running',
  started_at: 1,
  finished_at: 0,
  elapsed_ms: 0,
  error: '',
  result: '',
  ...overrides,
});

const planTask = (overrides: Partial<IAgentTeamTask> = {}): IAgentTeamTask => ({
  worker: 'researcher',
  task: 'collect sources',
  context: '',
  expected_output: 'a list of sources',
  ...overrides,
});

describe('buildBoardCards', () => {
  it('shows configured tasks as pending before the run starts', () => {
    const cards = buildBoardCards({
      progress: [],
      delegations: [],
      planTasks: [planTask(), planTask({ worker: 'writer', task: 'draft' })],
    });

    expect(cards).toHaveLength(2);
    expect(cards.every((card) => card.status === 'pending')).toBe(true);
    expect(cards[0].workerName).toBe('researcher');
  });

  it('moves a planned card to running once the backend reports progress', () => {
    const cards = buildBoardCards({
      progress: [progressEntry()],
      delegations: [],
      planTasks: [planTask()],
    });

    expect(cards).toHaveLength(1);
    expect(cards[0].status).toBe('running');
    expect(cards[0].source).toBe('live');
  });

  it('marks finished and failed entries by their backend status', () => {
    const cards = buildBoardCards({
      progress: [
        progressEntry({ id: 'a', task: 'collect', status: 'ok', elapsed_ms: 1200 }),
        progressEntry({
          id: 'b',
          worker_id: 'writer',
          task: 'draft',
          status: 'error',
          error: 'timeout',
        }),
      ],
      delegations: [],
      planTasks: [],
    });

    const grouped = groupCardsByColumn(cards);
    expect(grouped.done).toHaveLength(1);
    expect(grouped.failed).toHaveLength(1);
    expect(grouped.failed[0].error).toBe('timeout');
  });

  it('falls back to node delegations when progress is gone', () => {
    const cards = buildBoardCards({
      progress: [],
      delegations: [
        {
          sequence: 2,
          worker_id: 'researcher',
          task: 'collect sources',
          status: 'ok',
          result: 'three papers',
          duration_ms: 900,
          metadata: { round: 1, task_index: 0, role: 'participant' },
        },
      ],
      planTasks: [planTask()],
    });

    expect(cards).toHaveLength(1);
    expect(cards[0].status).toBe('done');
    expect(cards[0].result).toBe('three papers');
  });

  it('does not duplicate a delegation already covered by progress', () => {
    const cards = buildBoardCards({
      progress: [progressEntry({ status: 'ok', result: 'done' })],
      delegations: [
        {
          sequence: 1,
          worker_id: 'researcher',
          task: 'collect sources',
          status: 'ok',
          metadata: { round: 1, task_index: 0 },
        },
      ],
      planTasks: [],
    });

    expect(cards).toHaveLength(1);
  });

  it('orders cards by round then task index', () => {
    const cards = buildBoardCards({
      progress: [
        progressEntry({ id: 'b', task: 'second', task_index: 1 }),
        progressEntry({ id: 'c', task: 'third round', round: 2, task_index: 0 }),
        progressEntry({ id: 'a', task: 'first', task_index: 0 }),
      ],
      delegations: [],
      planTasks: [],
    });

    expect(cards.map((card) => card.task)).toEqual([
      'first',
      'second',
      'third round',
    ]);
  });
  it('plans cards with the worker display name instead of its id', () => {
    const cards = buildBoardCards({
      progress: [],
      delegations: [],
      planTasks: [planTask()],
      workers: [{ id: 'researcher', name: '调研员' }],
    });

    expect(cards[0].workerName).toBe('调研员');
  });

  it('falls back to delegations name lookup when workers are missing', () => {
    const cards = buildBoardCards({
      progress: [],
      delegations: [],
      planTasks: [planTask()],
    });

    expect(cards[0].workerName).toBe('researcher');
  });
});
