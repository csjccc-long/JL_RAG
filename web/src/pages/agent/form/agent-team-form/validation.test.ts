import {
  IAgentTeamForm,
  IAgentTeamTask,
  IAgentTeamWorker,
} from '@/interfaces/database/agent';
import {
  calculateRequiredDelegations,
  sanitizeAgentTeamValues,
  validateAgentTeam,
} from './validation';

function makeWorker(id: string): IAgentTeamWorker {
  return {
    id,
    name: id,
    role: 'specialist',
    capabilities: ['analysis'],
    description: `${id} worker`,
    agent: {
      params: {
        llm_id: `${id}-model`,
        sys_prompt: '',
        prompts: [{ role: 'user', content: '{sys.query}' }],
        max_rounds: 5,
        tools: [],
      },
    },
  };
}

function makeTask(worker = 'writer'): IAgentTeamTask {
  return {
    worker,
    task: 'Draft an answer',
    expected_output: 'A concise answer',
  };
}

function makeTeam(
  overrides: Partial<IAgentTeamForm> = {},
): IAgentTeamForm {
  const base: IAgentTeamForm = {
    process: 'sequential',
    manager: {},
    workers: [makeWorker('writer')],
    tasks: [makeTask()],
    max_concurrency: 4,
    collaboration_rounds: 3,
    judge: '',
    max_delegations: 8,
    max_depth: 3,
    worker_timeout: 300,
    custom_header: {},
    outputs: {
      content: { type: 'string', value: '' },
      structured: { type: 'object', value: {} },
      delegations: { type: 'Array<Object>', value: [] },
      votes: { type: 'Array<Object>', value: [] },
      rounds: { type: 'Array<Object>', value: [] },
      consensus: { type: 'boolean', value: false },
      winner: { type: 'string', value: null },
      _ERROR: { type: 'string', value: '' },
    },
  };

  return { ...base, ...overrides };
}

function issuesFor(values: IAgentTeamForm) {
  return validateAgentTeam(values).map((issue) => issue.path);
}

describe('validateAgentTeam', () => {
  it('accepts every valid strategy', () => {
    const manager = {
      params: {
        llm_id: 'manager-model',
        sys_prompt: 'Coordinate the team',
        prompts: [{ role: 'user', content: '{sys.query}' }],
        max_rounds: 8,
        tools: [],
      },
    };
    const worker = makeWorker('writer');
    const judgeWorker = makeWorker('judge');

    const validTeams: IAgentTeamForm[] = [
      makeTeam({ process: 'sequential' }),
      makeTeam({
        process: 'hierarchical',
        manager,
        tasks: [],
        judge: '',
      }),
      makeTeam({ process: 'parallel' }),
      makeTeam({
        process: 'vote',
        workers: [worker, judgeWorker],
        tasks: [makeTask('writer'), makeTask('judge')],
        judge: 'judge',
      }),
      makeTeam({
        process: 'debate',
        workers: [worker, judgeWorker],
        tasks: [makeTask('writer'), makeTask('judge')],
        judge: 'judge',
      }),
      makeTeam({
        process: 'consensus',
        workers: [worker, judgeWorker],
        tasks: [makeTask('writer'), makeTask('judge')],
        judge: 'judge',
      }),
    ];

    validTeams.forEach((team) => {
      expect(validateAgentTeam(team)).toEqual([]);
    });
  });

  it('rejects duplicate worker ids and dangling task references', () => {
    const paths = issuesFor(
      makeTeam({
        workers: [makeWorker('writer'), makeWorker('writer')],
        tasks: [makeTask('missing')],
      }),
    );

    expect(paths).toEqual(
      expect.arrayContaining(['workers.1.id', 'tasks.0.worker']),
    );
  });

  it('normalizes worker ids and resolves backend-compatible selectors', () => {
    const researcher = {
      ...makeWorker('Researcher'),
      name: 'Evidence Scout',
      role: 'analyst',
      capabilities: ['research', 'evidence'],
    };
    const reviewer = {
      ...makeWorker('Reviewer'),
      name: 'Quality Gate',
      role: 'reviewer',
      capabilities: ['quality'],
    };
    const values = makeTeam({
      process: 'debate',
      workers: [researcher, reviewer],
      tasks: [
        makeTask(' evidence scout '),
        makeTask('EVIDENCE'),
      ],
      judge: ' quality gate ',
      max_delegations: 8,
    });

    expect(validateAgentTeam(values)).toEqual([]);
    expect(
      issuesFor(
        makeTeam({
          workers: [makeWorker(' writer '), makeWorker('WRITER')],
        }),
      ),
    ).toContain('workers.1.id');
  });

  it('rejects ambiguous worker selectors', () => {
    expect(
      validateAgentTeam(
        makeTeam({
          workers: [makeWorker('first'), makeWorker('second')],
          tasks: [makeTask('ANALYSIS')],
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'tasks.0.worker',
          messageKey:
            'flow.agentTeam.validation.workerSelectorAmbiguous',
        }),
      ]),
    );
  });

  it('rejects missing worker models and missing manager model', () => {
    const writer = makeWorker('writer');
    writer.agent.params.llm_id = '';

    expect(issuesFor(makeTeam({ workers: [writer] }))).toContain(
      'workers.0.agent.params.llm_id',
    );
    expect(
      issuesFor(
        makeTeam({
          process: 'hierarchical',
          manager: { params: {} },
          tasks: [],
        }),
      ),
    ).toContain('manager.params.llm_id');
  });

  it('rejects strategy-incompatible task, manager, and judge values', () => {
    const manager = {
      params: { ...makeWorker('manager').agent.params },
    };

    expect(
      issuesFor(
        makeTeam({ process: 'hierarchical', manager, tasks: [makeTask()] }),
      ),
    ).toContain('tasks');
    expect(
      issuesFor(
        makeTeam({ process: 'sequential', manager, tasks: [makeTask()] }),
      ),
    ).toContain('manager');
    expect(
      issuesFor(makeTeam({ process: 'parallel', judge: 'writer' })),
    ).toContain('judge');
  });

  it('rejects invalid judge references and numeric bounds', () => {
    const paths = issuesFor(
      makeTeam({
        process: 'vote',
        judge: 'missing',
        max_concurrency: 0,
        collaboration_rounds: 0,
        max_delegations: 0,
        max_depth: 0,
        worker_timeout: 0,
      }),
    );

    expect(paths).toEqual(
      expect.arrayContaining([
        'judge',
        'max_concurrency',
        'collaboration_rounds',
        'max_delegations',
        'max_depth',
        'worker_timeout',
      ]),
    );
  });

  it('rejects fractional integer bounds and non-finite timeouts', () => {
    const paths = issuesFor(
      makeTeam({
        max_concurrency: 1.5,
        collaboration_rounds: 2.5,
        max_delegations: 3.5,
        max_depth: 2.5,
        worker_timeout: Number.NaN,
      }),
    );

    expect(paths).toEqual(
      expect.arrayContaining([
        'max_concurrency',
        'collaboration_rounds',
        'max_delegations',
        'max_depth',
        'worker_timeout',
      ]),
    );
  });

  it('rejects invalid Agent reflection limits', () => {
    const worker = makeWorker('writer');
    worker.agent.params.max_rounds = 1.5;
    const manager = { params: { ...makeWorker('manager').agent.params } };
    manager.params.max_rounds = -1;

    const workerIssues = validateAgentTeam(makeTeam({ workers: [worker] }));
    const managerIssues = validateAgentTeam(
      makeTeam({
        process: 'hierarchical',
        manager,
        tasks: [],
      }),
    );

    expect(workerIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'workers.0.agent.params.max_rounds',
          messageKey: 'flow.agentTeam.validation.nonNegativeInteger',
        }),
      ]),
    );
    expect(managerIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'manager.params.max_rounds',
          messageKey: 'flow.agentTeam.validation.nonNegativeInteger',
        }),
      ]),
    );
  });

  it('rejects a budget below the worst-case delegation count', () => {
    const issues = validateAgentTeam(
      makeTeam({
        process: 'debate',
        collaboration_rounds: 2,
        max_delegations: 1,
      }),
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'max_delegations',
          messageKey: 'flow.agentTeam.validation.budget',
          values: { required: 2 },
        }),
      ]),
    );
  });
});

describe('calculateRequiredDelegations', () => {
  it('matches the backend budget for all strategies', () => {
    expect(
      calculateRequiredDelegations(makeTeam({ process: 'sequential' })),
    ).toBe(1);
    expect(
      calculateRequiredDelegations(makeTeam({ process: 'parallel' })),
    ).toBe(1);
    expect(calculateRequiredDelegations(makeTeam({ process: 'vote' }))).toBe(1);
    expect(
      calculateRequiredDelegations(
        makeTeam({
          process: 'debate',
          tasks: [makeTask(), makeTask()],
          collaboration_rounds: 3,
          judge: 'writer',
        }),
      ),
    ).toBe(7);
    expect(
      calculateRequiredDelegations(
        makeTeam({
          process: 'consensus',
          collaboration_rounds: 2,
          judge: 'writer',
        }),
      ),
    ).toBe(3);
    expect(
      calculateRequiredDelegations(makeTeam({ process: 'hierarchical' })),
    ).toBeNull();
  });
});

describe('sanitizeAgentTeamValues', () => {
  it('removes inactive strategy fields without mutating the input', () => {
    const source = makeTeam({
      process: 'hierarchical',
      manager: { params: { ...makeWorker('manager').agent.params } },
      tasks: [makeTask()],
      judge: 'writer',
    });

    const sanitized = sanitizeAgentTeamValues(source);

    expect(sanitized.tasks).toEqual([]);
    expect(sanitized.judge).toBe('');
    expect(source.tasks).toHaveLength(1);
    expect(sanitized.manager).toEqual(source.manager);
  });

  it('clears manager and unsupported judge for non-hierarchical strategies', () => {
    const sanitized = sanitizeAgentTeamValues(
      makeTeam({
        process: 'parallel',
        manager: { params: { llm_id: 'manager-model' } },
        judge: 'writer',
      }),
    );

    expect(sanitized.manager).toEqual({});
    expect(sanitized.judge).toBe('');
  });

  it('keeps invalid hidden guardrails from blocking the backend contract', () => {
    const hierarchical = sanitizeAgentTeamValues(
      makeTeam({
        process: 'hierarchical',
        manager: { params: { ...makeWorker('manager').agent.params } },
        tasks: [],
        max_concurrency: 0,
        collaboration_rounds: 0,
      }),
    );
    const sequential = sanitizeAgentTeamValues(
      makeTeam({ collaboration_rounds: 0 }),
    );

    expect(hierarchical.max_concurrency).toBe(4);
    expect(hierarchical.collaboration_rounds).toBe(3);
    expect(sequential.collaboration_rounds).toBe(3);
    expect(validateAgentTeam(hierarchical)).toEqual([]);
    expect(validateAgentTeam(sequential)).toEqual([]);
  });
});
