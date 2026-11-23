/*
 * Dashboard aggregation helpers: bucket timelines for the charts and the
 * daily activity grid, plus the small formatters the cards share.
 */
import dayjs, { Dayjs } from 'dayjs';
import { TFunction } from 'i18next';

import { IDataset } from '@/interfaces/database/dataset';

export const DashboardView = {
  Updated: 'updated',
  Created: 'created',
} as const;
export type DashboardViewType =
  (typeof DashboardView)[keyof typeof DashboardView];

export const DashboardBucket = {
  Week: 'week',
  Month: 'month',
  Year: 'year',
} as const;
export type DashboardBucketType =
  (typeof DashboardBucket)[keyof typeof DashboardBucket];

export const DashboardBucketCount = 12;
export const DashboardHeatmapWeeks = 26;
export const DashboardRecentPageSize = 4;

export type DashboardPoint = {
  start: Dayjs;
  value: number;
};

export type DashboardHeatmapCell = {
  date: Dayjs;
  count: number;
  level: number;
  isFuture: boolean;
};

export type DashboardHeatmapColumn = {
  key: string;
  cells: DashboardHeatmapCell[];
};

export type DashboardTotals = {
  knowledgeBases: number;
  documents: number;
  chunks: number;
  tokens: number;
};

const bucketStartOf = (date: Dayjs, bucket: DashboardBucketType) =>
  date.startOf(bucket);

const bucketKeyOf = (date: Dayjs, bucket: DashboardBucketType) =>
  bucketStartOf(date, bucket).format('YYYY-MM-DD');

export const listBucketStarts = (
  bucket: DashboardBucketType,
  count = DashboardBucketCount,
): Dayjs[] => {
  if (bucket === DashboardBucket.Month) {
    // Months of the current year, so the axis reads 1月 … 12月.
    const yearStart = dayjs().startOf('year');

    return Array.from({ length: count }, (_, index) =>
      yearStart.add(index, 'month'),
    );
  }

  return Array.from({ length: count }, (_, index) =>
    bucketStartOf(dayjs().subtract(count - 1 - index, bucket), bucket),
  );
};

export const formatBucketLabel = (
  start: Dayjs,
  bucket: DashboardBucketType,
  t: TFunction,
) => {
  if (bucket === DashboardBucket.Year) {
    return t('setting.dashboard.axis.year', { year: start.year() });
  }
  if (bucket === DashboardBucket.Week) {
    return start.format('MM/DD');
  }
  return t('setting.dashboard.axis.month', { month: start.month() + 1 });
};

export const countKnowledgeBasesByBucket = (
  knowledgeBases: IDataset[],
  bucket: DashboardBucketType,
  count = DashboardBucketCount,
): DashboardPoint[] => {
  const starts = listBucketStarts(bucket, count);
  const indexByKey = new Map(
    starts.map((start, index) => [bucketKeyOf(start, bucket), index]),
  );
  const values = starts.map(() => 0);

  knowledgeBases.forEach((knowledgeBase) => {
    const index = indexByKey.get(
      bucketKeyOf(dayjs(knowledgeBase.create_time), bucket),
    );
    if (index !== undefined) {
      values[index] += 1;
    }
  });

  return starts.map((start, index) => ({ start, value: values[index] }));
};

export type DashboardTrendPoint = {
  start: Dayjs;
  /** cumulative tokens through this bucket */
  total: number;
  /** tokens added inside this bucket */
  added: number;
};

/**
 * The cumulative token level per bucket.
 *
 * A knowledge base contributes its current token count at the moment it was
 * created, which is the only timestamp a dataset carries — so the curve reads
 * as "how much text was indexed by then" rather than as a ledger. Knowledge
 * bases created before the window make up the opening level, so the curve
 * starts where the account already was instead of at zero.
 */
export const accumulateTokensByBucket = (
  knowledgeBases: IDataset[],
  bucket: DashboardBucketType,
  count = DashboardBucketCount,
): DashboardTrendPoint[] => {
  const starts = listBucketStarts(bucket, count);
  const indexByKey = new Map(
    starts.map((start, index) => [bucketKeyOf(start, bucket), index]),
  );
  const added = starts.map(() => 0);
  let opening = 0;

  knowledgeBases.forEach((knowledgeBase) => {
    const tokens = knowledgeBase.token_num || 0;
    if (tokens <= 0) return;

    const createdAt = dayjs(knowledgeBase.create_time);
    const index = indexByKey.get(bucketKeyOf(createdAt, bucket));

    if (index === undefined) {
      if (createdAt.isBefore(starts[0])) {
        opening += tokens;
      }
      return;
    }

    added[index] += tokens;
  });

  let running = opening;

  return starts.map((start, index) => {
    running += added[index];

    return { start, total: running, added: added[index] };
  });
};

export type DashboardTokenSlice = {
  id: string;
  name: string;
  tokens: number;
  share: number;
};

export const DashboardTokenSliceLimit = 5;

/**
 * Token consumption split by knowledge base, biggest first. Everything past
 * the limit is summed into one trailing slice so the meter keeps a readable
 * number of bands whatever the tenant holds.
 */
export const getTokenSlices = (
  knowledgeBases: IDataset[],
  limit = DashboardTokenSliceLimit,
): DashboardTokenSlice[] => {
  const sorted = knowledgeBases
    .map((knowledgeBase) => ({
      id: knowledgeBase.id,
      name: knowledgeBase.name,
      tokens: knowledgeBase.token_num || 0,
    }))
    .filter((slice) => slice.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
  const total = sorted.reduce((sum, slice) => sum + slice.tokens, 0);
  if (total === 0) {
    return [];
  }
  const head = sorted.slice(0, limit);
  const tail = sorted.slice(limit);

  if (tail.length > 0) {
    const restTokens = tail.reduce((sum, slice) => sum + slice.tokens, 0);
    head.push({ id: 'rest', name: '', tokens: restTokens });
  }

  return head.map((slice) => ({
    ...slice,
    share: slice.tokens / total,
  }));
};

/** Round a total up to 1/2/2.5/5 x 10^n so the meter has a stable capacity. */
export const getTokenCapacity = (total: number) => {
  if (total <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(total));

  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= total) {
      return step * magnitude;
    }
  }

  return 10 * magnitude;
};

export const getActivityLevel = (count: number) => {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
};

/**
 * Daily activity grid: one column per week, one row per weekday. A knowledge
 * base counts as activity on the day it was created and on the day it changed.
 */
export const buildActivityHeatmap = (
  knowledgeBases: IDataset[],
  weeks = DashboardHeatmapWeeks,
): DashboardHeatmapColumn[] => {
  const counts = new Map<string, number>();

  const countEvent = (timestamp?: number) => {
    if (!timestamp) return;
    const key = dayjs(timestamp).format('YYYY-MM-DD');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  knowledgeBases.forEach((knowledgeBase) => {
    countEvent(knowledgeBase.create_time);
    countEvent(knowledgeBase.update_time);
  });

  const today = dayjs().startOf('day');
  const gridStart = today.subtract(weeks * 7 - 1, 'day').startOf('week');
  const columnCount = Math.ceil((today.diff(gridStart, 'day') + 1) / 7);

  return Array.from({ length: columnCount }, (_, columnIndex) => {
    const cells = Array.from({ length: 7 }, (_, rowIndex) => {
      const date = gridStart.add(columnIndex * 7 + rowIndex, 'day');
      const count = counts.get(date.format('YYYY-MM-DD')) ?? 0;

      return {
        date,
        count,
        level: getActivityLevel(count),
        isFuture: date.isAfter(today, 'day'),
      };
    });

    return { key: cells[0].date.format('YYYY-MM-DD'), cells };
  });
};

export const formatCompactNumber = (value: number): string => {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  }
  if (absolute >= 1_000_000) {
    return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (absolute >= 1_000) {
    return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return String(value);
};

export const formatExactNumber = (value: number) => value.toLocaleString();

export const getDeltaPercent = (current: number, previous: number) => {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
};

export const formatDeltaPercent = (delta: number | null) => {
  if (delta === null || !Number.isFinite(delta)) return null;
  const rounded = Math.abs(delta) >= 100 ? delta.toFixed(0) : delta.toFixed(1);
  return (delta >= 0 ? '+' : '') + rounded + '%';
};

export type DashboardRelativeTime = {
  unit: 'today' | 'days' | 'months' | 'years';
  value: number;
};

export const getRelativeTime = (timestamp?: number): DashboardRelativeTime => {
  if (!timestamp) return { unit: 'today', value: 0 };
  const days = dayjs()
    .startOf('day')
    .diff(dayjs(timestamp).startOf('day'), 'day');

  if (days <= 0) return { unit: 'today', value: 0 };
  if (days < 30) return { unit: 'days', value: days };
  if (days < 365) return { unit: 'months', value: Math.floor(days / 30) };
  return { unit: 'years', value: Math.floor(days / 365) };
};

export const sortKnowledgeBases = (
  knowledgeBases: IDataset[],
  view: DashboardViewType,
) =>
  [...knowledgeBases].sort((first, second) =>
    view === DashboardView.Created
      ? (second.create_time || 0) - (first.create_time || 0)
      : (second.update_time || 0) - (first.update_time || 0),
  );

export const sumDashboardTotals = (
  knowledgeBases: IDataset[],
): DashboardTotals =>
  knowledgeBases.reduce<DashboardTotals>(
    (totals, knowledgeBase) => ({
      knowledgeBases: totals.knowledgeBases + 1,
      documents: totals.documents + (knowledgeBase.document_count || 0),
      chunks: totals.chunks + (knowledgeBase.chunk_count || 0),
      tokens: totals.tokens + (knowledgeBase.token_num || 0),
    }),
    { knowledgeBases: 0, documents: 0, chunks: 0, tokens: 0 },
  );
