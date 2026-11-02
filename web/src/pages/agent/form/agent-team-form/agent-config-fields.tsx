import { NextLLMSelect } from '@/components/llm-select/next';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { NumberInput } from '@/components/ui/input';
import { BlurTextarea } from '@/components/ui/textarea';
import { get } from 'lodash';
import { useCallback, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

function PromptField({
  value,
  onChange,
}: {
  value: unknown;
  onChange(value: Array<{ role: string; content: string }>): void;
}) {
  const text =
    typeof value === 'string'
      ? value
      : String(get(value, '0.content', '') ?? '');
  const handleChange = useCallback(
    (nextValue: unknown) => {
      onChange([{ role: 'user', content: String(nextValue ?? '') }]);
    },
    [onChange],
  );

  return (
    <BlurTextarea
      value={text}
      onChange={handleChange}
      autoSize={{ minRows: 2, maxRows: 8 }}
      resize="vertical"
    />
  );
}

function ToolsField({
  value,
  onChange,
}: {
  value: unknown;
  onChange(value: unknown[]): void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(() =>
    JSON.stringify(Array.isArray(value) ? value : [], null, 2),
  );
  const [invalid, setInvalid] = useState(false);

  const handleChange = useCallback(
    (nextValue: unknown) => {
      const raw = String(nextValue ?? '');
      setText(raw);
      try {
        const parsed = JSON.parse(raw);
        const nextTools = Array.isArray(parsed) ? parsed : [];
        setInvalid(!Array.isArray(parsed));
        onChange(nextTools);
      } catch {
        setInvalid(true);
      }
    },
    [onChange],
  );

  return (
    <section className="space-y-1">
      <BlurTextarea
        value={text}
        onChange={handleChange}
        autoSize={{ minRows: 3, maxRows: 10 }}
        resize="vertical"
        className="font-mono"
      />
      {invalid && (
        <p className="text-xs text-state-error">
          {t('flow.agentTeam.validation.jsonArray')}
        </p>
      )}
    </section>
  );
}

export function AgentConfigFields({
  prefix,
  maxRounds = 5,
}: {
  prefix: string;
  maxRounds?: number;
}) {
  const form = useFormContext();
  const { t } = useTranslation();

  return (
    <section className="grid gap-4">
      <FormField
        control={form.control}
        name={`${prefix}.llm_id`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('chat.model')}</FormLabel>
            <FormControl>
              <NextLLMSelect {...field} prefix={prefix} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.sys_prompt`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('flow.systemPrompt')}</FormLabel>
            <FormControl>
              <BlurTextarea
                value={field.value ?? ''}
                onChange={field.onChange}
                autoSize={{ minRows: 3, maxRows: 10 }}
                resize="vertical"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.prompts`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('flow.agentTeam.userPrompt')}</FormLabel>
            <FormControl>
              <PromptField value={field.value} onChange={field.onChange} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.max_rounds`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('flow.maxRounds')}</FormLabel>
            <FormControl>
              <NumberInput {...field} min={0} max={maxRounds} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.tools`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('flow.tools')}</FormLabel>
            <FormControl>
              <ToolsField value={field.value} onChange={field.onChange} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </section>
  );
}
