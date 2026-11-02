import { SelectWithSearch } from '@/components/originui/select-with-search';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { BlurTextarea } from '@/components/ui/textarea';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

export function TaskCard({ index }: { index: number }) {
  const form = useFormContext();
  const { t } = useTranslation();
  const prefix = `tasks.${index}`;
  const workers = form.watch('workers') ?? [];
  const workerOptions = workers.map(
    (worker: {
      id: string;
      name?: string;
      role?: string;
      capabilities?: string[];
    }) => ({
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
    <section className="space-y-4 rounded-md border border-border-button bg-bg-input p-3">
      <div className="grid gap-4">
        <FormField
          control={form.control}
          name={`${prefix}.worker`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('flow.agentTeam.taskWorker')}</FormLabel>
              <FormControl>
                <SelectWithSearch
                  {...field}
                  options={workerOptions}
                  placeholder={t('flow.agentTeam.selectWorker')}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name={`${prefix}.task`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('flow.agentTeam.taskInstruction')}</FormLabel>
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
          name={`${prefix}.context`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('flow.agentTeam.taskContext')}</FormLabel>
              <FormControl>
                <BlurTextarea
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  autoSize={{ minRows: 2, maxRows: 8 }}
                  resize="vertical"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name={`${prefix}.expected_output`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('flow.agentTeam.expectedOutput')}</FormLabel>
              <FormControl>
                <BlurTextarea
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  autoSize={{ minRows: 2, maxRows: 8 }}
                  resize="vertical"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </section>
  );
}
