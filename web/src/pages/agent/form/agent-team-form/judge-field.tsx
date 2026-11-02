import { SelectWithSearch } from '@/components/originui/select-with-search';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { IAgentTeamForm } from '@/interfaces/database/agent';
import { AGENT_TEAM_JUDGE_PROCESSES } from './interface';

export function JudgeField() {
  const form = useFormContext<IAgentTeamForm>();
  const { t } = useTranslation();
  const process = useWatch({ control: form.control, name: 'process' });
  const workers = useWatch({ control: form.control, name: 'workers' }) ?? [];

  if (!AGENT_TEAM_JUDGE_PROCESSES.includes(process)) {
    return null;
  }

  const options = workers.map((worker) => ({
    label: worker.name || worker.id,
    value: worker.id,
    keywords: [
      worker.id,
      worker.name,
      worker.role,
      ...(worker.capabilities ?? []),
    ].filter((item): item is string => Boolean(item)),
  }));

  return (
    <section className="space-y-2">
      <FormField
        control={form.control}
        name="judge"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('flow.agentTeam.judge')}</FormLabel>
            <FormControl>
              <SelectWithSearch
                {...field}
                value={field.value ?? ''}
                options={options}
                allowClear
                placeholder={t('flow.agentTeam.selectJudge')}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <p className="text-xs text-text-secondary">
        {process === 'debate'
          ? t('flow.agentTeam.judgeDescriptionDebate')
          : process === 'consensus'
            ? t('flow.agentTeam.judgeDescriptionConsensus')
            : t('flow.agentTeam.judgeDescriptionVote')}
      </p>
    </section>
  );
}
