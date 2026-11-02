import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  MessageSquareText,
  Scale,
  UsersRound,
} from 'lucide-react';
import { ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AgentTeamRunStatus,
  NormalizedDelegation,
  NormalizedRound,
  NormalizedVote,
  normalizeAgentTeamOutput,
} from './agent-team-output';

function statusVariant(status: AgentTeamRunStatus) {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'destructive';
  return 'secondary';
}

function formatElapsed(value: number | string | undefined) {
  if (value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  return `${number.toFixed(3).replace(/\.?0+$/, '')}s`;
}

function SectionTitle({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <h4 className="flex items-center gap-2 text-sm font-medium">
      {icon}
      <span>{children}</span>
    </h4>
  );
}

function DelegationItem({ item }: { item: NormalizedDelegation }) {
  const { t } = useTranslation();
  const isError = item.status === 'error' || Boolean(item.error);

  return (
    <article className="space-y-2 rounded-md border border-border-button bg-bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-text-secondary">
          #{item.sequence || '-'}
        </span>
        <span className="text-sm font-medium">{item.worker_id || '-'}</span>
        {item.role && (
          <Badge variant="outline" className="px-1.5 py-0">
            {item.role}
          </Badge>
        )}
        {item.round > 0 && (
          <span className="text-xs text-text-secondary">
            {t('flow.agentTeam.timeline.roundShort', { round: item.round })}
          </span>
        )}
        <Badge
          variant={isError ? 'destructive' : 'success'}
          className="ms-auto px-1.5 py-0"
        >
          {t(`flow.agentTeam.delegationStatus.${item.status}`, {
            defaultValue: item.status || 'unknown',
          })}
        </Badge>
        {item.duration_ms > 0 && (
          <span className="flex items-center gap-1 text-xs text-text-secondary">
            <Clock3 className="size-3" />
            {t('flow.agentTeam.timeline.durationMs', {
              duration: item.duration_ms,
            })}
          </span>
        )}
      </div>
      {item.task && (
        <p className="whitespace-pre-wrap break-words text-sm">{item.task}</p>
      )}
      {(item.context || item.expected_output) && (
        <dl className="grid gap-1 text-xs text-text-secondary">
          {item.context && (
            <div>
              <dt className="inline font-medium">
                {t('flow.agentTeam.timeline.context')}:
              </dt>{' '}
              <dd className="inline whitespace-pre-wrap break-words">
                {item.context}
              </dd>
            </div>
          )}
          {item.expected_output && (
            <div>
              <dt className="inline font-medium">
                {t('flow.agentTeam.timeline.expectedOutput')}:
              </dt>{' '}
              <dd className="inline whitespace-pre-wrap break-words">
                {item.expected_output}
              </dd>
            </div>
          )}
        </dl>
      )}
      {item.result && (
        <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-bg-base p-2 text-xs">
          {item.result}
        </pre>
      )}
      {item.error && (
        <p className="whitespace-pre-wrap break-words text-xs text-state-error">
          {item.error}
        </p>
      )}
    </article>
  );
}

function Votes({
  groups,
  invalidVotes,
}: {
  groups: ReturnType<typeof normalizeAgentTeamOutput>['voteGroups'];
  invalidVotes: NormalizedVote[];
}) {
  const { t } = useTranslation();

  if (groups.length === 0 && invalidVotes.length === 0) return null;

  return (
    <section className="space-y-2">
      <SectionTitle icon={<Scale className="size-4" />}>
        {t('flow.agentTeam.timeline.votes')}
      </SectionTitle>
      <div className="grid gap-2 sm:grid-cols-2">
        {groups.map((group) => (
          <div
            key={group.choice}
            className="rounded-md border border-border-button bg-bg-card p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="break-words text-sm font-medium">
                {group.choice}
              </span>
              <Badge variant="secondary" className="shrink-0 px-1.5 py-0">
                {group.count}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              {t('flow.agentTeam.timeline.confidence', {
                confidence: group.confidence.toFixed(2),
              })}
            </p>
            <p className="mt-1 break-words text-xs text-text-secondary">
              {group.votes.map((vote) => vote.worker_id).join(', ')}
            </p>
          </div>
        ))}
      </div>
      {invalidVotes.length > 0 && (
        <div className="space-y-2 rounded-md border border-state-error bg-bg-card p-3">
          <p className="text-sm font-medium text-state-error">
            {t('flow.agentTeam.timeline.invalidVotes')}
          </p>
          {invalidVotes.map((vote, index) => (
            <p
              key={`${vote.worker_id}-${index}`}
              className="break-words text-xs text-text-secondary"
            >
              {vote.worker_id || '-'}: {vote.error || vote.choice || '-'}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function RoundItem({ round }: { round: NormalizedRound }) {
  const { t } = useTranslation();

  return (
    <section className="space-y-2 rounded-md border border-border-button bg-bg-card p-3">
      <h5 className="text-sm font-medium">
        {t('flow.agentTeam.timeline.round', { round: round.round })}
      </h5>
      {round.responses.map((response, index) => (
        <article
          key={`${response.worker_id}-${response.task_index}-${index}`}
          className="space-y-1 border-t border-border-button pt-2 first:border-t-0 first:pt-0"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium">{response.worker_id || '-'}</span>
            {response.task_index >= 0 && (
              <span className="text-text-secondary">
                {t('flow.agentTeam.timeline.taskShort', {
                  task: response.task_index + 1,
                })}
              </span>
            )}
            <Badge
              variant={response.status === 'ok' ? 'success' : 'destructive'}
              className="px-1.5 py-0"
            >
              {response.status || 'unknown'}
            </Badge>
            {response.duration_ms > 0 && (
              <span className="text-text-secondary">
                {t('flow.agentTeam.timeline.durationMs', {
                  duration: response.duration_ms,
                })}
              </span>
            )}
          </div>
          {response.content && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
              {response.content}
            </pre>
          )}
          {response.error && (
            <p className="break-words text-xs text-state-error">
              {response.error}
            </p>
          )}
        </article>
      ))}
    </section>
  );
}

export function AgentTeamTimeline({
  outputs,
  elapsedTime,
  error,
}: {
  outputs: unknown;
  elapsedTime?: number | string;
  error?: string | null;
}) {
  const { t } = useTranslation();
  const result = useMemo(
    () => normalizeAgentTeamOutput(outputs, error),
    [error, outputs],
  );
  const errors = Array.from(
    new Set([error, result.error].filter((item): item is string => !!item)),
  );
  const workerIds = new Set(
    [
      ...result.delegations.map((item) => item.worker_id),
      ...result.votes.map((item) => item.worker_id),
    ].filter(Boolean),
  );
  const elapsed = formatElapsed(elapsedTime);
  const rawStructured =
    result.structuredParseError && result.raw
      ? JSON.stringify(result.raw, null, 2)
      : '';
  const hasConclusion =
    Boolean(result.winner) ||
    result.hasConsensusValue ||
    Boolean(result.resolution) ||
    Boolean(result.tieBreak) ||
    Boolean(result.judgeResult) ||
    Boolean(result.summary);

  if (result.status === 'notRun' && errors.length === 0) return null;

  return (
    <section className="space-y-4 border-b border-border-button bg-bg-card px-3 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <UsersRound className="size-4 text-accent-primary" />
        {result.process && (
          <span className="text-sm font-medium">
            {t(`flow.agentTeam.process.${result.process}.label`, {
              defaultValue: result.process,
            })}
          </span>
        )}
        <Badge variant={statusVariant(result.status)} className="px-1.5 py-0">
          {t(`flow.agentTeam.timeline.status.${result.status}`)}
        </Badge>
        {workerIds.size > 0 && (
          <span className="text-xs text-text-secondary">
            {t('flow.agentTeam.workerCount', { count: workerIds.size })}
          </span>
        )}
        {elapsed && (
          <span className="flex items-center gap-1 text-xs text-text-secondary">
            <Clock3 className="size-3" />
            {elapsed}
          </span>
        )}
      </div>

      {errors.map((message) => (
        <div
          key={message}
          className="flex items-start gap-2 rounded-md border border-state-error bg-bg-base p-3 text-sm text-state-error"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p className="whitespace-pre-wrap break-words">{message}</p>
        </div>
      ))}

      {result.structuredParseError && (
        <section className="space-y-2">
          <p className="text-xs text-state-error">
            {result.structuredParseError}
          </p>
          {rawStructured && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-bg-base p-2 text-xs">
              {rawStructured}
            </pre>
          )}
        </section>
      )}

      {result.delegations.length > 0 && (
        <section className="space-y-2">
          <SectionTitle icon={<MessageSquareText className="size-4" />}>
            {t('flow.agentTeam.timeline.delegations')}
          </SectionTitle>
          <div className="space-y-2">
            {result.delegations.map((item, index) => (
              <DelegationItem
                key={`${item.sequence}-${item.worker_id}-${index}`}
                item={item}
              />
            ))}
          </div>
        </section>
      )}

      <Votes
        groups={result.voteGroups}
        invalidVotes={result.invalidVotes}
      />

      {result.rounds.length > 0 && (
        <section className="space-y-2">
          <SectionTitle icon={<MessageSquareText className="size-4" />}>
            {t('flow.agentTeam.timeline.rounds')}
          </SectionTitle>
          <div className="space-y-2">
            {result.rounds.map((round) => (
              <RoundItem key={round.round} round={round} />
            ))}
          </div>
        </section>
      )}

      {hasConclusion && (
        <section className="space-y-2">
          <SectionTitle icon={<CheckCircle2 className="size-4" />}>
            {t('flow.agentTeam.timeline.conclusion')}
          </SectionTitle>
          <div className="space-y-2 rounded-md border border-border-button bg-bg-base p-3 text-sm">
            {result.winner && (
              <p className="break-words">
                {t('flow.agentTeam.timeline.winnerValue', {
                  winner: result.winner,
                })}
              </p>
            )}
            {result.hasConsensusValue && (
              <p className="text-text-secondary">
                {t('flow.agentTeam.timeline.consensusValue', {
                  value: result.consensus
                    ? t('flow.agentTeam.timeline.yes')
                    : t('flow.agentTeam.timeline.no'),
                })}
              </p>
            )}
            {result.resolution && (
              <p className="text-text-secondary">
                {t('flow.agentTeam.timeline.resolutionValue', {
                  resolution: result.resolution,
                })}
              </p>
            )}
            {result.tieBreak && (
              <p className="text-text-secondary">
                {t('flow.agentTeam.timeline.tieBreakValue', {
                  tieBreak: result.tieBreak,
                })}
              </p>
            )}
            {result.judgeResult && (
              <div className="space-y-1 border-t border-border-button pt-2">
                <p className="text-xs font-medium">
                  {t('flow.agentTeam.timeline.judge')}
                </p>
                <p className="whitespace-pre-wrap break-words">
                  {result.judgeResult}
                </p>
              </div>
            )}
            {result.summary && (
              <div className="space-y-1 border-t border-border-button pt-2">
                <p className="text-xs font-medium">
                  {t('flow.agentTeam.timeline.summary')}
                </p>
                <p className="whitespace-pre-wrap break-words">
                  {result.summary}
                </p>
              </div>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
