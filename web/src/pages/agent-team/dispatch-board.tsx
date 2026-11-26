import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  BOARD_COLUMNS,
  groupCardsByColumn,
  ITeamBoardCard,
  TeamCardStatus,
} from './utils/board';

const COLUMN_TONE: Record<TeamCardStatus, string> = {
  pending: 'border-border-button',
  running: 'border-text-primary/40',
  done: 'border-border-button',
  failed: 'border-state-error',
};

interface DispatchBoardProps {
  cards: ITeamBoardCard[];
}

const DispatchBoard = ({ cards }: DispatchBoardProps) => {
  const { t } = useTranslation();
  const grouped = groupCardsByColumn(cards);

  return (
    <div data-testid="dispatch-board" className="grid h-full grid-cols-4 gap-3">
      {BOARD_COLUMNS.map((column) => (
        <div key={column} className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-sm font-medium text-text-primary">
              {t(`flow.agentTeam.page.board.${column}`)}
            </span>
            <Badge variant="secondary">{grouped[column].length}</Badge>
          </div>
          <ScrollArea className="min-h-0 flex-1 rounded-lg bg-bg-card">
            <div className="flex flex-col gap-2 p-2">
              {grouped[column].length === 0 && (
                <div className="px-1 py-6 text-center text-xs text-text-disabled">
                  {t('flow.agentTeam.page.boardEmpty')}
                </div>
              )}
              {grouped[column].map((card) => (
                <div
                  key={card.id}
                  className={cn(
                    'flex flex-col gap-1.5 rounded-md border bg-bg-base p-2.5',
                    COLUMN_TONE[card.status],
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-text-primary">
                      {card.workerName || card.workerId}
                    </span>
                    {card.round > 1 && (
                      <span className="shrink-0 text-[10px] text-text-secondary">
                        {t('flow.agentTeam.page.roundLabel', { round: card.round })}
                      </span>
                    )}
                  </div>
                  <div className="line-clamp-3 text-xs text-text-secondary">
                    {card.task}
                  </div>
                  {card.status === 'failed' && card.error && (
                    <div className="line-clamp-2 text-[10px] text-state-error">
                      {card.error}
                    </div>
                  )}
                  {card.status === 'done' && card.result && (
                    <div className="line-clamp-2 text-[10px] text-text-disabled">
                      {card.result}
                    </div>
                  )}
                  {typeof card.elapsedMs === 'number' && card.elapsedMs > 0 && (
                    <div className="text-[10px] text-text-disabled">
                      {(card.elapsedMs / 1000).toFixed(1)}s
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      ))}
    </div>
  );
};

export default DispatchBoard;
