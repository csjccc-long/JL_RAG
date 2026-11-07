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

import { useTranslate } from '@/hooks/common-hooks';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyToClipboard as Clipboard } from 'react-copy-to-clipboard';
import type { ButtonProps } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

const COPY_RESET_MS = 2000;

// Clipboard glyphs from Uiverse.io (by catraco); the copy control swaps them
// with the pop-in "fill" animation on every copy.
const CLIPBOARD_PATH =
  'M280 64h40c35.3 0 64 28.7 64 64V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V128C0 92.7 28.7 64 64 64h40 9.6C121 27.5 153.3 0 192 0s71 27.5 78.4 64H280zM64 112c-8.8 0-16 7.2-16 16V448c0 8.8 7.2 16 16 16H320c8.8 0 16-7.2 16-16V128c0-8.8-7.2-16-16-16H304v24c0 13.3-10.7 24-24 24H192 104c-13.3 0-24-10.7-24-24V112H64zm128-8a24 24 0 1 0 0-48 24 24 0 1 0 0 48z';
const CLIPBOARD_CHECK_PATH =
  'M192 0c-41.8 0-77.4 26.7-90.5 64H64C28.7 64 0 92.7 0 128V448c0 35.3 28.7 64 64 64H320c35.3 0 64-28.7 64-64V128c0-35.3-28.7-64-64-64H282.5C269.4 26.7 233.8 0 192 0zm0 64a32 32 0 1 1 0 64 32 32 0 1 1 0-64zM305 273L177 401c-9.4 9.4-24.6 9.4-33.9 0L79 337c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l47 47L271 239c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9z';

interface CopyToClipboardProps {
  text: string;
  className?: string;
  /** Kept for call-site compatibility; the control has a fixed icon size. */
  size?: ButtonProps['size'];
  /** Kept for call-site compatibility; the control is no longer a Button. */
  avoidButtonWrapper?: boolean;
  testId?: string;
}

const CopyToClipboard = ({
  text,
  className,
  testId = 'copy-to-clipboard',
}: CopyToClipboardProps) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useTranslate('common');

  const handleCopy = useCallback(() => {
    setCopied(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setCopied(false);
      timerRef.current = null;
    }, COPY_RESET_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <Tooltip open={copied ? true : undefined}>
      <Clipboard text={text} onCopy={handleCopy}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={copied ? t('copied') : t('copy')}
            data-testid={testId}
            className={cn(
              'relative inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md fill-text-secondary transition-colors hover:fill-text-primary focus-visible:fill-text-primary focus-visible:outline-none',
              copied && 'fill-text-primary',
              className,
            )}
          >
            <svg
              key={copied ? 'check' : 'clipboard'}
              viewBox="0 0 384 512"
              aria-hidden="true"
              className="h-4 w-auto animate-copy-fill"
            >
              <path
                d={copied ? CLIPBOARD_CHECK_PATH : CLIPBOARD_PATH}
              ></path>
            </svg>
          </button>
        </TooltipTrigger>
      </Clipboard>
      <TooltipContent>{copied ? t('copied') : t('copy')}</TooltipContent>
    </Tooltip>
  );
};

export default CopyToClipboard;

export function CopyToClipboardWithText({ text }: { text: string }) {
  return (
    <div className="bg-bg-card p-1 rounded-md flex gap-2">
      <span className="flex-1 truncate">{text}</span>
      <CopyToClipboard text={text}></CopyToClipboard>
    </div>
  );
}
