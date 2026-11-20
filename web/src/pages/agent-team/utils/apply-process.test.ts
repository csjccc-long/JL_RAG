import { AgentTeamProcess, DSL, IAgentTeamWorker } from '@/interfaces/database/agent';
import {
  applyTeamProcess,
  requiredDelegations,
  resolvesToWorker,
} from './apply-process';

const worker = (id: string, name: string, role: string): IAgentTeamWorker => ({
  id,
  name,
  role,
  agent: { params: { llm_id: 'qwen2.5:3b@local@Ollama', temperature: 0.3 } },
});

const workers: IAgentTeamWorker[] = [
  worker('alpha', 'Alpha 评审', 'risk'),
  worker('beta', 'Beta 评审', 'bug'),
  worker('gamma', 'Gamma 评审', 'cost'),
];

const task = (id: string) => ({
  worker: id,
  task: `${id} 的活儿`,
  expected_output: '结论',
});

/* a hierarchical team: a manager, no tasks, no judge — the shape the board's
   most-used card has, and the hardest one to switch away from */
const hierarchical = (): DSL =>
  ({
    components: {
      'AgentTeam:Desk': {
        downstream: [],
        obj: {
          component_name: 'AgentTeam',
          params: {
            process: 'hierarchical',
            manager: { params: { llm_id: 'hand-written-manager', sys_prompt: '老主管' } },
            workers: JSON.parse(JSON.stringify(workers)),
            tasks: [],
            judge: '',
            max_concurrency: 4,
            collaboration_rounds: 3,
            max_delegations: 8,
            max_depth: 3,
            worker_timeout: 300,
            custom_header: {},
          },
        },
      },
    },
    graph: {
      nodes: [
        {
          id: 'AgentTeam:Desk',
          data: {
            form: {
              process: 'hierarchical',
              manager: { params: { llm_id: 'hand-written-manager', sys_prompt: '老主管' } },
              workers,
              tasks: [],
              judge: '',
            },
          },
        },
      ],
      edges: [],
    },
  }) as unknown as DSL;

const paramsOf = (dsl: DSL) =>
  dsl.components!['AgentTeam:Desk'].obj.params as Record<string, any>;
const formOf = (dsl: DSL) =>
  dsl.graph!.nodes![0].data!.form as Record<string, any>;

describe('requiredDelegations', () => {
  it('counts what each process will actually spend', () => {
    expect(requiredDelegations('parallel', 3, 3, false)).toBe(3);
    expect(requiredDelegations('vote', 3, 3, true)).toBe(4);
    expect(requiredDelegations('debate', 3, 3, false)).toBe(9);
    expect(requiredDelegations('consensus', 2, 2, true)).toBe(5);
    expect(requiredDelegations('sequential', 3, 3, false)).toBe(3);
  });
});

describe('resolvesToWorker', () => {
  it('matches an id, or a name no other member shares', () => {
    expect(resolvesToWorker(workers, 'alpha')).toBe(true);
    expect(resolvesToWorker(workers, 'Alpha 评审')).toBe(true);
    expect(resolvesToWorker(workers, 'judge')).toBe(false);
    expect(resolvesToWorker(workers, '')).toBe(false);
  });
});

describe('applyTeamProcess', () => {
  it('turns a manager-only team into a runnable parallel one', () => {
    const next = applyTeamProcess(hierarchical(), 'AgentTeam:Desk', 'parallel');
    const params = paramsOf(next);

    expect(params.process).toBe('parallel');
    // a manager is illegal off the hierarchical process, so it has to go
    expect(params.manager).toEqual({});
    // ...and a parallel team needs tasks: one per member, pointing at that member
    expect(params.tasks.map((item: any) => item.worker)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(params.tasks[0].task).toContain('Alpha 评审');
    // the backend refuses a task without an expected_output, so every seeded
    // task has to carry one or the whole canvas save is rejected
    expect(params.tasks[0].expected_output.trim()).not.toBe('');
    expect(params.judge).toBe('');
    // a budget is a ceiling, never a promise: the old one is kept if it covers
    expect(params.max_delegations).toBeGreaterThanOrEqual(3);
  });

  it('keeps the written manager on the canvas so switching back restores it', () => {
    const away = applyTeamProcess(hierarchical(), 'AgentTeam:Desk', 'parallel');
    expect(formOf(away).manager).toEqual({
      params: { llm_id: 'hand-written-manager', sys_prompt: '老主管' },
    });

    const back = applyTeamProcess(away, 'AgentTeam:Desk', 'hierarchical');
    expect(paramsOf(back).manager).toEqual({
      params: { llm_id: 'hand-written-manager', sys_prompt: '老主管' },
    });
    expect(paramsOf(back).tasks).toEqual([]);
  });

  it('raises the delegation budget to what a multi-round process needs', () => {
    const next = applyTeamProcess(hierarchical(), 'AgentTeam:Desk', 'debate');
    const params = paramsOf(next);
    // 3 tasks × 3 rounds, no judge
    expect(params.max_delegations).toBe(9);
    expect(params.tasks).toHaveLength(3);
  });

  it('only keeps a judge that the process allows and that still resolves', () => {
    const dsl = hierarchical();
    paramsOf(dsl).judge = 'judge';

    const parallel = applyTeamProcess(dsl, 'AgentTeam:Desk', 'parallel');
    expect(paramsOf(parallel).judge).toBe('');

    const vote = applyTeamProcess(dsl, 'AgentTeam:Desk', 'vote');
    // no member is called judge, so the selector would fail the backend check
    expect(paramsOf(vote).judge).toBe('');

    const withJudge = hierarchical();
    (paramsOf(withJudge).workers as IAgentTeamWorker[]).push(
      worker('judge', '裁决人', 'judge'),
    );
    paramsOf(withJudge).judge = 'judge';
    const judged = applyTeamProcess(withJudge, 'AgentTeam:Desk', 'vote');
    expect(paramsOf(judged).judge).toBe('judge');
    // 3 tasks × 1 round + the judge, and never below what the team already had
    expect(paramsOf(judged).max_delegations).toBeGreaterThanOrEqual(4);
    expect(requiredDelegations('vote', 3, 3, true)).toBe(4);
  });

  it('stands a manager up on the crew model when going back to hierarchical', () => {
    const dsl = hierarchical();
    paramsOf(dsl).tasks = [task('alpha'), task('beta')];
    paramsOf(dsl).manager = {};
    // nothing parked on the canvas either, so there is nothing to restore
    formOf(dsl).manager = {};

    const next = applyTeamProcess(dsl, 'AgentTeam:Desk', 'hierarchical', {
      teamName: '并行评审台',
      seed: { manager: '你是主管' },
    });
    const params = paramsOf(next);

    expect(params.tasks).toEqual([]);
    expect(params.manager.params.llm_id).toBe('qwen2.5:3b@local@Ollama');
    expect(params.manager.params.sys_prompt).toBe('你是主管');
  });

  it('writes the same decision onto the graph node the canvas reads', () => {
    const next = applyTeamProcess(hierarchical(), 'AgentTeam:Desk', 'consensus');
    const form = formOf(next);
    expect(form.process).toBe('consensus');
    expect(form.tasks).toHaveLength(3);
    expect(form.manager).toEqual({
      params: { llm_id: 'hand-written-manager', sys_prompt: '老主管' },
    });
  });

  it('leaves an unknown canvas alone', () => {
    const dsl = hierarchical();
    const next = applyTeamProcess(dsl, 'AgentTeam:Missing', 'parallel');
    expect(paramsOf(next).process).toBe('hierarchical');
  });

  it('accepts every process the canvas offers', () => {
    const all: AgentTeamProcess[] = [
      'sequential',
      'hierarchical',
      'parallel',
      'vote',
      'debate',
      'consensus',
    ];
    all.forEach((process) => {
      const next = applyTeamProcess(hierarchical(), 'AgentTeam:Desk', process);
      expect(paramsOf(next).process).toBe(process);
    });
  });
});
