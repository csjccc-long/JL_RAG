import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { IAgentTeamSummary } from './utils/extract-teams';

interface TeamListProps {
  teams: IAgentTeamSummary[];
  loading: boolean;
  selectedKey?: string;
  onSelect: (team: IAgentTeamSummary, key: string) => void;
  onOpenCanvas: (team: IAgentTeamSummary) => void;
}

export const teamKey = (team: IAgentTeamSummary) =>
  `${team.agentId}:${team.componentId}`;

const TeamCard = ({
  team,
  active,
  onSelect,
  onOpenCanvas,
}: {
  team: IAgentTeamSummary;
  active: boolean;
  onSelect: (team: IAgentTeamSummary, key: string) => void;
  onOpenCanvas: (team: IAgentTeamSummary) => void;
}) => {
  const { t } = useTranslation();

  const handleSelect = useCallback(() => {
    onSelect(team, teamKey(team));
  }, [onSelect, team]);

  const handleOpenCanvas = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onOpenCanvas(team);
    },
    [onOpenCanvas, team],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={handleSelect}
      className={cn(
        'flex cursor-pointer flex-col gap-2 rounded-lg border border-border-button bg-bg-card p-3 transition-colors hover:bg-bg-base',
        active && 'border-text-primary/40 bg-bg-base',
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary"
          title={team.agentTitle}
        >
          {team.agentTitle}
        </span>
        <Badge variant="secondary" className="shrink-0 whitespace-nowrap">
          {t(`flow.agentTeam.process.${team.process}.label`)}
        </Badge>
      </div>
      <div className="flex items-center gap-3 text-xs text-text-secondary">
        <span>
          {t('flow.agentTeam.page.participants', { count: team.workers.length })}
        </span>
        <span>{t('flow.agentTeam.page.tasks', { count: team.tasks.length })}</span>
      </div>
      <div className="flex justify-end">
        <Button variant="transparent" size="sm" onClick={handleOpenCanvas}>
          {t('flow.agentTeam.page.viewCanvas')}
        </Button>
      </div>
    </div>
  );
};

const TeamList = ({
  teams,
  loading,
  selectedKey,
  onSelect,
  onOpenCanvas,
}: TeamListProps) => {
  const { t } = useTranslation();

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
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-2 p-3">
        {teams.map((team) => (
          <TeamCard
            key={teamKey(team)}
            team={team}
            active={teamKey(team) === selectedKey}
            onSelect={onSelect}
            onOpenCanvas={onOpenCanvas}
          />
        ))}
      </div>
    </ScrollArea>
  );
};

export default TeamList;