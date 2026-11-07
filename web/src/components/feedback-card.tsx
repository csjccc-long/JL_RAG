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

import { cn } from '@/lib/utils';
import { useState } from 'react';

export type FeedbackKind = 'like' | 'dislike';

interface FeedbackCardProps {
  kind: FeedbackKind;
  active: boolean;
  label: string;
  ariaLabel: string;
  onActivate: () => void;
  disabled?: boolean;
  testId?: string;
  className?: string;
}

const ThumbUpPath =
  'M 24.10 6.29 Q 28.34 7.56 28.00 12.00 Q 27.56 15.10 27.13 18.19 A 0.45 0.45 4.5 0 0 27.57 18.70 Q 33.16 18.79 38.75 18.75 Q 42.13 18.97 43.23 21.45 Q 43.91 22.98 43.27 26.05 Q 40.33 40.08 40.19 40.44 Q 38.85 43.75 35.50 43.75 Q 21.75 43.75 7.29 43.75 A 1.03 1.02 0.0 0 1 6.26 42.73 L 6.42 19.43 A 0.54 0.51 -89.4 0 1 6.93 18.90 L 14.74 18.79 A 2.52 2.31 11.6 0 0 16.91 17.49 L 22.04 7.17 A 1.74 1.73 21.6 0 1 24.10 6.29 Z M 21.92 14.42 Q 20.76 16.58 19.74 18.79 Q 18.74 20.93 18.72 23.43 Q 18.65 31.75 18.92 40.06 A 0.52 0.52 88.9 0 0 19.44 40.56 L 35.51 40.50 A 1.87 1.83 5.9 0 0 37.33 39.05 L 40.51 23.94 Q 40.92 22.03 38.96 21.97 L 23.95 21.57 A 0.49 0.47 2.8 0 1 23.47 21.06 Q 23.76 17.64 25.00 12.00 Q 25.58 9.36 24.28 10.12 Q 23.80 10.40 23.50 11.09 Q 22.79 12.80 21.92 14.42 Z M 15.57 22.41 A 0.62 0.62 0 0 0 14.95 21.79 L 10.01 21.79 A 0.62 0.62 0 0 0 9.39 22.41 L 9.39 40.07 A 0.62 0.62 0 0 0 10.01 40.69 L 14.95 40.69 A 0.62 0.62 0 0 0 15.57 40.07 L 15.57 22.41 Z';

/**
 * Answer feedback card, following the Uiverse.io "Liked!" checkbox:
 * a small card that inverts on hover, turns green (like) or red (dislike)
 * once picked, bounces the thumb and slides the label out of the card.
 */
export const FeedbackCard = ({
  kind,
  active,
  label,
  ariaLabel,
  onActivate,
  disabled = false,
  testId,
  className,
}: FeedbackCardProps) => {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      data-testid={testId}
      onClick={onActivate}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'inline-flex h-6 shrink-0 items-center justify-center rounded-md px-1 outline-none',
        'transition-[background-color,color,padding] duration-200 ease-in-out',
        'focus-visible:ring-2 focus-visible:ring-accent-primary/40',
        active
          ? cn(
              'pr-2 text-white',
              kind === 'like' ? 'bg-state-success' : 'bg-state-error',
            )
          : 'bg-transparent text-text-secondary hover:bg-text-primary hover:text-bg-base',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center',
          kind === 'dislike' && '-scale-y-100',
        )}
      >
        <svg
          viewBox="0 0 50 50"
          aria-hidden="true"
          className={cn(
            'size-4 fill-current transition-transform duration-500 ease-in-out',
            active
              ? 'animate-feedback-jump'
              : hovered && 'origin-bottom-left -rotate-[8deg]',
          )}
        >
          <path d={ThumbUpPath} fillOpacity="1" />
          <circle r="1.51" cy="37.5" cx="12.49" fillOpacity="1" />
        </svg>
      </span>
      <span
        className={cn(
          'overflow-hidden whitespace-nowrap text-xs font-medium',
          'transition-[max-width,opacity,margin-left] duration-300 ease-out',
          active ? 'ml-1 max-w-24 opacity-100' : 'ml-0 max-w-0 opacity-0',
        )}
      >
        {label}
      </span>
    </button>
  );
};
