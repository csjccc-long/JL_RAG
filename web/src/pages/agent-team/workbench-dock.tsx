import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import DispatchBoard from './dispatch-board';
import ResultPanel from './result-panel';
import { ITeamRunSnapshot } from './hooks/use-team-run';
import { IAgentTeamSummary } from './utils/extract-teams';
import {
  BOARD_COLUMNS,
  groupCardsByColumn,
  ITeamBoardCard,
  TeamCardStatus,
} from './utils/board';

const STATUS_DOT: Record<TeamCardStatus, string> = {
  pending: 'bg-text-disabled',
  running: 'bg-accent-primary',
  done: 'bg-state-success',
  failed: 'bg-state-error',
};

type DockPanel = 'board' | 'result' | null;

interface WorkbenchDockProps {
  cards: ITeamBoardCard[];
  team?: IAgentTeamSummary;
  snapshot?: ITeamRunSnapshot;
  answer: string;
  error: string;
  running: boolean;
}

/**
 * 协作台底部的工作条：左边是四列看板的计数，右边是协作结果。
 *
 * 两块都收在同一行里，点哪块就从条上向上抽出哪块，平时不占主区。看板展开时
 * 只是把四列铺开；结果展开时是一块可滚动的结论面板。一次运行结束时结果会
 * 自动弹出来，用户不用再找入口——但运行中不自动弹，免得挡住正在看的看板。
 */
const WorkbenchDock = ({
  cards,
  team,
  snapshot,
  answer,
  error,
  running,
}: WorkbenchDockProps) => {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<DockPanel>(null);
  const wasRunning = useRef(false);
  const grouped = groupCardsByColumn(cards);

  const resultFailed =
    Boolean(error) || String(snapshot?.outputs?._ERROR ?? '') !== '';
  const resultFinished = !running && Boolean(snapshot || answer || error);

  // 开跑时只收起当前浮层，并记下"这次确实跑过"；监听只看 running，进度频繁
  // 更新不会反复打断用户手动打开的看板。
  useEffect(() => {
    if (!running) return;
    wasRunning.current = true;
    setPanel(null);
  }, [running]);

  // 正常结束（running true -> false）或会话创建失败（running 从未变 true，
  // 只落了 error）都要把结论弹出来，所以 error 单独兜底。
  useEffect(() => {
    if (running) return;
    if (!wasRunning.current && !error) return;
    if (!snapshot && !answer && !error) return;
    wasRunning.current = false;
    setPanel('result');
  }, [running, snapshot, answer, error]);

  // 浮层打开后按 Escape 收起，和常见浮层一致。
  useEffect(() => {
    if (!panel) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [panel]);

  const handleToggleBoard = () => {
    setPanel((current) => (current === 'board' ? null : 'board'));
  };

  const handleToggleResult = () => {
    setPanel((current) => (current === 'result' ? null : 'result'));
  };

  const handleClose = () => {
    setPanel(null);
  };

  return (
    <div className="relative shrink-0">
      {panel === 'board' && (
        <div
          id="workbench-board-panel"
          data-testid="dispatch-dock-panel"
          role="region"
          aria-label={t('flow.agentTeam.page.dock.title')}
          className="absolute inset-x-0 bottom-full z-30 mb-3 h-[min(56vh,520px)] animate-in rounded-xl border border-border-button bg-bg-base p-3 shadow-xl fade-in-0 slide-in-from-bottom-2 duration-200"
        >
          <DispatchBoard cards={cards} />
        </div>
      )}

      {panel === 'result' && (
        <div
          id="workbench-result-panel"
          data-testid="result-dock-panel"
          role="region"
          aria-label={t('flow.agentTeam.page.result')}
          className="absolute bottom-full right-0 z-30 mb-3 flex h-[min(72vh,680px)] w-[min(880px,100%)] animate-in flex-col overflow-hidden rounded-xl border border-border-button bg-bg-base shadow-xl fade-in-0 slide-in-from-bottom-2 duration-200"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border-button py-2 pl-4 pr-2">
            <span className="text-sm font-medium text-text-primary">
              {t('flow.agentTeam.page.result')}
            </span>
            {running && (
              <Badge variant="default">
                {t('flow.agentTeam.status.running')}
              </Badge>
            )}
            {resultFinished && !resultFailed && (
              <Badge variant="success">
                {t('flow.agentTeam.status.success')}
              </Badge>
            )}
            {resultFinished && resultFailed && (
              <Badge variant="destructive">
                {t('flow.agentTeam.status.failed')}
              </Badge>
            )}
            <button
              type="button"
              aria-label={t('flow.agentTeam.page.dock.collapse')}
              onClick={handleClose}
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-bg-accent hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ResultPanel
              team={team}
              snapshot={snapshot}
              answer={answer}
              error={error}
              running={running}
            />
          </div>
        </div>
      )}

      <div className="flex h-12 w-full items-stretch overflow-hidden rounded-xl border border-border-button bg-bg-card">
        <button
          type="button"
          data-testid="dispatch-dock-toggle"
          aria-expanded={panel === 'board'}
          aria-controls="workbench-board-panel"
          onClick={handleToggleBoard}
          className="flex min-w-0 flex-1 items-center gap-3 pl-4 pr-3 text-left transition-colors hover:bg-bg-accent"
        >
          <span className="shrink-0 text-sm font-medium text-text-primary">
            {t('flow.agentTeam.page.dock.title')}
          </span>
          <span className="h-4 w-px shrink-0 bg-border-button" aria-hidden />
          <span className="flex min-w-0 flex-1 items-center gap-5">
            {BOARD_COLUMNS.map((column) => (
              <span key={column} className="flex min-w-0 items-center gap-1.5">
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    STATUS_DOT[column],
                  )}
                  aria-hidden
                />
                <span
                  data-testid={`dispatch-count-${column}`}
                  className="shrink-0 text-sm font-medium tabular-nums text-text-primary"
                >
                  {grouped[column].length}
                </span>
                <span className="truncate text-xs text-text-secondary">
                  {t(`flow.agentTeam.page.board.${column}`)}
                </span>
              </span>
            ))}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-text-secondary">
            <span className="hidden sm:inline">
              {t(
                panel === 'board'
                  ? 'flow.agentTeam.page.dock.collapse'
                  : 'flow.agentTeam.page.dock.expand',
              )}
            </span>
            {panel === 'board' ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </span>
        </button>

        <button
          type="button"
          data-testid="result-dock-toggle"
          aria-expanded={panel === 'result'}
          aria-controls="workbench-result-panel"
          onClick={handleToggleResult}
          className="flex shrink-0 items-center gap-2 border-l border-border-button px-4 text-sm font-medium text-text-primary transition-colors hover:bg-bg-accent"
        >
          <span>{t('flow.agentTeam.page.result')}</span>
          {running && (
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-primary"
              aria-hidden
            />
          )}
          {resultFinished && (
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                resultFailed ? 'bg-state-error' : 'bg-state-success',
              )}
              aria-hidden
            />
          )}
          {panel === 'result' ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
};

export default WorkbenchDock;
