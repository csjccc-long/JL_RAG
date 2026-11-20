import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@/components/ui/scroll-area';
import { IFlow } from '@/interfaces/database/agent';
import TeamCard from './team-card';
import { IAgentTeamSummary } from './utils/extract-teams';

interface TeamListProps {
  teams: IAgentTeamSummary[];
  loading: boolean;
  selectedKey?: string;
  onSelect: (team: IAgentTeamSummary, key: string) => void;
  onOpenCanvas: (team: IAgentTeamSummary) => void;
  /** the agents that already exist, offered as a team's crew */
  roster: IFlow[];
  onAssign: (team: IAgentTeamSummary, workerIds: string[]) => void;
  assigningKey?: string;
  assignFailedKey?: string;
  assignFailure?: string;
}

export const teamKey = (team: IAgentTeamSummary) =>
  `${team.agentId}:${team.componentId}`;

const TeamList = ({
  teams,
  loading,
  selectedKey,
  onSelect,
  onOpenCanvas,
  roster,
  onAssign,
  assigningKey,
  assignFailedKey,
  assignFailure,
}: TeamListProps) => {
  const { t } = useTranslation();
  // Which card is the one being pointed at. Every other card goes soft while it
  // is, so the fan and the card it belongs to are the only sharp things left.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  /* A team that was just created (or deep-linked into) may be below the fold;
     selecting it should bring it into view rather than leave the board talking
     about a card the user cannot see. */
  useEffect(() => {
    if (!selectedKey) return;
    const card = listRef.current?.querySelector<HTMLElement>(
      `[data-team-key="${selectedKey}"]`,
    );
    card?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);
  const hoverHandlers = useCallback(
    (key: string) => (hovered: boolean) =>
      setHoveredKey((current) => (hovered ? key : current === key ? null : current)),
    [],
  );

  if (loading && teams.length === 0) {
    return (
      <div className="p-4 text-sm text-text-secondary">{t('common.loading')}</div>
    );
  }

  if (teams.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <div className="text-sm text-text-primary">
          {t('flow.agentTeam.page.teamsEmpty')}
        </div>
        <div className="text-xs text-text-secondary">
          {t('flow.agentTeam.page.teamsHint')}
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full" viewportClassName="[&>div]:!block">
      <div
        ref={listRef}
        className="flex w-full min-w-0 flex-col gap-2 p-3"
      >
        {teams.map((team) => {
          const key = teamKey(team);
          return (
            <TeamCard
              key={key}
              team={team}
              data-team-key={key}
              active={key === selectedKey}
              dimmed={hoveredKey !== null && hoveredKey !== key}
              onSelect={onSelect}
              onOpenCanvas={onOpenCanvas}
              onHoverChange={hoverHandlers(key)}
              teamKey={teamKey}
              roster={roster}
              onAssign={(workerIds) => onAssign(team, workerIds)}
              assigning={assigningKey === key}
              assignFailure={assignFailedKey === key ? assignFailure : undefined}
            />
          );
        })}
      </div>
    </ScrollArea>
  );
};

export default TeamList;
