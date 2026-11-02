import { Collapse } from '@/components/collapse';
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
import { Button } from '@/components/ui/button';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { BlurTextarea } from '@/components/ui/textarea';
import { Trash2, UserRound } from 'lucide-react';
import { useCallback } from 'react';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { AgentConfigFields } from './agent-config-fields';

function CapabilityInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange(value: string[]): void;
}) {
  const text = Array.isArray(value) ? value.join(', ') : '';
  const handleChange = useCallback(
    (nextValue: unknown) => {
      onChange(
        String(nextValue ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      );
    },
    [onChange],
  );

  return (
    <BlurTextarea
      value={text}
      onChange={handleChange}
      rows={1}
      className="min-h-10"
    />
  );
}

export function WorkerCard({
  index,
  referenced,
  onDelete,
}: {
  index: number;
  referenced: boolean;
  onDelete(index: number): void;
}) {
  const form = useFormContext();
  const { t } = useTranslation();
  const prefix = `workers.${index}`;
  const handleDelete = useCallback(() => {
    onDelete(index);
  }, [index, onDelete]);

  return (
    <section className="rounded-md border border-border-button bg-bg-input p-3">
      <Collapse
        defaultOpen={index === 0}
        title={
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <UserRound className="size-4 shrink-0" />
            <span className="truncate">
              {form.watch(`${prefix}.name`) ||
                form.watch(`${prefix}.id`) ||
                t('flow.agentTeam.workerFallback', { index: index + 1 })}
            </span>
          </span>
        }
        rightContent={
          <ConfirmDeleteDialog
            hidden={!referenced}
            title={t('flow.agentTeam.removeWorkerTitle')}
            content={{ title: t('flow.agentTeam.removeWorkerReferenced') }}
            onOk={handleDelete}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-text-secondary hover:text-state-error"
              title={t('common.delete')}
              aria-label={t('common.delete')}
            >
              <Trash2 className="size-4" />
            </Button>
          </ConfirmDeleteDialog>
        }
      >
        <section className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name={`${prefix}.id`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('flow.agentTeam.workerId')}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`${prefix}.name`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('flow.agentTeam.workerName')}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name={`${prefix}.role`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('flow.agentTeam.workerRole')}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`${prefix}.capabilities`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('flow.agentTeam.capabilities')}</FormLabel>
                  <FormControl>
                    <CapabilityInput
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name={`${prefix}.description`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('flow.agentTeam.workerDescription')}</FormLabel>
                <FormControl>
                  <BlurTextarea
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    resize="vertical"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <AgentConfigFields prefix={`${prefix}.agent.params`} />
        </section>
      </Collapse>
    </section>
  );
}
