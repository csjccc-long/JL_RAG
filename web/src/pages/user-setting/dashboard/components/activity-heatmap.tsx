import { Dayjs } from 'dayjs';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { IDataset } from '@/interfaces/database/dataset';

import {
  DashboardChartColors,
  useDashboardChartColors,
} from '../use-dashboard-chart-colors';
import { buildActivityHeatmap } from '../utils';

type ActivityHeatmapProps = {
  knowledgeBases: IDataset[];
};

const ActivityLevelOpacity = [0, 0.2, 0.4, 0.65, 0.95];

const getCellColor = (level: number, colors: DashboardChartColors) =>
  level <= 0
    ? colors.empty
    : 'rgba(' +
      colors.accentRgb.join(', ') +
      ', ' +
      ActivityLevelOpacity[level] +
      ')';

export function ActivityHeatmap({ knowledgeBases }: ActivityHeatmapProps) {
  const { t } = useTranslation();
  const colors = useDashboardChartColors();
  const columns = useMemo(
    () => buildActivityHeatmap(knowledgeBases),
    [knowledgeBases],
  );

  const monthLabels = useMemo(() => {
    // A label needs at least three columns of room to stay readable, so months
    // that start right after a labelled one are skipped instead of clipped.
    const MinLabelGap = 3;
    let lastLabelledIndex = -MinLabelGap;

    return columns.map((column, index) => {
      const month = column.cells[0].date.month();
      const previousMonth =
        index > 0 ? columns[index - 1].cells[0].date.month() : -1;

      if (previousMonth === month) return '';
      if (index - lastLabelledIndex < MinLabelGap) return '';

      lastLabelledIndex = index;
      return t('setting.dashboard.axis.month', { month: month + 1 });
    });
  }, [columns, t]);

  const formatCellTitle = (date: Dayjs, count: number) =>
    t('setting.dashboard.tooltip.activity', {
      date: date.format('MM-DD'),
      value: count,
    });

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex gap-[3px] text-[10px] leading-none text-text-secondary">
        {columns.map((column, index) => (
          <span
            key={column.key}
            className="min-w-0 flex-1 whitespace-nowrap"
          >
            {monthLabels[index]}
          </span>
        ))}
      </div>

      <div className="flex w-full gap-[3px]">
        {columns.map((column) => (
          <div
            key={column.key}
            className="flex min-w-0 flex-1 flex-col gap-[3px]"
          >
            {column.cells.map((cell) => (
              <div
                key={cell.date.valueOf()}
                title={formatCellTitle(cell.date, cell.count)}
                className="aspect-square w-full rounded-[2px]"
                style={{
                  backgroundColor: cell.isFuture
                    ? 'transparent'
                    : getCellColor(cell.level, colors),
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
