import { LucideChevronLeft, LucideChevronRight } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { RAGFlowAvatar } from '@/components/ragflow-avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { IDataset } from '@/interfaces/database/dataset';
import { Routes } from '@/routes';

import {
  DashboardRecentPageSize,
  DashboardViewType,
  getRelativeTime,
  sortKnowledgeBases,
} from '../utils';

type RecentKnowledgeCardProps = {
  knowledgeBases: IDataset[];
  view: DashboardViewType;
  loading: boolean;
};

const RelativeTimeKeys = {
  today: 'setting.dashboard.relative.today',
  days: 'setting.dashboard.relative.daysAgo',
  months: 'setting.dashboard.relative.monthsAgo',
  years: 'setting.dashboard.relative.yearsAgo',
} as const;

export function RecentKnowledgeCard({
  knowledgeBases,
  view,
  loading,
}: RecentKnowledgeCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);

  const sortedKnowledgeBases = useMemo(
    () => sortKnowledgeBases(knowledgeBases, view),
    [knowledgeBases, view],
  );

  const pageCount = Math.max(
    1,
    Math.ceil(sortedKnowledgeBases.length / DashboardRecentPageSize),
  );
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = sortedKnowledgeBases.slice(
    currentPage * DashboardRecentPageSize,
    (currentPage + 1) * DashboardRecentPageSize,
  );

  const handlePrevious = useCallback(() => {
    setPage(Math.max(0, currentPage - 1));
  }, [currentPage]);

  const handleNext = useCallback(() => {
    setPage(Math.min(pageCount - 1, currentPage + 1));
  }, [currentPage, pageCount]);

  const handleOpen = useCallback(
    (knowledgeBaseId: string) => () => {
      navigate(Routes.Dataset + '/' + knowledgeBaseId);
    },
    [navigate],
  );

  const formatRelativeTime = useCallback(
    (timestamp?: number) => {
      const relative = getRelativeTime(timestamp);

      if (relative.unit === 'today') return t(RelativeTimeKeys.today);

      return t(RelativeTimeKeys[relative.unit], {
        [relative.unit]: relative.value,
      });
    },
    [t],
  );

  return (
    <Card
      as="article"
      className="col-span-12 flex flex-col bg-bg-base shadow-none lg:col-span-3"
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 p-4 pb-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-sm text-text-secondary">
            {t('setting.dashboard.recent.title')}
          </span>
          <span className="shrink-0 text-lg font-medium text-text-primary">
            {sortedKnowledgeBases.length}
          </span>
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs text-text-secondary">
          {t('setting.dashboard.recent.page', {
            current: currentPage + 1,
            total: pageCount,
          })}
        </span>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-1 p-3 pt-1">
        {pageItems.length === 0 && (
          <p className="px-1 py-8 text-center text-xs text-text-secondary">
            {loading ? '...' : t('setting.dashboard.recent.empty')}
          </p>
        )}

        {pageItems.map((knowledgeBase) => (
          <button
            key={knowledgeBase.id}
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-bg-card"
            onClick={handleOpen(knowledgeBase.id)}
          >
            <RAGFlowAvatar
              name={knowledgeBase.name}
              avatar={knowledgeBase.avatar}
              className="size-8"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-text-primary">
                {knowledgeBase.name}
              </span>
              <span className="truncate text-xs text-text-secondary">
                {formatRelativeTime(knowledgeBase.create_time)}
              </span>
            </span>
          </button>
        ))}
      </CardContent>

      <div className="flex items-center gap-2 border-t border-border-button p-3">
        <Button
          variant="secondary"
          size="sm"
          className="min-w-0 flex-1 gap-1"
          disabled={currentPage === 0}
          onClick={handlePrevious}
        >
          <LucideChevronLeft className="size-3.5" />
          {t('setting.dashboard.recent.previous')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="min-w-0 flex-1 gap-1"
          disabled={currentPage >= pageCount - 1}
          onClick={handleNext}
        >
          {t('setting.dashboard.recent.next')}
          <LucideChevronRight className="size-3.5" />
        </Button>
      </div>
    </Card>
  );
}
