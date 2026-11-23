/*
 * The cumulative token line.
 *
 * A curve, not a polyline: joining the readings with straight segments invents
 * a corner at every sample. Catmull-Rom converted to cubic beziers passes
 * through every reading exactly and takes its control points from the
 * neighbours, so nothing is invented and nothing overshoots.
 *
 * One pass produces the stroke, the scrub dot and the point you can read the
 * figure from, because all three have to agree — generating them separately is
 * how a dot ends up beside the curve it is supposed to be on.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Segmented, SegmentedValue } from '@/components/ui/segmented';
import { IDataset } from '@/interfaces/database/dataset';

import { useDashboardChartColors } from '../use-dashboard-chart-colors';
import { playScrubTick } from './dashboard-sound';
import { curve, segments, trace } from './trend-geometry';
import { TrendCloudLayer } from './trend-cloud-layer';
import { CrestDelay, TrendTerrain } from './trend-terrain';
import {
  accumulateTokensByBucket,
  DashboardBucket,
  DashboardBucketType,
  formatBucketLabel,
  formatCompactNumber,
  formatExactNumber,
} from '../utils';

type TokenTrendCardProps = {
  knowledgeBases: IDataset[];
};

/* the line, or the line standing in front of a drawn landscape */
type TrendMode = 'line' | 'terrain';

const TrendModes: TrendMode[] = ['line', 'terrain'];

/* the plot is drawn in its own units and stretched to the card */
const PlotWidth = 100;
const PlotHeight = 40;
const PlotPad = 4;
/* in the landscape the readings sit high in the box: the body hangs under them */
const TerrainFloor = 26;
/* how high the scenery rises and falls, in plot units */

/* how many places along each line are mixed, and how long the mix takes */
const MorphSamples = 48;
const MorphMs = 420;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

const mix = (from: number, to: number, at: number) =>
  from + (to - from) * at;

const outQuart = (t: number) => 1 - (1 - t) ** 4;

/* Read once: a preference, not a live input. */
const prefersStillness = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const GranularityOptions = [
  { value: DashboardBucket.Week, labelKey: "setting.dashboard.granularity.week" },
  { value: DashboardBucket.Month, labelKey: "setting.dashboard.granularity.month" },
  { value: DashboardBucket.Year, labelKey: "setting.dashboard.granularity.year" },
];

export function TokenTrendCard({ knowledgeBases }: TokenTrendCardProps) {
  const { t } = useTranslation();
  const colors = useDashboardChartColors();
  const still = prefersStillness();

  const [granularity, setGranularity] = useState<DashboardBucketType>(
    DashboardBucket.Month,
  );
  /* which point the pointer is over, or null for "the latest" */
  const [scrub, setScrub] = useState<number | null>(null);
  const [mode, setMode] = useState<TrendMode>('line');
  const [m, setM] = useState(1);

  const points = useMemo(
    () => accumulateTokensByBucket(knowledgeBases, granularity),
    [knowledgeBases, granularity],
  );

  const series = useMemo(
    () => points.map((point) => point.total),
    [points],
  );

  const line = useMemo(
    () => curve(series, PlotWidth, PlotHeight, PlotPad),
    [series],
  );

  const terrainLine = useMemo(
    () => curve(series, PlotWidth, PlotHeight, PlotPad, TerrainFloor),
    [series],
  );


  const last = series.length - 1;
  const isEmpty = series[last] === 0;

  /*
   * ── the line, heard ─────────────────────────────────────────────
   * One tick per READING, and that is the one thing here that rounds. The
   * position and the figure are continuous; the note is not, because a sound
   * that fired on every pointer move is a hiss rather than a scrub. Counting off
   * the readings you cross is what running along a chart should sound like.
   *
   * The pitch rides the VALUE — a fifth either way around the base — so a climb
   * sounds like a climb. The sound module rate-limits the other end of it, for
   * a flick fast enough to cross several readings at once.
   */
  const heard = useRef(-1);
  const tickFor = useCallback(
    (index: number) => {
      const clamped = clamp(Math.round(index), 0, last);
      if (clamped === heard.current) return;
      heard.current = clamped;

      let lo = series[0];
      let hi = series[0];
      for (const value of series) {
        if (value < lo) lo = value;
        if (value > hi) hi = value;
      }

      playScrubTick(hi > lo ? (series[clamped] - lo) / (hi - lo) : 1);
    },
    [last, series],
  );

  /*
   * The plot is stretched to whatever width the card has, so the landscape's
   * depth has to know how wide that is: the same 17 units of lift is a shallow
   * slope on a 1500px card and a cliff on a 360px one.
   */
  const chartRef = useRef<HTMLSpanElement | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

  useEffect(() => {
    const node = chartRef.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      setChartWidth(entries[0].contentRect.width);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [isEmpty]);

  /* one index feeds the balance, the dot and the period label */
  const shown = scrub ?? last;
  const low = Math.floor(shown);
  const high = Math.min(last, Math.ceil(shown));
  const total = mix(series[low], series[high], shown - low);
  const added = mix(points[low].added, points[high].added, shown - low);

  const goal = useMemo(
    () => ({
      pts: Array.from({ length: MorphSamples }, (_, index) =>
        line.at((index / (MorphSamples - 1)) * last),
      ),
      total,
    }),
    [line, last, total],
  );

  /*
   * A NEW WINDOW IS A MORPH, not a cut: the old line turns into the new one and
   * the figure counts across, on one number, so they cannot arrive at different
   * times. The windows hold different numbers of readings, so neither is morphed
   * point for point — both are sampled at the same number of places and those
   * are mixed.
   */
  const from = useRef<typeof goal | null>(null);
  const onScreen = useRef<typeof goal | null>(null);
  const seenKey = useRef(granularity);

  useLayoutEffect(() => {
    if (seenKey.current === granularity) return;
    seenKey.current = granularity;

    if (still || !onScreen.current) {
      setM(1);
      return;
    }

    from.current = onScreen.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / MorphMs);
      setM(outQuart(progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    setM(0);
    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [granularity, still]);

  const morphing = m < 1 && scrub === null && !!from.current;
  const previous = from.current;
  const show =
    morphing && previous
      ? {
          pts: goal.pts.map((point, index) => ({
            x: mix(previous.pts[index].x, point.x, m),
            y: mix(previous.pts[index].y, point.y, m),
          })),
          total: mix(previous.total, goal.total, m),
        }
      : goal;

  /* what is on screen now, so the next change starts from it */
  useLayoutEffect(() => {
    onScreen.current = show;
  });

  const growth = show.total - series[0];
  const isTerrain = mode === 'terrain';
  const plot = isTerrain ? terrainLine : line;
  const dot = morphing ? show.pts[MorphSamples - 1] : plot.at(shown);

  const handleModeChange = useCallback((value: SegmentedValue) => {
    setMode(value as TrendMode);
  }, []);

  const handleGranularityChange = useCallback((value: SegmentedValue) => {
    /* a new window is a different line, so the note starts again */
    heard.current = -1;
    setScrub(null);
    setGranularity(value as DashboardBucketType);
  }, []);

  const handleScrub = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = clamp((event.clientX - rect.left) / (rect.width || 1), 0, 1);

      tickFor(ratio * last);
      setScrub(ratio * last);
    },
    [last, tickFor],
  );

  const handleScrubEnd = useCallback(() => setScrub(null), []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLSpanElement>) => {
      if (event.key === "Escape") {
        setScrub(null);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      event.preventDefault();
      const origin = scrub ?? last;
      const next = clamp(origin + (event.key === "ArrowRight" ? 1 : -1), 0, last);

      tickFor(next);
      setScrub(next >= last ? null : next);
    },
    [last, scrub, tickFor],
  );

  const modeOptions = useMemo(
    () =>
      TrendModes.map((option) => ({
        value: option,
        label: t(`setting.dashboard.trend.mode.${option}`),
      })),
    [t],
  );

  const granularityOptions = useMemo(
    () =>
      GranularityOptions.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      })),
    [t],
  );

  const periodLabel =
    scrub === null
      ? t(`setting.dashboard.trend.span.${granularity}`)
      : formatBucketLabel(points[Math.round(shown)].start, granularity, t);

  return (
    <Card
      as="article"
      className="col-span-12 flex flex-col bg-bg-base shadow-none"
    >
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 p-4 pb-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-text-secondary">
            {t('setting.dashboard.trend.title')}
          </span>
          <span
            className="text-2xl font-medium tabular-nums text-text-primary"
            title={formatExactNumber(Math.round(show.total))}
          >
            {formatExactNumber(Math.round(show.total))}
          </span>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
            <span className="tabular-nums text-text-primary">
              {scrub === null
                ? (growth > 0 ? '+' : '') + formatCompactNumber(growth)
                : '+' + formatCompactNumber(Math.round(added))}
            </span>
            <span className="text-text-secondary">{periodLabel}</span>
          </div>
          {mode === 'terrain' ? (
            <span className="text-[11px] text-text-secondary">
              {t('setting.dashboard.trend.note.scenery')}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            options={modeOptions}
            value={mode}
            onChange={handleModeChange}
            sizeType="sm"
          />
          <Segmented
            options={granularityOptions}
            value={granularity}
            onChange={handleGranularityChange}
            sizeType="sm"
          />
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-2 p-4 pt-2">
        {isEmpty ? (
          <p className="py-12 text-center text-xs text-text-secondary">
            {t('setting.dashboard.trend.empty')}
          </p>
        ) : (
          <>
            <span
              ref={chartRef}
              className="relative block min-h-[200px] w-full flex-1 touch-none select-none"
              role="img"
              tabIndex={0}
              aria-label={t('setting.dashboard.trend.title')}
              onPointerMove={handleScrub}
              onPointerDown={handleScrub}
              onPointerLeave={handleScrubEnd}
              onBlur={handleScrubEnd}
              onKeyDown={handleKeyDown}
            >
              {isTerrain ? (
                <>
                  <TrendTerrain
                    key={granularity + mode}
                    line={plot}
                    fade={colors.primary}
                    compact={chartWidth > 0 && chartWidth < 480}
                  />
                  <TrendCloudLayer
                    key={'cloud-' + granularity + mode}
                    line={plot}
                    tint={colors.primary}
                  />
                </>
              ) : null}

              <svg
                className="absolute inset-0 size-full overflow-visible"
                viewBox={`0 0 ${PlotWidth} ${PlotHeight}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  className={isTerrain ? 'trend-crest-draw' : undefined}
                  style={isTerrain ? { animationDelay: CrestDelay + 'ms' } : undefined}
                  pathLength={isTerrain ? 1 : undefined}
                  d={isTerrain ? plot.d : morphing ? trace(segments(show.pts)) : line.d}
                  fill="none"
                  stroke={colors.accent}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>

              {scrub !== null && (
                <i
                  className="pointer-events-none absolute inset-y-0 w-px"
                  style={{ left: `${dot.x}%`, backgroundColor: colors.grid }}
                />
              )}

              {/* one dot, drawn as an element: the svg stretches with
                  preserveAspectRatio="none", which would turn a circle inside
                  it into an ellipse */}
              <i
                className={`pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full${
                  isTerrain ? ' trend-crest-dot' : ''
                }`}
                style={{
                  left: `${dot.x}%`,
                  top: `${(dot.y / PlotHeight) * 100}%`,
                  backgroundColor: colors.accent,
                  animationDelay: isTerrain ? CrestDelay + 680 + 'ms' : undefined,
                }}
              />
            </span>

            {/* each label sits under its own reading, so a label can fade out
                without dragging its neighbours off their points */}
            <div className="relative h-4 text-[11px] text-text-secondary">
              {points.map((point, index) => (
                <span
                  key={index}
                  className={`absolute top-0 whitespace-nowrap ${
                    index % 2 === 1 ? 'opacity-0 sm:opacity-100' : ''
                  }`}
                  style={{
                    left: `${last === 0 ? 0 : (index / last) * 100}%`,
                    transform: `translateX(${
                      index === 0 ? '0' : index === last ? '-100%' : '-50%'
                    })`,
                  }}
                >
                  {formatBucketLabel(point.start, granularity, t)}
                </span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}