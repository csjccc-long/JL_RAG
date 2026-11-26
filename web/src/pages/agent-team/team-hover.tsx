import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IFlow } from '@/interfaces/database/agent';
import { cn } from '@/lib/utils';
import TeamList from './team-list';
import { IAgentTeamSummary } from './utils/extract-teams';

interface TeamHoverProps {
  teams: IAgentTeamSummary[];
  loading: boolean;
  selectedKey?: string;
  teamsError?: string;
  roster: IFlow[];
  assigningKey?: string;
  assignFailedKey?: string;
  assignFailure?: string;
  onSelect: (team: IAgentTeamSummary, key: string) => void;
  onOpenCanvas: (team: IAgentTeamSummary) => void;
  onAssign: (team: IAgentTeamSummary, workerIds: string[]) => void;
  onRetry: () => void;
  onCreate: () => void;
}

/* 团队栏收成左边缘的一条竖标签，指上去才铺开：屏幕的主区留给分发盘和
   投票圆盘，选团队是低频动作，不需要一直占着 260px。选中、新建、打开
   画布都会自动收起；键盘用户点标签展开，Esc 收起。 */
const TeamHover = ({
  teams,
  loading,
  selectedKey,
  teamsError,
  roster,
  assigningKey,
  assignFailedKey,
  assignFailure,
  onSelect,
  onOpenCanvas,
  onAssign,
  onRetry,
  onCreate,
}: TeamHoverProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
  const handleToggle = useCallback(() => setOpen((current) => !current), []);

  const handleSelect = useCallback(
    (team: IAgentTeamSummary, key: string) => {
      onSelect(team, key);
      setOpen(false);
    },
    [onSelect],
  );

  const handleOpenCanvas = useCallback(
    (team: IAgentTeamSummary) => {
      onOpenCanvas(team);
      setOpen(false);
    },
    [onOpenCanvas],
  );

  const handleCreate = useCallback(() => {
    onCreate();
    setOpen(false);
  }, [onCreate]);

  // 面板里有键盘焦点时，鼠标移出去不应该把正在操作的面板收掉；
  // 但焦点停在触发按钮上不算“正在操作面板”，否则点开后再也 hover 不走。
  const handleMouseLeave = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const panel = event.currentTarget.querySelector('#team-hover-panel');
      if (panel?.contains(document.activeElement)) return;
      setOpen(false);
    },
    [],
  );

  useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open]);

  return (
    <aside
      data-testid="team-hover"
      className={cn(
        'absolute inset-y-0 left-0 z-30',
        open ? 'w-[260px]' : 'w-9',
      )}
      onMouseEnter={handleOpen}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        data-testid="team-hover-trigger"
        aria-expanded={open}
        aria-controls="team-hover-panel"
        aria-label={t('flow.agentTeam.page.teams')}
        className="absolute left-0 top-1/2 flex w-9 -translate-y-1/2 flex-col items-center gap-1 rounded-r-lg border border-l-0 border-border-button bg-bg-card py-3 text-text-secondary shadow-sm transition-colors hover:bg-bg-accent hover:text-text-primary"
        onClick={handleToggle}
      >
        <Users className="h-4 w-4" />
        <span className="text-[11px] tracking-widest [writing-mode:vertical-rl]">
          {t('flow.agentTeam.page.teams')}
        </span>
      </button>

      {open ? (
        <>
          {/* 面板只占 260px，右侧用一段渐隐把被压住的成员卡柔和地收掉，
              避免卡片从面板边缘露出半截。 */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-[360px] bg-gradient-to-r from-bg-base from-70% via-bg-base via-78% to-transparent"
          />
          <div
            id="team-hover-panel"
            data-testid="team-hover-panel"
            role="dialog"
            aria-label={t('flow.agentTeam.page.teams')}
            className="absolute inset-y-0 left-0 flex w-[260px] flex-col overflow-hidden rounded-lg border border-border-button bg-bg-base shadow-xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border-button py-1.5 pl-3 pr-2">
              <span className="text-sm font-medium text-text-primary">
                {t('flow.agentTeam.page.teams')}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="new-team"
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-accent hover:text-text-primary"
                  onClick={handleCreate}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('flow.agentTeam.page.newTeamCta')}
                </button>
                <button
                  type="button"
                  aria-label={t('flow.agentTeam.page.dock.collapse')}
                  className="rounded-md p-1 text-text-secondary transition-colors hover:bg-bg-accent hover:text-text-primary"
                  onClick={handleClose}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1">
              {teamsError ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
                  <p className="text-xs text-text-secondary">
                    {t('flow.agentTeam.page.teamsError')}
                  </p>
                  <p className="break-all text-xs text-text-disabled">
                    {teamsError}
                  </p>
                  <Button variant="transparent" onClick={onRetry}>
                    {t('flow.agentTeam.page.retry')}
                  </Button>
                </div>
              ) : (
                <TeamList
                  teams={teams}
                  loading={loading}
                  selectedKey={selectedKey}
                  onSelect={handleSelect}
                  onOpenCanvas={handleOpenCanvas}
                  roster={roster}
                  onAssign={onAssign}
                  assigningKey={assigningKey}
                  assignFailedKey={assignFailedKey}
                  assignFailure={assignFailure}
                />
              )}
            </div>
          </div>
        </>
      ) : null}
    </aside>
  );
};

export default TeamHover;
