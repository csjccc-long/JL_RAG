import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { NumberInput } from '@/components/ui/input';
import { IAgentTeamForm } from '@/interfaces/database/agent';
import { useMemo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { calculateRequiredDelegations } from './validation';

export function RunGuardrails() {
  const form = useFormContext<IAgentTeamForm>();
  const { t } = useTranslation();
  const watchedValues = useWatch({ control: form.control });
  const process = useWatch({ control: form.control, name: 'process' });
  const maxDelegations = useWatch({
    control: form.control,
    name: 'max_delegations',
  });
  const required = useMemo(
    () => calculateRequiredDelegations(form.getValues()),
    [form, watchedValues],
  );
  const showsConcurrency = process !== 'hierarchical';
  const showsRounds = process === 'debate' || process === 'consensus';

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">
          {t('flow.agentTeam.runGuardrails')}
        </h3>
        <p className="mt-1 text-xs text-text-secondary">
          {t('flow.agentTeam.runGuardrailsDescription')}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {showsConcurrency && (
          <FormField
            control={form.control}
            name="max_concurrency"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('flow.agentTeam.maxConcurrency')}</FormLabel>
                <FormControl>
                  <NumberInput
                    {...field}
                    value={field.value ?? 1}
                    min={1}
                  />
                </FormControl>
                <p className="text-xs text-text-disabled">
                  {t('flow.agentTeam.maxConcurrencyHint')}
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        {showsRounds && (
          <FormField
            control={form.control}
            name="collaboration_rounds"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('flow.agentTeam.collaborationRounds')}</FormLabel>
                <FormControl>
                  <NumberInput
                    {...field}
                    value={field.value ?? 1}
                    min={1}
                  />
                </FormControl>
                <p className="text-xs text-text-disabled">
                  {t('flow.agentTeam.collaborationRoundsHint')}
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <FormField
          control={form.control}
          name="max_depth"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('flow.agentTeam.maxDepth')}</FormLabel>
              <FormControl>
                <NumberInput {...field} value={field.value ?? 1} min={1} />
              </FormControl>
              <p className="text-xs text-text-disabled">
                {t('flow.agentTeam.maxDepthHint')}
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="worker_timeout"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('flow.agentTeam.workerTimeout')}</FormLabel>
              <FormControl>
                <NumberInput
                  {...field}
                  value={field.value ?? 1}
                  min={1}
                  step={1}
                />
              </FormControl>
              <p className="text-xs text-text-disabled">
                {t('flow.agentTeam.workerTimeoutHint')}
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="max_delegations"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>{t('flow.agentTeam.maxDelegations')}</FormLabel>
              <FormControl>
                <NumberInput
                  {...field}
                  value={field.value ?? 1}
                  min={required ?? 1}
                />
              </FormControl>
              <p className="text-xs text-text-disabled">
                {required === null
                  ? t('flow.agentTeam.runtimeBudget')
                  : t('flow.agentTeam.requiredDelegations', {
                      required,
                      current: maxDelegations,
                    })}
              </p>
              {required !== null &&
                (maxDelegations == null || maxDelegations < required) && (
                <p className="text-xs text-state-error">
                  {t('flow.agentTeam.validation.budget', { required })}
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </section>
  );
}
