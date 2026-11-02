import { FormField, FormItem, FormMessage } from '@/components/ui/form';
import { AgentTeamProcess } from '@/interfaces/database/agent';
import { cn } from '@/lib/utils';
import { useCallback } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { AGENT_TEAM_PROCESSES } from './interface';

function ProcessButton({
  selected,
  process,
  onSelect,
}: {
  selected: boolean;
  process: AgentTeamProcess;
  onSelect(process: AgentTeamProcess): void;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    onSelect(process);
  }, [onSelect, process]);

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={handleSelect}
      className={cn(
        'min-h-16 rounded-md border border-border-button bg-bg-input px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary',
        selected
          ? 'border-accent-primary bg-bg-card text-text-primary'
          : 'text-text-secondary hover:bg-bg-base-hover hover:text-text-primary',
      )}
    >
      <span className="block text-sm font-medium">
        {t(`flow.agentTeam.process.${process}.label`)}
      </span>
      <span className="mt-1 block text-xs leading-4">
        {t(`flow.agentTeam.process.${process}.description`)}
      </span>
    </button>
  );
}

function ProcessSelectorInput({
  value,
  onChange,
}: {
  value?: AgentTeamProcess;
  onChange(value: AgentTeamProcess): void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {AGENT_TEAM_PROCESSES.map((process) => (
        <ProcessButton
          key={process}
          process={process}
          selected={value === process}
          onSelect={onChange}
        />
      ))}
    </div>
  );
}

export function ProcessSelector() {
  const { t } = useTranslation();
  const form = useFormContext();
  const process = useWatch({ control: form.control, name: 'process' });

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">
          {t('flow.agentTeam.processLabel')}
        </h3>
        <p className="mt-1 text-xs text-text-secondary">
          {t('flow.agentTeam.processDescription')}
        </p>
      </div>
      <FormField
        control={form.control}
        name="process"
        render={({ field }) => (
          <FormItem>
            <ProcessSelectorInput value={process} onChange={field.onChange} />
            <FormMessage />
          </FormItem>
        )}
      />
    </section>
  );
}

export { ProcessSelectorInput };
