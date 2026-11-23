import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardContent } from '@/components/ui/card';
import { Segmented, SegmentedValue } from '@/components/ui/segmented';
import { IDataset } from '@/interfaces/database/dataset';

import { useDashboardChartColors } from '../use-dashboard-chart-colors';
import { getTokenCapacity, getTokenSlices } from '../utils';
import { ContextMeter, MeterStyle } from './context-meter';

type TokenMeterCardProps = {
  knowledgeBases: IDataset[];
};

/* ink strengths, biggest consumer first: the head of the split is solid and
   the tail steps back, so one accent hue still reads as several bands */
const InkStrengths = [1, 0.62, 0.45, 0.33, 0.24];
const RestInkStrength = 0.14;

const StyleOptions = [
  { value: 'Bar', labelKey: 'setting.dashboard.tokenMeter.bar' },
  { value: 'Field', labelKey: 'setting.dashboard.tokenMeter.field' },
];

export function TokenMeterCard({ knowledgeBases }: TokenMeterCardProps) {
  const { t } = useTranslation();
  const colors = useDashboardChartColors();
  const [meterStyle, setMeterStyle] = useState<MeterStyle>('Field');

  const slices = useMemo(
    () => getTokenSlices(knowledgeBases),
    [knowledgeBases],
  );

  const total = useMemo(
    () => slices.reduce((sum, slice) => sum + slice.tokens, 0),
    [slices],
  );

  const capacity = useMemo(() => getTokenCapacity(total), [total]);

  const kinds = useMemo(
    () =>
      slices.map((slice) => ({
        id: slice.id,
        name:
          slice.id === 'rest'
            ? t('setting.dashboard.tokenMeter.rest')
            : slice.name,
        k: slice.tokens / 1000,
      })),
    [slices, t],
  );

  const colours = useMemo(() => {
    const ranked = [...slices].sort((a, b) => b.tokens - a.tokens);
    const map: Record<string, string> = {};

    ranked.forEach((slice, index) => {
      const alpha =
        slice.id === 'rest'
          ? RestInkStrength
          : (InkStrengths[index] ?? RestInkStrength);
      map[slice.id] = `rgba(${colors.accentRgb.join(', ')}, ${alpha})`;
    });

    return map;
  }, [slices, colors.accentRgb]);

  const styleOptions = useMemo(
    () =>
      StyleOptions.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      })),
    [t],
  );

  const labels = useMemo(
    () => ({
      title: t('setting.dashboard.tokenMeter.title'),
      compact: t('setting.dashboard.tokenMeter.compact'),
      undo: t('setting.dashboard.tokenMeter.undo'),
      of: (value: string) => t('setting.dashboard.tokenMeter.of', { value }),
    }),
    [t],
  );

  const handleStyleChange = useCallback((value: SegmentedValue) => {
    setMeterStyle(value as MeterStyle);
  }, []);

  return (
    <Card
      as="article"
      className="col-span-12 flex flex-col bg-bg-base shadow-none lg:col-span-7"
    >
      <CardContent className="flex flex-1 flex-col p-4">
        {slices.length === 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm text-text-secondary">
              {t('setting.dashboard.tokenMeter.title')}
            </span>
            <span className="text-xs text-text-secondary">
              {t('setting.dashboard.tokenMeter.empty')}
            </span>
          </div>
        ) : (
          <ContextMeter
            kinds={kinds}
            capacity={capacity / 1000}
            colours={colours}
            emptyColour={colors.empty}
            labels={labels}
            action={
              <Segmented
                options={styleOptions}
                value={meterStyle}
                onChange={handleStyleChange}
                sizeType="sm"
              />
            }
            style={meterStyle}
          />
        )}
      </CardContent>
    </Card>
  );
}
