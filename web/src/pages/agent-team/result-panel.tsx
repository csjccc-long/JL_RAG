import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ITeamRunSnapshot } from './hooks/use-team-run';
import { IAgentTeamSummary } from './utils/extract-teams';

interface ResultPanelProps {
  team?: IAgentTeamSummary;
  snapshot?: ITeamRunSnapshot;
  answer: string;
  error: string;
  running: boolean;
}

const asText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
};

const tryParseJson = (value: unknown): Record<string, any> | undefined => {
  if (!value) return undefined;
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return undefined;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
};

// 团队结论优先展示"人能一眼看懂"的字段：judge 摘要 > 单个 result > 各 worker
// 结果的汇总。parallel 这类没有 judge 的策略，outputs.content 是整段 JSON，
// 直接贴出来对用户没有价值（早期实现就是这样，实景验收时一眼可见）。
const buildConclusion = (
  structured: Record<string, any>,
  outputs: Record<string, any>,
  answer: string,
): string => {
  const summary = asText(structured.summary).trim();
  if (summary) return summary;

  const parsed = tryParseJson(outputs.content) ?? tryParseJson(answer);
  const results = Array.isArray(structured.results)
    ? structured.results
    : Array.isArray(parsed?.results)
      ? parsed?.results
      : [];
  if (results.length > 0) {
    return results
      .map((item: Record<string, any>, index: number) => {
        const who = asText(item.worker_name || item.worker_id) || `#${index + 1}`;
        const body = asText(item.result ?? item.content ?? item.answer).trim();
        return body ? `${who}：${body}` : who;
      })
      .join('\n\n');
  }

  const single = asText(structured.result).trim();
  if (single) return single;

  const fallback = asText(parsed?.summary || parsed?.result).trim();
  if (fallback) return fallback;

  return asText(outputs.content).trim() || answer;
};

// 后端把覆盖情况写进 structured.warning（英文），前端翻成界面语言，
// 这样"只派了 1/3 成员"这类问题用户能直接看懂，而不是读一段英文。
const COVERAGE_PATTERN = /dispatched (\d+) of (\d+) workers; not delegated: (.+?)\.?$/;

export const localizeWarning = (
  warning: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string => {
  if (!warning) return '';
  const coverage = warning.match(COVERAGE_PATTERN);
  if (coverage) {
    return t('flow.agentTeam.warning.partialCoverage', {
      done: coverage[1],
      total: coverage[2],
      missing: coverage[3].replace(/\.$/, ''),
    });
  }
  if (warning.includes('did not delegate')) {
    return t('flow.agentTeam.warning.managerFallback');
  }
  return warning;
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <div className="text-xs font-medium uppercase text-text-secondary">
      {title}
    </div>
    {children}
  </div>
);

const ResultPanel = ({
  team,
  snapshot,
  answer,
  error,
  running,
}: ResultPanelProps) => {
  const { t } = useTranslation();
  const outputs = snapshot?.outputs ?? {};
  const structured = outputs.structured ?? {};
  const delegations: any[] = Array.isArray(outputs.delegations)
    ? outputs.delegations
    : [];
  const votes: any[] = Array.isArray(outputs.votes) ? outputs.votes : [];
  const finalError = error || String(outputs._ERROR ?? '');
  const conclusion = buildConclusion(structured, outputs, answer);
  const partial = String(structured.status ?? '') === 'partial';
  const warning = localizeWarning(
    asText(structured.warning ?? outputs.warning).trim(),
    t,
  );

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-text-primary">
            {t('flow.agentTeam.page.result')}
          </span>
          {running && <Badge variant="default">{t('flow.agentTeam.status.running')}</Badge>}
          {!running && snapshot && !finalError && (
            <Badge variant={partial ? 'secondary' : 'success'}>
              {t(
                partial
                  ? 'flow.agentTeam.status.partial'
                  : 'flow.agentTeam.status.success',
              )}
            </Badge>
          )}
          {finalError && (
            <Badge variant="destructive">{t('flow.agentTeam.status.failed')}</Badge>
          )}
        </div>

        {finalError && (
          <div className="rounded-md border border-state-error bg-bg-card p-2 text-xs text-state-error">
            {finalError}
          </div>
        )}

        {warning && (
          <div className="rounded-md border border-border-button bg-bg-card p-2 text-xs text-text-secondary">
            {warning}
          </div>
        )}

        {!snapshot && !answer && !running && (
          <div className="py-8 text-center text-xs text-text-secondary">
            {t('flow.agentTeam.page.resultEmpty')}
          </div>
        )}

        {conclusion && (
          <Section title={t('flow.agentTeam.page.answer')}>
            <div className="whitespace-pre-wrap break-words rounded-md bg-bg-card p-3 text-xs leading-relaxed text-text-primary">
              {conclusion}
            </div>
          </Section>
        )}

        {team?.judge && (
          <Section title={t('flow.agentTeam.page.judge')}>
            <div className="text-xs text-text-secondary">{team.judge}</div>
          </Section>
        )}

        {outputs.consensus !== undefined && outputs.consensus !== '' && (
          <Section title={t('flow.agentTeam.page.consensus')}>
            <div className="text-xs text-text-secondary">
              {asText(outputs.consensus)}
            </div>
          </Section>
        )}

        {outputs.winner !== undefined && outputs.winner !== '' && (
          <Section title={t('flow.agentTeam.page.winner')}>
            <div className="text-xs text-text-secondary">
              {asText(outputs.winner)}
            </div>
          </Section>
        )}

        {votes.length > 0 && (
          <Section title={t('flow.agentTeam.page.votes')}>
            <div className="flex flex-col gap-1.5">
              {votes.map((vote, index) => (
                <div
                  key={index}
                  className="rounded-md bg-bg-card p-2 text-xs text-text-secondary"
                >
                  <span className="text-text-primary">
                    {asText(vote.worker_id || vote.worker || vote.id) || `#${index + 1}`}
                  </span>
                  {' → '}
                  {asText(vote.choice ?? vote.vote ?? vote.answer)}
                  {vote.reason ? ` (${asText(vote.reason)})` : ''}
                </div>
              ))}
            </div>
          </Section>
        )}

        {delegations.length > 0 && (
          <>
            <Separator />
            <Section title={t('flow.agentTeam.page.delegations')}>
              <div className="flex flex-col gap-2">
                {delegations.map((record, index) => (
                  <div
                    key={`${record.sequence ?? index}-${index}`}
                    className="flex flex-col gap-1 rounded-md bg-bg-card p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-text-primary">
                        {record.worker_id}
                      </span>
                      <Badge
                        variant={record.status === 'ok' ? 'success' : 'destructive'}
                      >
                        {record.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-text-secondary">
                      {record.task}
                    </div>
                    {record.error && (
                      <div className="text-[10px] text-state-error">
                        {record.error}
                      </div>
                    )}
                    {record.result && (
                      <div className="line-clamp-4 whitespace-pre-wrap text-[10px] text-text-disabled">
                        {record.result}
                      </div>
                    )}
                    {typeof record.duration_ms === 'number' && (
                      <div className="text-[10px] text-text-disabled">
                        {(record.duration_ms / 1000).toFixed(1)}s
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}
      </div>
    </ScrollArea>
  );
};

export default ResultPanel;