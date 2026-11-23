import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Segmented, SegmentedValue } from '@/components/ui/segmented';
import { IDataset } from '@/interfaces/database/dataset';

import {
  getDashboardTooltipStyle,
  useDashboardChartColors,
} from '../use-dashboard-chart-colors';
import {
  countKnowledgeBasesByBucket,
  DashboardBucket,
  DashboardBucketType,
  formatBucketLabel,
  formatCompactNumber,
  formatDeltaPercent,
  formatExactNumber,
  getDeltaPercent,
} from '../utils';
import { DeltaBadge } from './delta-badge';
import './knowledge-bar-card.css';

type KnowledgeBarCardProps = {
  knowledgeBases: IDataset[];
};

type DashboardBarShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  background?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  trackFill: string;
  valueFill: string;
  index?: number;
};

/**
 * Recharts derives a bar background rect from the bar itself, so drawing the
 * empty track and the value from one bar keeps them at the exact same x and
 * width. Two separate <Bar> series are laid out side by side and drift apart.
 */
function DashboardBarShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  background,
  trackFill,
  valueFill,
  index = 0,
}: DashboardBarShapeProps) {
  const track = { x, y, width, height, ...background };

  return (
    <g>
      <rect
        x={track.x}
        y={track.y}
        width={track.width}
        height={track.height}
        rx={6}
        ry={6}
        fill={trackFill}
      />
      {width > 0 && height > 0 && (
        <rect
          /* rises from the baseline on mount — see knowledge-bar-card.css */
          className="dashboard-bar-value"
          x={x}
          y={y}
          width={width}
          height={height}
          rx={6}
          ry={6}
          fill={valueFill}
          style={{ ['--bar-index' as string]: index }}
        />
      )}
    </g>
  );
}

const GranularityOptions = [
  {
    value: DashboardBucket.Week,
    labelKey: 'setting.dashboard.granularity.week',
  },
  {
    value: DashboardBucket.Month,
    labelKey: 'setting.dashboard.granularity.month',
  },
  {
    value: DashboardBucket.Year,
    labelKey: 'setting.dashboard.granularity.year',
  },
];

export function KnowledgeBarCard({ knowledgeBases }: KnowledgeBarCardProps) {
  const { t } = useTranslation();
  const colors = useDashboardChartColors();
  const [granularity, setGranularity] = useState<DashboardBucketType>(
    DashboardBucket.Month,
  );

  // Twelve month labels do not fit a phone: below this width the axis drops the
  // month suffix instead of letting the labels run into each other.
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);

  useEffect(() => {
    const node = chartRef.current;

    if (!node || typeof ResizeObserver !== 'function') {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setChartWidth(entry.contentRect.width);
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  const isCompact = chartWidth > 0 && chartWidth < 420;

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

  const deltaLabel = formatDeltaPercent(
    getDeltaPercent(createdThisYear, createdLastYear),
  );

  const points = useMemo(
    () => countKnowledgeBasesByBucket(knowledgeBases, granularity),
    [knowledgeBases, granularity],
  );

  // The empty track behind every bar spans the full axis height, so the chart
  // keeps its rhythm even when a month has no new knowledge base.
  const axisMax = Math.max(4, ...points.map((point) => point.value));

  const chartData = useMemo(
    () =>
      points.map((point) => ({
        label: formatBucketLabel(point.start, granularity, t),
        value: point.value,
      })),
    [points, granularity, t],
  );

  const granularityOptions = useMemo(
    () =>
      GranularityOptions.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      })),
    [t],
  );

  const handleGranularityChange = useCallback((value: SegmentedValue) => {
    setGranularity(value as DashboardBucketType);
  }, []);

  const formatAxisTick = useCallback(
    (label: string) =>
      isCompact ? label.replace(/\s*月$/, '') : label,
    [isCompact],
  );

  const formatTooltipValue = useCallback(
    (value: number | string) => formatCompactNumber(Number(value)),
    [],
  );

  return (
    <Card
      as="article"
      className="col-span-12 bg-bg-base shadow-none lg:col-span-9"
    >
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 p-4 pb-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-text-secondary">
            {t('setting.dashboard.bar.title')}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-medium text-text-primary">
              {formatExactNumber(createdThisYear)}
            </span>
            {deltaLabel && (
              <DeltaBadge
                value={deltaLabel}
                isPositive={
                  (getDeltaPercent(createdThisYear, createdLastYear) ?? 0) >= 0
                }
              />
            )}
          </div>
          <span className="text-xs text-text-secondary">
            {t('setting.dashboard.bar.total', { value: knowledgeBases.length })}
          </span>
        </div>

        <Segmented
          options={granularityOptions}
          value={granularity}
          onChange={handleGranularityChange}
          sizeType="sm"
        />
      </CardHeader>

      <CardContent className="p-4 pt-2">
        <div ref={chartRef} className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              key={granularity}
              data={chartData}
              margin={{ top: 8, right: 4, bottom: 0, left: -16 }}
              barCategoryGap="26%"
            >
              <CartesianGrid
                vertical={false}
                stroke={colors.grid}
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                interval={0}
                tickFormatter={formatAxisTick}
                tick={{ fill: colors.secondary, fontSize: isCompact ? 10 : 11 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={36}
                domain={[0, axisMax]}
                allowDecimals={false}
                tick={{ fill: colors.secondary, fontSize: 11 }}
              />
              <Tooltip
                cursor={{ fill: colors.hover }}
                contentStyle={getDashboardTooltipStyle(colors)}
                labelStyle={{ color: colors.primary }}
                formatter={formatTooltipValue}
              />
              <Bar
                dataKey="value"
                name={t('setting.dashboard.metrics.knowledgeBases')}
                maxBarSize={26}
                isAnimationActive={false}
                shape={
                  <DashboardBarShape
                    trackFill={colors.empty}
                    valueFill={colors.accent}
                  />
                }
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
