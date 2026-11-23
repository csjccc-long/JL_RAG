import { useEffect, useState } from 'react';

export type DashboardChartColors = {
  accent: string;
  accentRgb: [number, number, number];
  primary: string;
  secondary: string;
  grid: string;
  empty: string;
  hover: string;
  tooltipBackground: string;
  tooltipBorder: string;
  tooltipShadow: string;
};

const FallbackColors: DashboardChartColors = {
  accent: 'rgb(0 190 180)',
  accentRgb: [0, 190, 180],
  primary: 'rgb(22 22 24)',
  secondary: 'rgb(117 120 122)',
  grid: 'rgba(22, 22, 24, 0.08)',
  empty: 'rgba(22, 22, 24, 0.06)',
  hover: 'rgba(0, 190, 180, 0.08)',
  tooltipBackground: 'rgb(255 255 255)',
  tooltipBorder: 'rgba(0, 0, 0, 0.1)',
  tooltipShadow: 'rgba(0, 0, 0, 0.12)',
};

const parseTriplet = (
  raw: string,
  fallback: [number, number, number],
): [number, number, number] => {
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((part) => Number.isFinite(part));

  return parts.length >= 3 ? [parts[0], parts[1], parts[2]] : fallback;
};

const readColors = (): DashboardChartColors => {
  if (typeof window === 'undefined') return FallbackColors;

  const styles = getComputedStyle(document.documentElement);
  const accentRgb = parseTriplet(
    styles.getPropertyValue('--accent-primary'),
    FallbackColors.accentRgb,
  );
  const textRgb = parseTriplet(
    styles.getPropertyValue('--text-primary'),
    [22, 22, 24],
  );
  const secondaryRgb = parseTriplet(
    styles.getPropertyValue('--text-secondary'),
    [117, 120, 122],
  );

  return {
    accent: 'rgb(' + accentRgb.join(' ') + ')',
    accentRgb,
    primary: 'rgb(' + textRgb.join(' ') + ')',
    secondary: 'rgb(' + secondaryRgb.join(' ') + ')',
    grid: 'rgba(' + textRgb.join(', ') + ', 0.08)',
    empty: 'rgba(' + textRgb.join(', ') + ', 0.06)',
    hover: 'rgba(' + accentRgb.join(', ') + ', 0.08)',
    tooltipBackground:
      styles.getPropertyValue('--bg-base').trim() ||
      FallbackColors.tooltipBackground,
    tooltipBorder:
      styles.getPropertyValue('--border-button').trim() ||
      FallbackColors.tooltipBorder,
    tooltipShadow: FallbackColors.tooltipShadow,
  };
};

/** Recharts needs concrete colors, so read the design tokens at runtime. */
export const useDashboardChartColors = () => {
  const [chartColors, setChartColors] =
    useState<DashboardChartColors>(readColors);

  useEffect(() => {
    const syncColors = () => setChartColors(readColors());
    const observer = new MutationObserver(syncColors);

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    return () => observer.disconnect();
  }, []);

  return chartColors;
};

export const getDashboardTooltipStyle = (colors: DashboardChartColors) => ({
  background: colors.tooltipBackground,
  border: '1px solid ' + colors.tooltipBorder,
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  color: colors.primary,
  boxShadow: '0 8px 24px ' + colors.tooltipShadow,
});
