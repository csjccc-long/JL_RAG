import {
  AgentTeamProcess,
  IAgentTeamForm,
  IAgentTeamWorker,
} from '@/interfaces/database/agent';
import {
  AGENT_TEAM_JUDGE_PROCESSES,
  AGENT_TEAM_PROCESSES,
  AgentTeamValidationIssue,
} from './interface';

type WorkerSelectorAttribute = 'name' | 'role' | 'capability';

export interface WorkerResolution {
  worker?: IAgentTeamWorker;
  ambiguousBy?: WorkerSelectorAttribute;
}

function issue(
  path: string,
  messageKey: string,
  values?: Record<string, unknown>,
): AgentTeamValidationIssue {
  return { path, messageKey, values };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyObject(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0;
}

export function normalizeCapabilities(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];
  return values
    .map((capability) => String(capability ?? '').trim())
    .filter(Boolean);
}

export function normalizeWorkerSelector(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function agentParams(config: unknown): Record<string, any> {
  if (!isRecord(config) || !isRecord(config.params)) {
    return {};
  }
  return config.params;
}

function validateAgentParams(
  issues: AgentTeamValidationIssue[],
  config: unknown,
  path: string,
) {
  const params = agentParams(config);
  if (!String(params.llm_id ?? '').trim()) {
    issues.push(
      issue(`${path}.llm_id`, 'flow.agentTeam.validation.modelRequired'),
    );
  }
  if (
    params.max_rounds !== undefined &&
    (typeof params.max_rounds !== 'number' ||
      !Number.isInteger(params.max_rounds) ||
      params.max_rounds < 0)
  ) {
    issues.push(
      issue(
        `${path}.max_rounds`,
        'flow.agentTeam.validation.nonNegativeInteger',
      ),
    );
  }
}

function matchesWorkerAttribute(
  worker: IAgentTeamWorker,
  attribute: WorkerSelectorAttribute,
  selector: string,
) {
  if (attribute === 'capability') {
    return normalizeCapabilities(worker.capabilities).some(
      (capability) => normalizeWorkerSelector(capability) === selector,
    );
  }
  return normalizeWorkerSelector(worker[attribute]) === selector;
}

// Mirrors backend WorkerRegistry.resolve: ID first, then a unique name,
// role, or capability. Accepting selectors here keeps imported DSL and
// manually authored values aligned with runtime resolution.
export function resolveWorkerSelector(
  workers: IAgentTeamWorker[],
  selector: unknown,
): WorkerResolution {
  const needle = normalizeWorkerSelector(selector);
  if (!needle) {
    return {};
  }

  const byId = workers.find(
    (worker) => normalizeWorkerSelector(worker?.id) === needle,
  );
  if (byId) {
    return { worker: byId };
  }

  const attributes: WorkerSelectorAttribute[] = [
    'name',
    'role',
    'capability',
  ];
  for (const attribute of attributes) {
    const matches = workers.filter((worker) =>
      matchesWorkerAttribute(worker, attribute, needle),
    );
    if (matches.length === 1) {
      return { worker: matches[0] };
    }
    if (matches.length > 1) {
      return { ambiguousBy: attribute };
    }
  }

  return {};
}

export function sanitizeAgentTeamValues(
  values: IAgentTeamForm,
): IAgentTeamForm {
  const process = values.process;
  const isHierarchical = process === 'hierarchical';
  const supportsJudge = AGENT_TEAM_JUDGE_PROCESSES.includes(process);
  const workers = Array.isArray(values.workers) ? values.workers : [];
  const tasks = Array.isArray(values.tasks) ? values.tasks : [];
  const positiveIntegerOr = (value: number, fallback: number) =>
    Number.isInteger(value) && value > 0 ? value : fallback;

  return {
    ...values,
    manager:
      isHierarchical && isRecord(values.manager) ? { ...values.manager } : {},
    tasks: isHierarchical ? [] : tasks.map((task) => ({ ...task })),
    max_concurrency: isHierarchical
      ? positiveIntegerOr(values.max_concurrency, 4)
      : values.max_concurrency,
    collaboration_rounds:
      process === 'debate' || process === 'consensus'
        ? values.collaboration_rounds
        : positiveIntegerOr(values.collaboration_rounds, 3),
    judge:
      isHierarchical || !supportsJudge
        ? ''
        : String(values.judge ?? '').trim(),
    workers: workers.map((worker) => ({
      ...worker,
      capabilities: normalizeCapabilities(worker.capabilities),
      agent: {
        ...(isRecord(worker.agent) ? worker.agent : {}),
        params: { ...agentParams(worker.agent) },
      },
    })),
    custom_header: isRecord(values.custom_header)
      ? { ...values.custom_header }
      : {},
    outputs: isRecord(values.outputs) ? { ...values.outputs } : {},
  };
}

export function calculateRequiredDelegations(
  values: IAgentTeamForm,
): number | null {
  const tasks = Array.isArray(values.tasks) ? values.tasks : [];
  const taskCount = tasks.length;
  const hasJudge = Boolean(String(values.judge ?? '').trim());
  const rounds = Number(values.collaboration_rounds);

  switch (values.process) {
    case 'sequential':
    case 'parallel':
      return taskCount;
    case 'vote':
      return taskCount + Number(hasJudge);
    case 'debate':
    case 'consensus':
      return taskCount * rounds + Number(hasJudge);
    case 'hierarchical':
      return null;
    default:
      return null;
  }
}

function pushInvalidSelector(
  issues: AgentTeamValidationIssue[],
  path: string,
  selector: string,
  resolution: WorkerResolution,
  messageKey = 'flow.agentTeam.validation.workerReference',
) {
  if (resolution.ambiguousBy) {
    issues.push(
      issue(path, 'flow.agentTeam.validation.workerSelectorAmbiguous', {
        id: selector,
        attribute: resolution.ambiguousBy,
      }),
    );
    return;
  }
  issues.push(
    issue(path, messageKey, {
      id: selector,
    }),
  );
}

export function validateAgentTeam(
  values: IAgentTeamForm,
): AgentTeamValidationIssue[] {
  const issues: AgentTeamValidationIssue[] = [];
  const process = values.process as AgentTeamProcess | string;
  const workers = Array.isArray(values.workers) ? values.workers : [];
  const tasks = Array.isArray(values.tasks) ? values.tasks : [];
  const judge = String(values.judge ?? '').trim();

  if (!AGENT_TEAM_PROCESSES.includes(process as AgentTeamProcess)) {
    issues.push(
      issue('process', 'flow.agentTeam.validation.process', { process }),
    );
  }

  if (workers.length === 0) {
    issues.push(issue('workers', 'flow.agentTeam.validation.workersRequired'));
  }

  const workerIds = new Set<string>();
  workers.forEach((worker, index) => {
    const workerId = String(worker?.id ?? '').trim();
    const normalizedWorkerId = normalizeWorkerSelector(workerId);
    if (!workerId) {
      issues.push(
        issue(`workers.${index}.id`, 'flow.agentTeam.validation.workerId'),
      );
    } else if (workerIds.has(normalizedWorkerId)) {
      issues.push(
        issue(
          `workers.${index}.id`,
          'flow.agentTeam.validation.workerIdDuplicate',
          { id: workerId },
        ),
      );
    } else {
      workerIds.add(normalizedWorkerId);
    }

    validateAgentParams(
      issues,
      worker?.agent,
      `workers.${index}.agent.params`,
    );
  });

  if (values.process === 'hierarchical') {
    validateAgentParams(issues, values.manager, 'manager.params');
    if (tasks.length > 0) {
      issues.push(
        issue('tasks', 'flow.agentTeam.validation.hierarchicalTasks'),
      );
    }
    if (judge) {
      issues.push(
        issue('judge', 'flow.agentTeam.validation.hierarchicalJudge'),
      );
    }
  } else {
    if (isNonEmptyObject(values.manager)) {
      issues.push(
        issue('manager', 'flow.agentTeam.validation.tasksManager'),
      );
    }
    if (tasks.length === 0) {
      issues.push(issue('tasks', 'flow.agentTeam.validation.tasksRequired'));
    }

    tasks.forEach((task, index) => {
      const worker = String(task?.worker ?? '').trim();
      if (!worker) {
        issues.push(
          issue(`tasks.${index}.worker`, 'flow.agentTeam.validation.taskWorker'),
        );
      } else {
        const resolution = resolveWorkerSelector(workers, worker);
        if (!resolution.worker) {
          pushInvalidSelector(
            issues,
            `tasks.${index}.worker`,
            worker,
            resolution,
          );
        }
      }
      if (!String(task?.task ?? '').trim()) {
        issues.push(
          issue(`tasks.${index}.task`, 'flow.agentTeam.validation.taskRequired'),
        );
      }
      if (!String(task?.expected_output ?? '').trim()) {
        issues.push(
          issue(
            `tasks.${index}.expected_output`,
            'flow.agentTeam.validation.expectedOutputRequired',
          ),
        );
      }
    });

    if (judge && !AGENT_TEAM_JUDGE_PROCESSES.includes(values.process)) {
      issues.push(
        issue('judge', 'flow.agentTeam.validation.judgeUnsupported'),
      );
    } else if (judge) {
      const resolution = resolveWorkerSelector(workers, judge);
      if (!resolution.worker) {
        pushInvalidSelector(
          issues,
          'judge',
          judge,
          resolution,
          'flow.agentTeam.validation.judgeReference',
        );
      }
    }
  }

  if (
    typeof values.max_concurrency !== 'number' ||
    !Number.isInteger(values.max_concurrency) ||
    values.max_concurrency < 1
  ) {
    issues.push(
      issue('max_concurrency', 'flow.agentTeam.validation.positiveInteger'),
    );
  }
  if (
    typeof values.collaboration_rounds !== 'number' ||
    !Number.isInteger(values.collaboration_rounds) ||
    values.collaboration_rounds < 1
  ) {
    issues.push(
      issue(
        'collaboration_rounds',
        'flow.agentTeam.validation.positiveInteger',
      ),
    );
  }
  if (
    typeof values.max_delegations !== 'number' ||
    !Number.isInteger(values.max_delegations) ||
    values.max_delegations < 1
  ) {
    issues.push(
      issue('max_delegations', 'flow.agentTeam.validation.positiveInteger'),
    );
  }
  if (
    typeof values.max_depth !== 'number' ||
    !Number.isInteger(values.max_depth) ||
    values.max_depth < 1
  ) {
    issues.push(
      issue('max_depth', 'flow.agentTeam.validation.positiveInteger'),
    );
  }
  if (
    typeof values.worker_timeout !== 'number' ||
    !Number.isFinite(values.worker_timeout) ||
    values.worker_timeout <= 0
  ) {
    issues.push(
      issue('worker_timeout', 'flow.agentTeam.validation.positiveNumber'),
    );
  }

  const required = calculateRequiredDelegations(values);
  if (
    required !== null &&
    typeof values.max_delegations === 'number' &&
    Number.isInteger(values.max_delegations) &&
    values.max_delegations < required
  ) {
    issues.push(
      issue('max_delegations', 'flow.agentTeam.validation.budget', {
        required,
      }),
    );
  }

  return issues;
}
