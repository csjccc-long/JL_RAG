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

/**
 * Prompt-style search input.
 *
 * A collapsed pill that morphs into a card on focus: the card grows a bottom
 * row of chips (summary model + effort) and a submit button, borrowing the
 * spring curve from the reference component. Everything is themed with the
 * app's own tokens instead of the shadcn palette the reference used.
 */

import { LlmIcon } from '@/components/svg-icon';
import { useAutoResizeTextarea } from '@/hooks/use-auto-resize-textarea';
import { useFetchAllAddedModels } from '@/hooks/use-llm-request';
import { IAddedModel } from '@/interfaces/database/llm';
import { cn } from '@/lib/utils';
import { getRealModelName } from '@/utils/llm-util';
import { Check, ChevronDown, Search, Sparkles, Square, X } from 'lucide-react';
import {
  ChangeEvent,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

export const SPRING_TRANSITION =
  'max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';

// ---------------------------------------------------------------------------
// Effort presets (shared by the settings drawer and the search input)
// ---------------------------------------------------------------------------

export type EffortLevel = 'low' | 'medium' | 'max';

export interface EffortParameters {
  temperature: number;
  top_p: number;
  presence_penalty: number;
  frequency_penalty: number;
}

export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'max'];

export const EFFORT_PRESETS: Record<EffortLevel, EffortParameters> = {
  low: {
    temperature: 0.1,
    top_p: 0.3,
    presence_penalty: 0.4,
    frequency_penalty: 0.7,
  },
  medium: {
    temperature: 0.5,
    top_p: 0.8,
    presence_penalty: 0.2,
    frequency_penalty: 0.3,
  },
  max: {
    temperature: 0.9,
    top_p: 0.98,
    presence_penalty: 0,
    frequency_penalty: 0,
  },
};

const EFFORT_LABEL_KEYS: Record<EffortLevel, string> = {
  low: 'search.effortLow',
  medium: 'search.effortMedium',
  max: 'search.effortMax',
};

export function getEffortPreset(level: EffortLevel): EffortParameters {
  return EFFORT_PRESETS[level] ?? EFFORT_PRESETS.medium;
}

/** Map a stored llm_setting back onto the nearest effort level. */
export function deriveEffortLevel(setting?: {
  temperature?: number | null;
}): EffortLevel {
  const temperature = Number(setting?.temperature ?? 0.1);
  if (temperature <= 0.28) return 'low';
  if (temperature <= 0.72) return 'medium';
  return 'max';
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/** Animates its own width while the text swaps, so chips never jump. */
function MorphingText({ text }: { text: string }) {
  const [width, setWidth] = useState<number>();
  const spanRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (spanRef.current) {
      setWidth(spanRef.current.offsetWidth);
    }
  }, [text]);

  return (
    <span
      className="relative inline-flex max-w-[9rem] items-center justify-center overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
      style={{ width }}
    >
      <span
        ref={spanRef}
        className="invisible max-w-[9rem] truncate whitespace-nowrap px-0.5"
      >
        {text}
      </span>
      <span
        key={text}
        className="animate-in fade-in zoom-in-95 absolute inset-0 flex items-center justify-center truncate whitespace-nowrap duration-200"
      >
        {text}
      </span>
    </span>
  );
}

function EffortIcon({ level }: { level: EffortLevel }) {
  const isMediumOrHigh = level === 'medium' || level === 'max';
  const isHigh = level === 'max';

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="1.5" y="8" width="2.5" height="4.5" rx="1" fill="currentColor" />
      <rect
        x="5.75"
        y="5"
        width="2.5"
        height="7.5"
        rx="1"
        fill="currentColor"
        className="transition-opacity duration-300"
        opacity={isMediumOrHigh ? 1 : 0.3}
      />
      <rect
        x="10"
        y="2"
        width="2.5"
        height="10.5"
        rx="1"
        fill="currentColor"
        className="transition-opacity duration-300"
        opacity={isHigh ? 1 : 0.3}
      />
    </svg>
  );
}

const chipClass =
  'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-text-secondary outline-none transition-colors duration-200 hover:bg-bg-component hover:text-text-primary disabled:pointer-events-none disabled:opacity-50';

function modelOptionValue(model: IAddedModel) {
  return (
    model.model_id ||
    `${getRealModelName(model.name)}@${model.instance_name}@${model.provider_name}`
  );
}

// ---------------------------------------------------------------------------
// Model chip
// ---------------------------------------------------------------------------

export function ModelChipSelect({
  value,
  onChange,
  disabled,
  align = 'left',
  className,
  triggerClassName,
}: {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  align?: 'left' | 'right';
  className?: string;
  triggerClassName?: string;
}) {
  const { t } = useTranslation();
  const { data: allModels, loading } = useFetchAllAddedModels();
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(true);
  const [hovered, setHovered] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const models = useMemo(
    () =>
      allModels.filter(
        (model) => model.model_type?.includes('chat') && model.name,
      ),
    [allModels],
  );

  const selected = useMemo(
    () => models.find((model) => modelOptionValue(model) === value),
    [models, value],
  );

  const selectedIndex = selected
    ? models.findIndex((model) => modelOptionValue(model) === value)
    : -1;

  const label = selected
    ? getRealModelName(selected.name)
    : value
      ? (value.split('@')[0] ?? value)
      : t('chat.model');

  useEffect(() => {
    if (!open) return;
    setHovered(selectedIndex);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const toggle = useCallback(() => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    // Drop the panel on whichever side of the chip has room for it.
    if (!rect) {
      setOpenUp(true);
    } else {
      const need = Math.min(Math.max(models.length, 1), 6) * 38 + 16;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUp(spaceBelow < need && spaceAbove > spaceBelow);
    }
    setOpen((prev) => !prev);
  }, [disabled]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
        className={cn(
          chipClass,
          triggerClassName,
          open && 'bg-bg-component text-text-primary',
        )}
        aria-label={t('chat.model')}
        aria-expanded={open}
      >
        <LlmIcon
          name={selected?.provider_name ?? ''}
          width={16}
          height={16}
          imgClass="size-4 flex-shrink-0 opacity-80"
        />
        <MorphingText text={label} />
        <ChevronDown
          size={12}
          className={cn(
            'ml-auto flex-shrink-0 opacity-60 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      <div
        role="listbox"
        className={cn(
          'absolute z-50 w-60 rounded-xl border border-border-button bg-bg-card p-1 shadow-[0_16px_40px_rgba(0,0,0,0.35)] transition-all duration-200',
          open
            ? 'pointer-events-auto translate-y-0 scale-100 opacity-100'
            : 'pointer-events-none scale-95 opacity-0',
          openUp ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        <div className="relative flex max-h-[240px] flex-col gap-0.5 overflow-y-auto scrollbar-thin p-0.5">
          <div
            className="pointer-events-none absolute left-0.5 right-0.5 top-0.5 h-9 rounded-lg bg-bg-component transition-transform duration-200 ease-out"
            style={{
              transform: `translateY(${Math.max(hovered, 0) * 38}px)`,
              opacity: hovered >= 0 ? 1 : 0,
            }}
          />
          {models.length === 0 && (
            <div className="px-2 py-3 text-xs text-text-secondary">
              {loading
                ? t('common.loading')
                : t('search.noChatModel', 'No chat model available')}
            </div>
          )}
          {models.map((model, index) => {
            const optionValue = modelOptionValue(model);
            const isSelected = optionValue === value;
            return (
              <button
                key={optionValue}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHovered(index)}
                onClick={() => {
                  onChange?.(optionValue);
                  setOpen(false);
                }}
                className="relative flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-text-primary outline-none"
              >
                <LlmIcon
                  name={model.provider_name}
                  width={18}
                  height={18}
                  imgClass="size-[18px] flex-shrink-0"
                />
                <span className="truncate">{getRealModelName(model.name)}</span>
                <span className="ml-auto flex-shrink-0 truncate text-[11px] text-text-secondary">
                  {model.instance_name}
                </span>
                {isSelected && (
                  <Check size={13} className="flex-shrink-0 text-text-primary" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Effort chip
// ---------------------------------------------------------------------------

export function EffortChipSelect({
  value = 'low',
  onChange,
  disabled,
  className,
  triggerClassName,
}: {
  value?: EffortLevel;
  onChange?: (level: EffortLevel) => void;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
}) {
  const { t } = useTranslation();

  const cycle = useCallback(() => {
    const index = EFFORT_LEVELS.indexOf(value);
    const next = EFFORT_LEVELS[(index + 1) % EFFORT_LEVELS.length];
    onChange?.(next);
  }, [onChange, value]);

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={cycle}
      className={cn(chipClass, triggerClassName, className)}
      title={t('search.effort')}
    >
      <EffortIcon level={value} />
      <MorphingText text={t(EFFORT_LABEL_KEYS[value])} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Prompt input
// ---------------------------------------------------------------------------

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  /** Search is blocked (e.g. no dataset selected). */
  disabled?: boolean;
  /** A request is in flight: the action button turns into "stop". */
  loading?: boolean;
  onStop?: () => void;
  autoFocus?: boolean;
  alwaysExpanded?: boolean;
  className?: string;
  /** Chips rendered on the bottom row; hidden when omitted. */
  modelValue?: string;
  onModelChange?: (value: string) => void;
  effortValue?: EffortLevel;
  onEffortChange?: (level: EffortLevel) => void;
  chipsDisabled?: boolean;
  showChips?: boolean;
  /** AI summary switch rendered in the chip row. */
  summaryEnabled?: boolean;
  onSummaryToggle?: (enabled: boolean) => void;
  onClear?: () => void;
  extra?: ReactNode;
  testId?: string;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  loading,
  onStop,
  autoFocus,
  alwaysExpanded,
  className,
  modelValue,
  onModelChange,
  effortValue,
  onEffortChange,
  chipsDisabled,
  showChips,
  summaryEnabled,
  onSummaryToggle,
  onClear,
  extra,
  testId,
}: PromptInputProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(!!alwaysExpanded);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoResizeTextarea(textareaRef, value, 160);

  const isExpanded = alwaysExpanded || expanded;
  const chipsVisible = isExpanded && (!!showChips || !!onSummaryToggle);
  const hasValue = value.trim().length > 0;

  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    if (alwaysExpanded) {
      setExpanded(true);
    }
  }, [alwaysExpanded]);

  const submit = useCallback(() => {
    if (disabled) return;
    if (loading) return;
    if (!hasValue) return;
    onSubmit();
  }, [disabled, hasValue, loading, onSubmit]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value);
  };

  return (
    <div className={cn('relative w-full', className)}>
      <div
        className={cn(
          'relative flex w-full flex-col border bg-bg-card transition-[border-radius,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]',
          isExpanded
            ? 'rounded-3xl border-border-button shadow-[0_18px_48px_-24px_rgba(0,0,0,0.55)] focus-within:border-text-primary/40 dark:shadow-none'
            : 'cursor-text rounded-full border-border-button hover:border-text-primary/30',
          disabled && 'opacity-70',
        )}
        onMouseDown={(event) => {
          if (event.target === textareaRef.current) return;
          if (isExpanded) {
            event.preventDefault();
            textareaRef.current?.focus();
          } else {
            setExpanded(true);
            // Focus after the card has begun morphing so the caret is visible.
            requestAnimationFrame(() => textareaRef.current?.focus());
          }
        }}
        data-testid={testId}
      >
        <div className="relative flex items-start">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setExpanded(true)}
            disabled={disabled}
            placeholder={isExpanded ? placeholder : ''}
            aria-label={placeholder}
            className={cn(
              'w-full resize-none bg-transparent px-5 pt-4 pb-2 text-base leading-6 text-text-primary outline-none scrollbar-thin placeholder:text-text-secondary/70',
              isExpanded ? 'pr-14' : 'pr-14',
            )}
          />
          {!isExpanded && !!placeholder && (
            <span className="pointer-events-none absolute inset-y-0 left-5 flex items-center truncate text-base text-text-secondary/70">
              {placeholder}
            </span>
          )}

          {!isExpanded && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                setExpanded(true);
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}
              className="absolute right-2.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-text-primary text-bg-base transition-opacity hover:opacity-90"
              aria-label={placeholder}
            >
              <Search size={17} />
            </button>
          )}
        </div>

        <div
          className={cn(
            'flex items-center gap-1 px-2.5 transition-[max-height,opacity,padding] duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]',
            chipsVisible
              ? 'max-h-14 pb-2.5 pt-1 opacity-100'
              : 'max-h-0 pb-0 pt-0 opacity-0',
          )}
          aria-hidden={!chipsVisible}
        >
          {chipsVisible && (
            <>
              {onSummaryToggle && (
                <button
                  type="button"
                  disabled={chipsDisabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSummaryToggle(!summaryEnabled)}
                  aria-pressed={!!summaryEnabled}
                  data-testid="summary-toggle"
                  className={cn(
                    chipClass,
                    summaryEnabled && 'bg-bg-component text-text-primary',
                  )}
                >
                  <Sparkles size={13} className="flex-shrink-0 opacity-70" />
                  <span>{t('search.AISummary')}</span>
                  <span
                    className={cn(
                      'relative ml-0.5 inline-flex h-3.5 w-6 flex-shrink-0 items-center rounded-full transition-colors duration-200',
                      summaryEnabled
                        ? 'bg-text-primary/80'
                        : 'bg-text-secondary/30',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute size-2.5 rounded-full transition-transform duration-200',
                        summaryEnabled
                          ? 'translate-x-[12px] bg-bg-base'
                          : 'translate-x-[3px] bg-text-secondary',
                      )}
                    />
                  </span>
                </button>
              )}
              {showChips && (
                <>
                  <ModelChipSelect
                    value={modelValue}
                    onChange={onModelChange}
                    disabled={chipsDisabled}
                  />
                  <EffortChipSelect
                    value={effortValue}
                    onChange={onEffortChange}
                    disabled={chipsDisabled}
                  />
                </>
              )}
              {extra}
              <span className="flex-1" />
              {onClear && hasValue && (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onClear}
                  className="flex size-7 flex-shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-component hover:text-text-primary"
                  aria-label={t('common.clear', 'Clear')}
                >
                  <X size={15} />
                </button>
              )}
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={loading ? onStop : submit}
                disabled={loading ? false : disabled || !hasValue}
                className={cn(
                  'flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-text-primary text-bg-base transition-opacity hover:opacity-90 disabled:opacity-40',
                )}
                aria-label={loading ? t('common.stop') : placeholder}
              >
                {loading ? (
                  <Square size={11} fill="currentColor" />
                ) : (
                  <Search size={16} />
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
