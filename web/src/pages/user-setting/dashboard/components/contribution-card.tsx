import dayjs from 'dayjs';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { IDataset } from '@/interfaces/database/dataset';

import type { DashboardTotals } from '../utils';
import {
  formatCompactNumber,
  formatDeltaPercent,
  formatExactNumber,
  getDeltaPercent,
} from '../utils';
import { ActivityHeatmap } from './activity-heatmap';
import { DeltaBadge } from './delta-badge';

type ContributionCardProps = {
  knowledgeBases: IDataset[];
  totals: DashboardTotals;
};

export function ContributionCard({
  knowledgeBases,
  totals,
}: ContributionCardProps) {
  const { t } = useTranslation();

  const createdThisYear = useMemo(
    () =>
      knowledgeBases.filter(
        (knowledgeBase) =>
          dayjs(knowledgeBase.create_time).year() === dayjs().year(),
      ).length,
    [knowledgeBases],
  );

  const createdLastYear = useMemo(
    () =>
      knowledgeBases.filter(
        (knowledgeBase) =>
          dayjs(knowledgeBase.create_time).year() === dayjs().year() - 1,
      ).length,
    [knowledgeBases],
  );

  const deltaPercent = getDeltaPercent(createdThisYear, createdLastYear);
  const deltaLabel = formatDeltaPercent(deltaPercent);

  const metrics = useMemo(
    () => [
      {
        key: 'documents',
        label: t('setting.dashboard.metrics.documents'),
        value: formatCompactNumber(totals.documents),
        title: formatExactNumber(totals.documents),
      },
      {
        key: 'chunks',
        label: t('setting.dashboard.metrics.chunks'),
        value: formatCompactNumber(totals.chunks),
        title: formatExactNumber(totals.chunks),
      },
      {
        key: 'tokens',
        label: t('setting.dashboard.metrics.tokens'),
        value: formatCompactNumber(totals.tokens),
        title: formatExactNumber(totals.tokens),
      },
      {
        key: 'knowledgeBases',
        label: t('setting.dashboard.metrics.knowledgeBases'),
        value: formatCompactNumber(totals.knowledgeBases),
        title: formatExactNumber(totals.knowledgeBases),
      },
    ],
    [t, totals],
  );

  return (
    <Card
      as="article"
      className="col-span-12 flex flex-col bg-bg-base shadow-none lg:col-span-5"
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 p-4 pb-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-text-secondary">
            {t('setting.dashboard.contribution.title')}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-medium text-text-primary">
              {formatExactNumber(createdThisYear)}
            </span>
            {deltaLabel && (
              <DeltaBadge
                value={deltaLabel}
                isPositive={(deltaPercent ?? 0) >= 0}
              />
            )}
          </div>
        </div>
        <span className="text-xs text-text-secondary">
          {t('setting.dashboard.contribution.newThisYear', {
            value: createdThisYear,
          })}
        </span>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4 p-4 pt-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {metrics.map((metric) => (
            <div key={metric.key} className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-text-secondary">
                {metric.label}
              </span>
              <span
                title={metric.title}
                className="truncate text-lg font-medium text-text-primary"
              >
                {metric.value}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-1 flex-col gap-2">
          <span className="text-xs text-text-secondary">
            {t('setting.dashboard.contribution.activity')}
          </span>
          <ActivityHeatmap knowledgeBases={knowledgeBases} />
        </div>
      </CardContent>
    </Card>
  );
}
