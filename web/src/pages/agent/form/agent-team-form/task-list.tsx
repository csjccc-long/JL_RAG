import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { get } from 'lodash';
import { useCallback } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { TaskCard } from './task-card';
import { useAgentTeamDefaults } from './use-team-form';

function TaskActions({
  index,
  total,
  onMove,
  onDelete,
}: {
  index: number;
  total: number;
  onMove(from: number, to: number): void;
  onDelete(index: number): void;
}) {
  const { t } = useTranslation();
  const moveUp = useCallback(() => {
    onMove(index, index - 1);
  }, [index, onMove]);
  const moveDown = useCallback(() => {
    onMove(index, index + 1);
  }, [index, onMove]);
  const deleteTask = useCallback(() => {
    onDelete(index);
  }, [index, onDelete]);

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        disabled={index === 0}
        onClick={moveUp}
        title={t('flow.agentTeam.moveUp')}
        aria-label={t('flow.agentTeam.moveUp')}
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        disabled={index === total - 1}
        onClick={moveDown}
        title={t('flow.agentTeam.moveDown')}
        aria-label={t('flow.agentTeam.moveDown')}
      >
        <ArrowDown className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-text-secondary hover:text-state-error"
        onClick={deleteTask}
        title={t('common.delete')}
        aria-label={t('common.delete')}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

export function TaskList() {
  const form = useFormContext();
  const { t } = useTranslation();
  const { fields, append, remove, move } = useFieldArray({
    control: form.control,
    name: 'tasks',
  });
  const workers = useWatch({ control: form.control, name: 'workers' }) ?? [];
  const process = useWatch({ control: form.control, name: 'process' });
  const { createTask } = useAgentTeamDefaults();
  const showsVoteHint = process === 'vote' || process === 'consensus';
  const taskListError = get(form.formState.errors, 'tasks');
  const listError = taskListError?.message as string | undefined;

  const handleAdd = useCallback(() => {
    append(createTask(workers[0]?.id ?? ''));
  }, [append, createTask, workers]);

  const handleMove = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= fields.length) {
        return;
      }
      move(from, to);
    },
    [fields.length, move],
  );

  const handleDelete = useCallback(
    (index: number) => {
      remove(index);
    },
    [remove],
  );

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{t('flow.agentTeam.tasks')}</h3>
          <p className="mt-1 text-xs text-text-secondary">
            {t('flow.agentTeam.tasksDescription')}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={handleAdd}>
          <Plus className="mr-1 size-4" />
          {t('flow.agentTeam.addTask')}
        </Button>
      </div>
      {listError && <p className="text-xs text-state-error">{listError}</p>}
      {showsVoteHint && (
        <div className="rounded-md border border-border-button bg-bg-card px-3 py-2 text-xs text-text-secondary">
          {t('flow.agentTeam.voteContractHint')}
        </div>
      )}
      {fields.length === 0 && (
        <div className="rounded-md border border-dashed border-border-button p-6 text-center text-sm text-text-secondary">
          {t('flow.agentTeam.tasksEmpty')}
        </div>
      )}
      <div className="space-y-3">
        {fields.map((field, index) => (
          <section key={field.id} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-text-secondary">
                {t('flow.agentTeam.taskNumber', { index: index + 1 })}
              </span>
              <TaskActions
                index={index}
                total={fields.length}
                onMove={handleMove}
                onDelete={handleDelete}
              />
            </div>
            <TaskCard index={index} />
          </section>
        ))}
      </div>
    </section>
  );
}
