import {
  AgentTeamProcess,
  DSL,
  IAgentTeamAgentConfig,
  IAgentTeamForm,
  IAgentTeamTask,
  IAgentTeamWorker,
} from '@/interfaces/database/agent';

/* ── switching how a team collaborates, without breaking it ────
   The process is not a label on the team, it is a contract the backend checks
   before a run (agent/component/agent_team.py:553 AgentTeamParam.check):

     · hierarchical reads a manager agent and refuses tasks and a judge;
     · every other process refuses a manager, needs a non-empty task list, and
       only vote / debate / consensus may carry a judge;
     · max_delegations has to cover what the process will actually delegate
       (parallel = tasks, vote = tasks + judge, debate/consensus =
       tasks × rounds + judge).

   So a switch cannot be "write process and save": a hierarchical team has no
   tasks, and a parallel team has no manager. This module makes the smallest
   change that leaves the team runnable:

     · to hierarchical: empty the tasks, drop the judge, and take the manager
       from the canvas form if one was there before, else stand one up on the
       crew's own model;
     · to anything else: drop the manager, keep the tasks that still point at a
       member (else one per member), keep the judge only when the process allows
       one and it still resolves to a member, and raise the delegation budget to
       the minimum the process needs.

   Dropped managers and judges are remembered on the graph node's form, which is
   what the canvas reads — so switching away and back does not silently replace
   a hand-written manager brief with a generated one. */

export const JUDGE_PROCESSES: AgentTeamProcess[] = ['vote', 'debate', 'consensus'];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/** how many delegations the process will spend, in the backend's own terms */
export const requiredDelegations = (
  process: AgentTeamProcess,
  taskCount: number,
  rounds: number,
  hasJudge: boolean,
): number => {
  const judge = hasJudge ? 1 : 0;
  if (process === 'parallel') return taskCount;
  if (process === 'vote') return taskCount + judge;
  if (process === 'debate' || process === 'consensus') {
    return taskCount * Math.max(1, rounds) + judge;
  }
  return taskCount;
};

const workerLabels = (worker: IAgentTeamWorker): string[] =>
  [
    worker.id,
    worker.name,
    worker.role,
    ...(Array.isArray(worker.capabilities) ? worker.capabilities : []),
  ]
    .filter((label): label is string => typeof label === 'string' && !!label.trim())
    .map((label) => label.trim().toLowerCase());

/** backend WorkerRegistry.resolve: id first, then a unique name or role */
export const resolvesToWorker = (
  workers: IAgentTeamWorker[],
  selector?: string,
): boolean => {
  const needle = String(selector ?? '').trim().toLowerCase();
  if (!needle) return false;
  if (workers.some((worker) => workerLabels(worker)[0] === needle)) return true;
  const named = workers.filter((worker) =>
    [worker.name, worker.role].some(
      (label) => String(label ?? '').trim().toLowerCase() === needle,
    ),
  );
  return named.length === 1;
};

export interface ProcessSeedText {
  /** the instruction written for a member when the team has no tasks yet */
  task: (worker: IAgentTeamWorker) => string;
  /** what that member must hand back — the backend refuses an empty one */
  expected: string;
  /** the standing brief a synthesised manager is given */
  manager: string;
}

export const seedTaskText = (worker: IAgentTeamWorker): string =>
  `从「${worker.name || worker.id}」的角度独立评审这次任务：给出你的判断、依据、风险，以及你建议的处理方式。`;

export const seedExpectedText = (): string =>
  '你的判断、依据与建议，能直接汇总进团队的最终答复。';

export const managerBrief = (teamName: string): string =>
  `你是「${teamName || '团队'}」的主管。收到任务后先把它拆成互相独立的子任务，再逐个用 delegate_task 派给最合适的成员；每个成员只做一件明确的事。最后汇总他们的结论，给出你自己的最终答复，不要直接替成员完成工作。`;

/** one task per member, so a team that only ever had a manager becomes runnable */
export const tasksFor = (
  workers: IAgentTeamWorker[],
  seed: ProcessSeedText,
): IAgentTeamTask[] =>
  workers.map((worker) => ({
    worker: worker.id,
    task: seed.task(worker),
    expected_output: seed.expected || seedExpectedText(),
  }));

/** a manager stands on the crew's own model, so it runs without new setup */
export const managerFor = (
  workers: IAgentTeamWorker[],
  seed: ProcessSeedText,
): IAgentTeamAgentConfig | Record<string, never> => {
  const seedWorker =
    workers.find(
      (worker) =>
        !!worker.agent?.params && Object.keys(worker.agent.params).length > 0,
    ) ?? workers[0];
  const params = asRecord(seedWorker?.agent?.params);
  if (Object.keys(params).length === 0) return {};
  return { params: { ...clone(params), sys_prompt: seed.manager } };
};

const hasManager = (manager: unknown): boolean =>
  Object.keys(asRecord(asRecord(manager).params ?? manager)).length > 0;

export interface ApplyProcessOptions {
  /** the team's name, so a synthesised manager brief can name it */
  teamName?: string;
  seed?: Partial<ProcessSeedText>;
}

const DEFAULT_SEED: ProcessSeedText = {
  task: seedTaskText,
  expected: seedExpectedText(),
  manager: '',
};

export const applyTeamProcess = (
  dsl: Partial<DSL> | null | undefined,
  componentId: string,
  process: AgentTeamProcess,
  options: ApplyProcessOptions = {},
): DSL => {
  const next = clone((dsl ?? {}) as DSL);
  const operator = next.components?.[componentId];
  const params = operator?.obj?.params as Partial<IAgentTeamForm> | undefined;
  if (!params) return next;

  /* the node's data is a union of every component's form type, and this file
     writes four fields of one of them — a shape the union cannot describe */
  const node = (next.graph?.nodes ?? []).find(
    (item) => item.id === componentId,
  ) as (Record<string, unknown> & { data?: Record<string, unknown> }) | undefined;
  const form = asRecord(node?.data?.form);

  const seed: ProcessSeedText = {
    task: options.seed?.task ?? DEFAULT_SEED.task,
    expected: options.seed?.expected ?? DEFAULT_SEED.expected,
    manager:
      options.seed?.manager ??
      managerBrief(options.teamName ?? String(form.title ?? '')),
  };

  const workers = Array.isArray(params.workers) ? params.workers : [];
  const rounds =
    Number(params.collaboration_rounds) > 0
      ? Number(params.collaboration_rounds)
      : 3;

  let tasks = Array.isArray(params.tasks) ? params.tasks : [];
  let judge = typeof params.judge === 'string' ? params.judge : '';
  const previousManager: unknown = params.manager ?? {};
  let manager: unknown = previousManager;

  /* the canvas form is the place a manager or a judge waits while the process
     cannot carry one, so a round trip does not throw the author's brief away */
  const shelvedManager = form.manager;
  const shelvedJudge = typeof form.judge === 'string' ? form.judge : '';

  if (process === 'hierarchical') {
    tasks = [];
    judge = '';
    const candidate = hasManager(manager)
      ? manager
      : hasManager(shelvedManager)
        ? shelvedManager
        : managerFor(workers, seed);
    manager = clone(candidate);
  } else {
    manager = {};
    const usable = tasks.filter((task) =>
      resolvesToWorker(workers, (task as IAgentTeamTask)?.worker),
    );
    tasks = usable.length > 0 ? usable : tasksFor(workers, seed);
    const allowed = JUDGE_PROCESSES.includes(process);
    const preferred = allowed ? judge || shelvedJudge : '';
    judge =
      allowed && resolvesToWorker(workers, preferred) ? preferred.trim() : '';
  }

  const delegations = Math.max(
    Number(params.max_delegations) > 0 ? Number(params.max_delegations) : 8,
    requiredDelegations(process, tasks.length, rounds, !!judge),
  );

  Object.assign(params as Record<string, unknown>, {
    process,
    manager,
    tasks,
    judge,
    max_delegations: delegations,
  });

  /* the canvas reads the node's form, the backend reads the component: both are
     written from the same decision so they cannot disagree */
  if (node) {
    const data = (node.data ??= {});
    const nextForm = asRecord(data.form);
    Object.assign(nextForm, {
      process,
      tasks,
      judge,
      max_delegations: delegations,
    });
    if (process === 'hierarchical') {
      /* what actually runs */
      nextForm.manager = manager;
    } else {
      /* parked, not deleted: the canvas still shows the brief someone wrote,
         and switching back to hierarchical picks it up again */
      nextForm.manager = hasManager(previousManager)
        ? previousManager
        : shelvedManager;
      nextForm.judge = judge || shelvedJudge;
    }
    data.form = nextForm;
  }

  return next;
};
