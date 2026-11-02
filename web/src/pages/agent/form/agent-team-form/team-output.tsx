import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { IAgentTeamForm } from '@/interfaces/database/agent';
import { useCallback, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Output } from '../components/output';

const AGENT_TEAM_OUTPUTS = [
  { title: 'content', type: 'string' },
  { title: 'structured', type: 'object' },
  { title: 'delegations', type: 'Array<Object>' },
  { title: 'votes', type: 'Array<Object>' },
  { title: 'rounds', type: 'Array<Object>' },
  { title: 'consensus', type: 'boolean' },
  { title: 'winner', type: 'string' },
  { title: '_ERROR', type: 'string' },
];

export type CustomHeaderParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errorKey: string };

export function parseCustomHeaderJson(value: string): CustomHeaderParseResult {
  try {
    const parsed = JSON.parse(value);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {
        ok: false,
        errorKey: 'flow.agentTeam.validation.customHeaderObject',
      };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      errorKey: 'flow.agentTeam.validation.customHeaderJson',
    };
  }
}

function serializeHeader(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value ?? {}, null, 2);
}

export function CustomHeaderInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange(value: Record<string, unknown>): void;
}) {
  const form = useFormContext<IAgentTeamForm>();
  const { t } = useTranslation();
  const [text, setText] = useState(() => serializeHeader(value));

  const handleChange = useCallback(
    (nextValue: string) => {
      setText(nextValue);
      const parsed = parseCustomHeaderJson(nextValue);
      if (!parsed.ok) {
        form.setError('custom_header', {
          type: 'validate',
          message: t(parsed.errorKey),
        });
        return;
      }
      form.clearErrors('custom_header');
      onChange(parsed.value);
    },
    [form, onChange, t],
  );

  const handleTextareaChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleChange(event.target.value);
    },
    [handleChange],
  );

  return (
    <Textarea
      value={text}
      onChange={handleTextareaChange}
      className="min-h-40 font-mono"
      spellCheck={false}
    />
  );
}

export function TeamOutput() {
  const form = useFormContext<IAgentTeamForm>();
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <Output list={AGENT_TEAM_OUTPUTS} />
      <FormField
        control={form.control}
        name="custom_header"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('flow.agentTeam.customHeader')}</FormLabel>
            <FormControl>
              <CustomHeaderInput
                value={field.value}
                onChange={field.onChange}
              />
            </FormControl>
            <p className="text-xs text-text-secondary">
              {t('flow.agentTeam.customHeaderDescription')}
            </p>
            <FormMessage />
          </FormItem>
        )}
      />
    </section>
  );
}
