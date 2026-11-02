import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { get } from 'lodash';
import { useCallback } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { IAgentTeamForm } from '@/interfaces/database/agent';
import { useAgentTeamDefaults } from './use-team-form';
import {
  normalizeWorkerSelector,
  resolveWorkerSelector,
} from './validation';
import { WorkerCard } from './worker-card';

function pointsToWorker(
  workers: Parameters<typeof resolveWorkerSelector>[0],
  selector: unknown,
  workerId: unknown,
) {
  const resolved = resolveWorkerSelector(workers, selector);
  return (
    Boolean(resolved.worker) &&
    normalizeWorkerSelector(resolved.worker?.id) ===
      normalizeWorkerSelector(workerId)
  );
}

function collectWorkerIdMessages(value: unknown): string[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => /^\d+$/.test(key))
    .map(([, workerError]): unknown => get(workerError, 'id.message'))
    .filter((message: unknown): message is string => typeof message === 'string');
}

export function WorkerList() {
  const form = useFormContext<IAgentTeamForm>();
  const { t } = useTranslation();
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'workers',
  });
  const workers =
    useWatch({ control: form.control, name: 'workers' }) ?? [];
  const tasks =
    useWatch({ control: form.control, name: 'tasks' }) ?? [];
  const judge = useWatch({ control: form.control, name: 'judge' });
  const { createWorker } = useAgentTeamDefaults();

  const handleAdd = useCallback(() => {
    append(createWorker(workers, workers.length));
  }, [append, createWorker, workers]);

  const handleDelete = useCallback(
    (index: number) => {
      const worker = workers[index];
      const workerId = worker?.id;
      remove(index);
      if (!workerId) {
        return;
      }

      const nextTasks = tasks.filter(
        (task) => !pointsToWorker(workers, task.worker, workerId),
      );
      if (nextTasks.length !== tasks.length) {
        form.setValue('tasks', nextTasks, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
      if (pointsToWorker(workers, judge, workerId)) {
        form.setValue('judge', '', {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    },
    [form, judge, remove, tasks, workers],
  );

  const workerListError = get(form.formState.errors, 'workers');
  const listErrors = Array.from(
    new Set([
      ...(typeof workerListError === 'string'
        ? [workerListError]
        : [
            get(workerListError, 'message'),
            ...collectWorkerIdMessages(workerListError),
          ]),
    ].filter((message): message is string => typeof message === 'string')),
  );

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{t('flow.agentTeam.workers')}</h3>
          <p className="mt-1 text-xs text-text-secondary">
            {t('flow.agentTeam.workersDescription')}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={handleAdd}>
          <Plus className="mr-1 size-4" />
          {t('flow.agentTeam.addWorker')}
        </Button>
      </div>
      {fields.length === 0 && (
        <div className="rounded-md border border-dashed border-border-button p-6 text-center text-sm text-text-secondary">
          {t('flow.agentTeam.workersEmpty')}
        </div>
      )}
      <div className="space-y-3">
        {fields.map((field, index) => {
          const workerId = workers[index]?.id;
          const referenced =
            Boolean(workerId) &&
            (tasks.some((task) => pointsToWorker(workers, task.worker, workerId)) ||
              pointsToWorker(workers, judge, workerId));
          return (
            <WorkerCard
              key={field.id}
              index={index}
              referenced={referenced}
              onDelete={handleDelete}
            />
          );
        })}
      </div>
      {listErrors.map((message) => (
        <p key={message} className="text-xs text-state-error">
          {message}
        </p>
      ))}
    </section>
  );
}
