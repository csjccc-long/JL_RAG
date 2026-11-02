import { useFetchDefaultModelDictionary } from '@/hooks/use-llm-request';
import {
  IAgentTeamForm,
  IAgentTeamNode,
  IAgentTeamTask,
  IAgentTeamWorker,
} from '@/interfaces/database/agent';
import { useEffect, useMemo } from 'react';
import { get } from 'lodash';
import { UseFormReturn, useWatch } from 'react-hook-form';
import { initialAgentTeamValues } from '../../constant';
import useGraphStore from '../../store';
import {
  normalizeCapabilities,
  normalizeWorkerSelector,
  resolveWorkerSelector,
  sanitizeAgentTeamValues,
} from './validation';

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultAgentParams(llmId: string) {
  return {
    llm_id: llmId,
    sys_prompt: '',
    prompts: [{ role: 'user', content: '{sys.query}' }],
    max_rounds: 5,
    tools: [],
  };
}

function cloneTeamDefaults(): IAgentTeamForm {
  return {
    ...initialAgentTeamValues,
    manager: {
      params: {
        ...initialAgentTeamValues.manager.params,
        prompts: initialAgentTeamValues.manager.params.prompts.map(
          (prompt) => ({
            ...prompt,
          }),
        ),
      },
    },
    workers: [],
    tasks: [],
    custom_header: {},
    outputs: { ...initialAgentTeamValues.outputs },
  };
}

export function useAgentTeamValues(node?: IAgentTeamNode): IAgentTeamForm {
  const { llm_id: defaultLlmId } = useFetchDefaultModelDictionary();

  return useMemo(() => {
    const source = node?.data?.form;
    const base = cloneTeamDefaults();
    const sourceManagerParams = get(source, 'manager.params');
    const managerParams = isRecord(sourceManagerParams)
      ? sourceManagerParams
      : base.manager.params;
    const sourceWorkers = Array.isArray(source?.workers)
      ? source.workers
      : [];
    const workers: IAgentTeamWorker[] = sourceWorkers
      .filter(isRecord)
      .map((worker) => ({
        ...worker,
        id: String(worker.id ?? ''),
        name: String(worker.name ?? ''),
        role: String(worker.role ?? ''),
        capabilities: normalizeCapabilities(worker.capabilities),
        description: String(worker.description ?? ''),
        agent: {
          ...(isRecord(worker.agent) ? worker.agent : {}),
          params: {
            ...defaultAgentParams(defaultLlmId),
            ...(isRecord(worker.agent?.params) ? worker.agent.params : {}),
          },
        },
      }));
    const canonicalWorkerId = (selector: unknown) => {
      const value = String(selector ?? '').trim();
      return resolveWorkerSelector(workers, value).worker?.id ?? value;
    };
    const sourceTasks = Array.isArray(source?.tasks) ? source.tasks : [];
    const tasks: IAgentTeamTask[] = sourceTasks
      .filter(isRecord)
      .map((task) => ({
        ...task,
        worker: canonicalWorkerId(task.worker),
        task: String(task.task ?? ''),
        context: String(task.context ?? ''),
        expected_output: String(task.expected_output ?? ''),
      }));

    return sanitizeAgentTeamValues({
      ...base,
      ...(isRecord(source) ? source : {}),
      process: source?.process ?? base.process,
      manager: {
        params: {
          ...base.manager.params,
          ...managerParams,
          llm_id: managerParams.llm_id || defaultLlmId,
        },
      },
      workers,
      tasks,
      judge: canonicalWorkerId(source?.judge),
      custom_header: isRecord(source?.custom_header)
        ? { ...source.custom_header }
        : {},
      outputs: {
        ...base.outputs,
        ...(isRecord(source?.outputs) ? source.outputs : {}),
      },
    });
  }, [defaultLlmId, node?.data?.form]);
}

export function useAgentTeamDefaults() {
  const { llm_id: defaultLlmId } = useFetchDefaultModelDictionary();

  const createWorker = (
    workers: IAgentTeamWorker[],
    index: number,
  ): IAgentTeamWorker => {
    const ids = new Set(
      workers.map((worker) => normalizeWorkerSelector(worker.id)),
    );
    let suffix = index + 1;
    while (ids.has(normalizeWorkerSelector(`worker_${suffix}`))) {
      suffix += 1;
    }
    const id = `worker_${suffix}`;
    return {
      id,
      name: `Worker ${suffix}`,
      role: '',
      capabilities: [],
      description: '',
      agent: { params: defaultAgentParams(defaultLlmId) },
    };
  };

  const createTask = (workerId = ''): IAgentTeamTask => ({
    worker: workerId,
    task: '',
    context: '',
    expected_output: '',
  });

  return { createWorker, createTask };
}

export function useAgentTeamWatchFormChange(
  id: string | undefined,
  form: UseFormReturn<IAgentTeamForm>,
) {
  const values = useWatch({ control: form.control });
  const updateNodeForm = useGraphStore((state) => state.updateNodeForm);

  useEffect(() => {
    if (!id || !form.formState.isDirty) {
      return;
    }
    updateNodeForm(
      id,
      sanitizeAgentTeamValues(form.getValues()) as unknown as Record<
        string,
        unknown
      >,
    );
  }, [form.formState.isDirty, id, updateNodeForm, values]);
}
