/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

'use client';

import { BrainCog, ChevronDown, Info } from 'lucide-react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export interface EffortSliderProps {
  /** Thinking level, "0" (fastest) to "4" (smartest). */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  testId?: string;
  className?: string;
}

const THUMB_WIDTH = 24;
const PANEL_WIDTH = 348;
const MAGNET_RANGE = 0.16;
const MAGNET_STRENGTH = 0.35;

const PIXEL_REVEAL_MS = 1000;

type Rgb = [number, number, number];

interface PixelPalette {
  left: Rgb;
  tones: Rgb[];
  highlight: Rgb;
  peak: Rgb;
  alphaBase: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
};

const mix = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;

const mixRgb = (from: Rgb, to: Rgb, amount: number): Rgb => [
  mix(from[0], to[0], amount),
  mix(from[1], to[1], amount),
  mix(from[2], to[2], amount),
];

const rgbCss = (color: Rgb) =>
  `rgb(${Math.round(color[0])} ${Math.round(color[1])} ${Math.round(
    color[2],
  )})`;

/** Reads the accent token so the pixel field follows the product palette. */
const readAccent = (): Rgb => {
  if (typeof window === 'undefined') return [0, 190, 180];
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent-primary')
    .trim();
  const parts = raw
    .split(/[\s,]+/)
    .map(Number)
    .filter((part) => Number.isFinite(part));
  return parts.length >= 3 ? [parts[0], parts[1], parts[2]] : [0, 190, 180];
};

const readIsDark = () => {
  if (typeof document === 'undefined') return true;
  const root = document.documentElement;
  if (root.classList.contains('dark')) return true;
  if (root.classList.contains('light')) return false;
  return getComputedStyle(root).colorScheme !== 'light';
};

const buildPalette = (accent: Rgb, isDark: boolean): PixelPalette => {
  const white: Rgb = [255, 255, 255];
  if (isDark) {
    // Keep the field inside one hue band so cells read as a surface, not a checkerboard.
    const night: Rgb = [26, 27, 30];
    return {
      left: mixRgb(accent, night, 0.86),
      highlight: mixRgb(accent, white, 0.55),
      peak: mixRgb(accent, white, 0.78),
      alphaBase: 0.5,
      tones: [
        mixRgb(accent, night, 0.6),
        mixRgb(accent, night, 0.45),
        mixRgb(accent, night, 0.3),
        mixRgb(accent, night, 0.15),
        accent,
        mixRgb(accent, white, 0.1),
        mixRgb(accent, white, 0.2),
        mixRgb(accent, white, 0.3),
        mixRgb(accent, white, 0.42),
        mixRgb(accent, white, 0.55),
      ],
    };
  }
  return {
    left: mixRgb(accent, white, 0.86),
    highlight: mixRgb(accent, white, 0.78),
    peak: mixRgb(accent, white, 0.9),
    alphaBase: 0.62,
    tones: [
      mixRgb(accent, white, 0.06),
      mixRgb(accent, white, 0.16),
      mixRgb(accent, white, 0.26),
      mixRgb(accent, white, 0.36),
      mixRgb(accent, white, 0.46),
      mixRgb(accent, white, 0.56),
      mixRgb(accent, white, 0.66),
      mixRgb(accent, white, 0.74),
      mixRgb(accent, white, 0.82),
      mixRgb(accent, white, 0.88),
    ],
  };
};

/** Port of the reference pixel-field: flowing pulses on a hashed grid. */
const paintPixelField = ({
  ctx,
  width,
  height,
  reveal,
  elapsed,
  palette,
}: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  reveal: number;
  elapsed: number;
  palette: PixelPalette;
}) => {
  ctx.clearRect(0, 0, width, height);
  if (reveal <= 0.001) return;

  const frontier = 1 - reveal;
  const cell = width < 280 ? 5 : 6;
  const gap = 1.1;
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);

  const flowDuration = 4000;
  const rawFlow = elapsed / flowDuration;
  const flowCycle = Math.floor(rawFlow);
  const easedFlow = flowCycle + smoothstep(0, 1, rawFlow - flowCycle);

  ctx.save();
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(0, 0, width, height, 12);
  } else {
    ctx.rect(0, 0, width, height);
  }
  ctx.clip();

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * cell;
      const y = row * cell;
      const normalizedX = (x + cell * 0.5) / width;
      const revealAlpha = smoothstep(
        frontier - 0.1,
        frontier + 0.07,
        normalizedX,
      );
      if (revealAlpha <= 0.002) continue;

      const purpleAmount = smoothstep(0.1, 0.88, normalizedX);
      const fieldIntensity = smoothstep(0.04, 0.38, normalizedX);
      const depthBias = smoothstep(0.35, 0.95, normalizedX);

      const baseHash =
        Math.abs(Math.sin(column * 12.9898 + row * 78.233) * 43758.5453) % 1;
      const tempoHash =
        Math.abs(Math.sin(column * 7.13 + row * 19.41) * 19341.731) % 1;
      const phaseHash =
        Math.abs(Math.sin(column * 31.17 + row * 11.93) * 28437.123) % 1;
      const chromaHash =
        Math.abs(Math.sin(column * 9.47 + row * 67.13) * 15823.917) % 1;

      const period = 500 + tempoHash * 1500;
      const localTime = elapsed + phaseHash * period;
      const cycle = Math.floor(localTime / period);
      const cycleProgress = (localTime % period) / period;
      const cycleHash =
        Math.abs(
          Math.sin(column * 17.17 + row * 41.73 + cycle * 13.11) * 24634.6345,
        ) % 1;
      const widthHash =
        Math.abs(
          Math.sin(column * 5.37 + row * 29.11 + cycle * 7.43) * 17391.443,
        ) % 1;

      const pulseCenter = 0.2 + cycleHash * 0.55;
      const pulseWidth = 0.09 + widthHash * 0.08;
      const pulseDistance = (cycleProgress - pulseCenter) / pulseWidth;
      const pulseEnvelope = Math.exp(-pulseDistance * pulseDistance * 1.45);
      const activeCycle = cycleHash > 0.12 ? 1 : 0.26;
      const irregularFlicker = pulseEnvelope * activeCycle;

      const flowCoordinate = (normalizedX + easedFlow) * 9;
      const flowIndex = Math.floor(flowCoordinate);
      const flowProgress = smoothstep(0, 1, flowCoordinate - flowIndex);
      const flowHashA =
        Math.abs(Math.sin(flowIndex * 18.31 + row * 37.17) * 19283.173) % 1;
      const flowHashB =
        Math.abs(
          Math.sin((flowIndex + 1) * 18.31 + row * 37.17) * 19283.173,
        ) % 1;
      const clusterGate = smoothstep(
        0.46,
        0.84,
        mix(flowHashA, flowHashB, flowProgress),
      );
      const wavePhase =
        (normalizedX + easedFlow + row * 0.06 + baseHash * 0.02) *
        Math.PI *
        2;
      const directionalWave = Math.pow(0.5 + 0.5 * Math.cos(wavePhase), 5);
      const directionalFlow = Math.max(clusterGate, directionalWave * 0.62);
      const flowingFlicker = Math.max(
        irregularFlicker * (0.48 + directionalFlow * 0.58),
        directionalFlow * (0.38 + baseHash * 0.28),
      );

      const revealGlow =
        reveal < 0.995
          ? Math.exp(-((normalizedX - frontier) ** 2) / 0.012) *
            (1 - smoothstep(0.7, 1, reveal))
          : 0;
      const lightAmount = Math.max(
        flowingFlicker,
        revealGlow * (0.4 + baseHash * 0.4),
      );

      const peakHighlight =
        lightAmount > 0.4 &&
        irregularFlicker > 0.16 &&
        cycleHash > 0.26 &&
        clusterGate > 0.04;
      const hottestHighlight =
        lightAmount > 0.68 &&
        irregularFlicker > 0.3 &&
        cycleHash > 0.48 &&
        clusterGate > 0.12;
      const highlightAmount = peakHighlight
        ? 0.97
        : clamp(lightAmount * (0.44 + cycleHash * 0.3), 0, 0.64);

      const toneDrift =
        baseHash * 0.28 +
        depthBias * 0.28 +
        cycleProgress * 0.38 +
        easedFlow * 0.18 +
        cycleHash * 0.2 +
        Math.sin(elapsed * 0.00135 + phaseHash * Math.PI * 2) * 0.14;
      const tonePosition = (((toneDrift % 1) + 1) % 1) * palette.tones.length;
      const toneIndex = Math.floor(tonePosition);
      const toneMix = tonePosition - toneIndex;
      const toneA = palette.tones[toneIndex % palette.tones.length];
      const toneB = palette.tones[(toneIndex + 1) % palette.tones.length];
      const cellTone: Rgb = [
        mix(toneA[0], toneB[0], toneMix),
        mix(toneA[1], toneB[1], toneMix),
        mix(toneA[2], toneB[2], toneMix),
      ];

      const chromaNudge = (chromaHash - 0.5) * 10 + depthBias * 12;
      const variedTone: Rgb = [
        clamp(cellTone[0] + chromaNudge * 0.35 - depthBias * 8, 0, 255),
        clamp(cellTone[1] - depthBias * 16 + (baseHash - 0.5) * 8, 0, 255),
        clamp(cellTone[2] + depthBias * 6 + (cycleHash - 0.5) * 6, 0, 255),
      ];
      const baseColor: Rgb = [
        mix(palette.left[0], variedTone[0], purpleAmount),
        mix(palette.left[1], variedTone[1], purpleAmount),
        mix(palette.left[2], variedTone[2], purpleAmount),
      ];
      const color = hottestHighlight
        ? mixRgb(baseColor, palette.peak, 0.95)
        : mixRgb(baseColor, palette.highlight, highlightAmount);

      const baseOpacity = palette.alphaBase + baseHash * 0.2;
      ctx.globalAlpha =
        peakHighlight || hottestHighlight
          ? revealAlpha * fieldIntensity * 0.92
          : revealAlpha *
            fieldIntensity *
            clamp(baseOpacity + flowingFlicker * 0.12, 0, 1);
      ctx.fillStyle = rgbCss(color);
      ctx.fillRect(x + gap * 0.5, y + gap * 0.5, cell - gap, cell - gap);
    }
  }

  ctx.restore();
  ctx.globalAlpha = 1;
};

const EffortSlider: React.FC<EffortSliderProps> = ({
  value,
  onChange,
  disabled = false,
  testId,
  className,
}) => {
  const { t } = useTranslation();

  const levels = React.useMemo(
    () => [
      { value: '0', label: t('chat.thinkingLevelNone'), description: t('chat.thinkingLevelNoneDescription') },
      {
        value: '1',
        label: t('chat.thinkingLevelLow'),
        description: t('chat.thinkingLevelLowDescription'),
      },
      {
        value: '2',
        label: t('chat.thinkingLevelMedium'),
        description: t('chat.thinkingLevelMediumDescription'),
      },
      {
        value: '3',
        label: t('chat.thinkingLevelHigh'),
        description: t('chat.thinkingLevelHighDescription'),
      },
      {
        value: '4',
        label: t('chat.thinkingLevelUltra'),
        description: t('chat.thinkingLevelUltraDescription'),
      },
    ],
    [t],
  );

  const maxIndex = levels.length - 1;
  const indexFromValue = Math.min(maxIndex, Math.max(0, Number(value) || 0));

  const [open, setOpen] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [position, setPosition] = React.useState(indexFromValue);
  const [panelRect, setPanelRect] = React.useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const ultraStartedAtRef = React.useRef(0);
  const ultraRef = React.useRef(false);
  const positionRef = React.useRef(indexFromValue);
  const indexRef = React.useRef(indexFromValue);

  ultraRef.current = Math.round(position) === maxIndex;

  React.useEffect(() => {
    if (!dragging) {
      positionRef.current = indexFromValue;
      indexRef.current = indexFromValue;
      setPosition(indexFromValue);
    }
  }, [dragging, indexFromValue]);

  const measure = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPanelRect({
      left: Math.min(
        Math.max(8, rect.left),
        Math.max(8, window.innerWidth - PANEL_WIDTH - 8),
      ),
      top: rect.top,
      width: PANEL_WIDTH,
    });
  }, []);

  React.useEffect(() => {
    if (!open) return;

    measure();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (panelRef.current?.contains(target) || triggerRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, measure]);

  const commit = React.useCallback(
    (next: number) => {
      const clamped = Math.min(maxIndex, Math.max(0, next));
      positionRef.current = clamped;
      setPosition(clamped);
      const nextIndex = Math.round(clamped);
      if (nextIndex !== indexRef.current) {
        indexRef.current = nextIndex;
        onChange(levels[nextIndex].value);
      }
    },
    [levels, maxIndex, onChange],
  );

  const positionFromClientX = React.useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return positionRef.current;
      const rect = el.getBoundingClientRect();
      const usable = Math.max(1, rect.width - THUMB_WIDTH);
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left - THUMB_WIDTH / 2) / usable));
      const scaled = ratio * maxIndex;
      const nearest = Math.round(scaled);
      const delta = scaled - nearest;
      // Magnet: ease into a stop when the pointer is close to one.
      return Math.abs(delta) < MAGNET_RANGE
        ? nearest + delta * MAGNET_STRENGTH
        : scaled;
    },
    [maxIndex],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    trackRef.current?.focus();
    setDragging(true);
    commit(positionFromClientX(event.clientX));
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    commit(positionFromClientX(event.clientX));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // pointer capture may already be gone
    }
    const snapped = Math.round(positionRef.current);
    positionRef.current = snapped;
    setPosition(snapped);
    if (snapped !== indexRef.current) {
      indexRef.current = snapped;
      onChange(levels[snapped].value);
    }
  };

  const stepTo = (next: number) => {
    if (disabled) return;
    const clamped = Math.min(maxIndex, Math.max(0, next));
    positionRef.current = clamped;
    setPosition(clamped);
    if (clamped !== indexRef.current) {
      indexRef.current = clamped;
      onChange(levels[clamped].value);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        event.preventDefault();
        stepTo(indexFromValue - 1);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        event.preventDefault();
        stepTo(indexFromValue + 1);
        break;
      case 'Home':
        event.preventDefault();
        stepTo(0);
        break;
      case 'End':
        event.preventDefault();
        stepTo(maxIndex);
        break;
      default:
        break;
    }
  };

  const panelReady = Boolean(panelRect);

  React.useEffect(() => {
    if (!open || !panelReady) return;
    const canvas = canvasRef.current;
    const track = trackRef.current;
    if (!canvas || !track) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const palette = buildPalette(readAccent(), readIsDark());
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let lastPaint = 0;
    let ratio = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = track.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      const nextWidth = Math.round(rect.width * ratio);
      const nextHeight = Math.round(rect.height * ratio);
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
    };

    const paint = (time: number) => {
      if (!width || !height) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (!ultraRef.current) {
        ctx.clearRect(0, 0, width, height);
        ultraStartedAtRef.current = 0;
        return;
      }
      if (!ultraStartedAtRef.current) ultraStartedAtRef.current = time;
      const elapsed = time - ultraStartedAtRef.current;
      const reveal = reduced
        ? 1
        : smoothstep(0, 1, elapsed / PIXEL_REVEAL_MS);
      paintPixelField({ ctx, width, height, reveal, elapsed, palette });
    };

    resize();
    paint(performance.now());

    const loop = (time: number) => {
      if (time - lastPaint >= 33) {
        lastPaint = time;
        paint(time);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const observer = new ResizeObserver(resize);
    observer.observe(track);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      ultraStartedAtRef.current = 0;
    };
  }, [open, panelReady]);

  const displayIndex = Math.min(maxIndex, Math.max(0, Math.round(position)));
  const progress = maxIndex === 0 ? 0 : (position / maxIndex) * 100;
  const isMax = displayIndex === maxIndex;
  const transitionStyle: React.CSSProperties = {
    transitionDuration: dragging ? '0ms' : '260ms',
    transitionTimingFunction: 'cubic-bezier(0.34, 1.36, 0.64, 1)',
  };

  return (
    <div className={cn('relative flex h-8 items-center', className)}>
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('chat.effort')}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
        className={cn(
          'flex h-8 shrink-0 items-center gap-1 rounded-full border border-transparent px-1.5 text-xs text-text-secondary',
          'transition-colors duration-200 hover:bg-bg-card hover:text-text-primary',
          open && 'bg-bg-card text-text-primary',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <BrainCog className="size-4 shrink-0" />
        <span className="whitespace-nowrap">{levels[indexFromValue].label}</span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-text-disabled transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open &&
        panelRect &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={t('chat.effort')}
            data-testid={testId ? `${testId}-panel` : undefined}
            style={{
              left: panelRect.left,
              top: panelRect.top,
              width: panelRect.width,
              transform: 'translateY(calc(-100% - 10px))',
            }}
            className="fixed z-50 animate-in rounded-2xl border border-border-button bg-bg-component p-3.5 shadow-lg fade-in-0 slide-in-from-bottom-1 duration-150"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 text-xs font-medium text-text-secondary">
                <span>{t('chat.effort')}</span>
                <span className="group relative flex items-center">
                  <Info className="size-3.5 shrink-0 cursor-help text-text-disabled" />
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden w-56 -translate-x-1/2 rounded-lg border border-border-button bg-bg-component p-2 text-[11px] font-normal leading-relaxed text-text-secondary shadow-md group-hover:block">
                    {t('chat.effortTip')}
                  </span>
                </span>
              </div>
              <div className="relative h-5 w-20 shrink-0 overflow-hidden text-right">
                {levels.map((level, index) => (
                  <span
                    key={level.value}
                    aria-hidden
                    className={cn(
                      'absolute inset-0 text-xs font-semibold text-text-primary transition-all duration-200',
                      index === displayIndex
                        ? 'translate-y-0 opacity-100 blur-0'
                        : index < displayIndex
                          ? '-translate-y-2 opacity-0 blur-[1px]'
                          : 'translate-y-2 opacity-0 blur-[1px]',
                    )}
                  >
                    {level.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-[10px] text-text-disabled">
              <span>{t('chat.effortFaster')}</span>
              <span>{t('chat.effortSmarter')}</span>
            </div>

            <div
              ref={trackRef}
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-valuemin={0}
              aria-valuemax={maxIndex}
              aria-valuenow={displayIndex}
              aria-valuetext={levels[displayIndex].label}
              aria-label={t('chat.effort')}
              data-testid={testId ? `${testId}-track` : undefined}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={handleKeyDown}
              className={cn(
                'relative mt-1 h-10 touch-none select-none rounded-xl bg-bg-input outline-none',
                'transition-shadow duration-200 focus-visible:ring-2 focus-visible:ring-accent-primary/40',
                disabled ? 'cursor-not-allowed opacity-60' : dragging ? 'cursor-grabbing' : 'cursor-pointer',
              )}
            >
              <div
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-r from-accent-primary/5 via-accent-primary/15 to-accent-primary/35 transition-opacity duration-300',
                  isMax ? 'opacity-100' : 'opacity-0',
                )}
              />
              <canvas
                ref={canvasRef}
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-0 h-full w-full rounded-xl transition-opacity duration-300',
                  isMax ? 'opacity-100' : 'opacity-0',
                )}
              />
              <div className="absolute inset-y-0 left-3 right-3">
                <div
                  style={{ width: `${progress}%`, ...transitionStyle }}
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent-primary/10 via-accent-primary/20 transition-[width,opacity]',
                    isMax ? 'to-accent-primary/55 opacity-0' : 'to-accent-primary/35 opacity-100',
                  )}
                />
                {levels.map((level, index) => (
                  <span
                    key={level.value}
                    aria-hidden
                    style={{ left: `${maxIndex === 0 ? 0 : (index / maxIndex) * 100}%` }}
                    className={cn(
                      'absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-200',
                      index <= displayIndex ? 'bg-accent-primary/60' : 'bg-text-disabled',
                      isMax ? 'opacity-0' : index <= displayIndex ? 'opacity-100' : 'opacity-40',
                    )}
                  />
                ))}
                <div
                  style={{ left: `${progress}%`, ...transitionStyle }}
                  className={cn(
                    'pointer-events-none absolute top-1/2 z-10 flex h-[26px] w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg border bg-bg-component transition-[left,border-color,box-shadow]',
                    isMax ? 'border-accent-primary/60' : 'border-border-default',
                    dragging ? 'shadow-lg' : 'shadow-md',
                  )}
                >
                  <span
                    className={cn(
                      'h-3.5 w-0.5 rounded-full transition-colors duration-200',
                      isMax ? 'bg-accent-primary' : 'bg-text-disabled',
                    )}
                  />
                </div>
              </div>
            </div>

            <div className="relative mx-3 mt-1.5 h-3.5">
              {levels.map((level, index) => (
                <span
                  key={level.value}
                  aria-hidden
                  style={{ left: `${maxIndex === 0 ? 0 : (index / maxIndex) * 100}%` }}
                  className={cn(
                    'absolute top-0 whitespace-nowrap text-[10px] transition-colors duration-200',
                    index === 0
                      ? 'translate-x-0'
                      : index === maxIndex
                        ? '-translate-x-full'
                        : '-translate-x-1/2',
                    index === displayIndex
                      ? 'font-medium text-text-primary'
                      : 'text-text-disabled',
                  )}
                >
                  {level.label}
                </span>
              ))}
            </div>

            <p className="mt-2 min-h-[15px] text-[11px] leading-relaxed text-text-secondary">
              {levels[displayIndex].description}
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
};

export { EffortSlider };
export default EffortSlider;
