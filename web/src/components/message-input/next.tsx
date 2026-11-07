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

import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadItemProgress,
  FileUploadList,
  FileUploadTrigger,
  type FileUploadProps,
} from '@/components/file-upload';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowUp, Globe, Paperclip, Square, Upload, X } from 'lucide-react';
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import storage from '@/utils/authorization-util';
import { AudioButton } from '../ui/audio-button';
import { EffortSlider } from '../effort-slider';

const ComposerDivider = () => (
  <div
    aria-hidden
    className="mx-0.5 h-5 w-px shrink-0 rounded-full bg-gradient-to-b from-transparent via-border-default to-transparent"
  />
);

export type NextMessageInputOnPressEnterParameter = {
  enableThinking?: string;
  enableInternet?: boolean;
  storeHistoryMessages?: boolean;
  omitSessionId?: boolean;
};

interface NextMessageInputProps {
  disabled: boolean;
  value: string;
  sendDisabled: boolean;
  sendLoading: boolean;
  conversationId: string;
  uploadMethod?: string;
  isShared?: boolean;
  showUploadIcon?: boolean;
  isUploading?: boolean;
  onPressEnter({
    enableThinking,
    enableInternet,
  }: NextMessageInputOnPressEnterParameter): void;
  onInputChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  createConversationBeforeUploadDocument?(message: string): Promise<any>;
  stopOutputMessage?(): void;
  onUpload?: NonNullable<FileUploadProps['onUpload']>;
  removeFile?(file: File): void;
  showReasoning?: boolean;
  showInternet?: boolean;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
}

export function NextMessageInput({
  isUploading = false,
  value,
  sendDisabled,
  sendLoading,
  disabled,
  showUploadIcon = true,
  resize = 'none',
  onUpload,
  onInputChange,
  stopOutputMessage,
  onPressEnter,
  removeFile,
  showReasoning = false,
  showInternet = false,
}: NextMessageInputProps) {
  const { t } = useTranslation();
  const [files, setFiles] = React.useState<File[]>([]);
  const [audioInputValue, setAudioInputValue] = React.useState<string | null>(
    null,
  );

  const [enableThinking, setEnableThinking] = useState(() =>
    storage.getThinkingLevel(),
  );
  const [enableInternet, setEnableInternet] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isManualMode, setIsManualMode] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragStartRef = useRef({ startY: 0, startHeight: 0 });

  const handleResizeStart = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const textarea = textareaRef.current;
      if (!textarea) return;
      dragStartRef.current = {
        startY: e.clientY,
        startHeight: textarea.getBoundingClientRect().height,
      };
      setIsManualMode(true);
      setIsResizing(true);
    },
    [],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const { startY, startHeight } = dragStartRef.current;
      const delta = startY - e.clientY;
      const newHeight = Math.max(40, Math.min(startHeight + delta, 400));
      textarea.style.height = `${newHeight}px`;
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const handleThinkingChange = useCallback((value: string) => {
    setEnableThinking(value);
    storage.setThinkingLevel(value);
  }, []);

  const handleInternetToggle = useCallback(() => {
    setEnableInternet((prev) => !prev);
  }, []);

  const pressEnter = useCallback(() => {
    onPressEnter({
      enableThinking,
      enableInternet: showInternet ? enableInternet : false,
    });
  }, [onPressEnter, enableThinking, enableInternet, showInternet]);

  useEffect(() => {
    if (audioInputValue !== null) {
      onInputChange({
        target: { value: audioInputValue },
      } as React.ChangeEvent<HTMLTextAreaElement>);

      setTimeout(() => {
        pressEnter();
        setAudioInputValue(null);
      }, 0);
    }
  }, [
    audioInputValue,
    onInputChange,
    onPressEnter,
    enableThinking,
    enableInternet,
    showInternet,
    pressEnter,
  ]);

  const onFileReject = React.useCallback((file: File, message: string) => {
    toast(message, {
      description: `"${file.name.length > 20 ? `${file.name.slice(0, 20)}...` : file.name}" has been rejected`,
    });
  }, []);

  const submit = React.useCallback(() => {
    // Mirror the send button's disabled condition so pressing Enter with an
    // empty message does nothing — previously it cleared the uploaded file
    // list without sending anything.
    if (sendDisabled || isUploading || sendLoading || !value.trim()) return;
    pressEnter();
    setFiles([]);
  }, [sendDisabled, isUploading, sendLoading, value, pressEnter]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      submit();
    },
    [submit],
  );

  const handleRemoveFile = React.useCallback(
    (file: File) => () => {
      removeFile?.(file);
    },
    [removeFile],
  );

  return (
    <FileUpload
      value={files}
      onValueChange={setFiles}
      onUpload={onUpload}
      onFileReject={onFileReject}
      className="relative w-full items-center"
      disabled={isUploading || disabled}
    >
      <FileUploadDropzone
        tabIndex={-1}
        // Prevents the dropzone from triggering on click
        onClick={(event) => event.preventDefault()}
        className="absolute top-0 left-0 z-0 flex size-full items-center justify-center rounded-none border-none bg-background/50 p-0 opacity-0 backdrop-blur transition-opacity duration-200 ease-out data-[dragging]:z-10 data-[dragging]:opacity-100"
      >
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="flex items-center justify-center rounded-full border p-2.5">
            <Upload className="size-6 text-muted-foreground" />
          </div>
          <p className="font-medium text-sm">{t('common.dragDropFiles')}</p>
          <p className="text-muted-foreground text-xs">
            {t('common.uploadMaxFiles')}
          </p>
        </div>
      </FileUploadDropzone>

      <form
        onSubmit={onSubmit}
        className="
          group/composer relative flex w-full flex-col gap-2 rounded-3xl
          border border-border-button bg-bg-component p-2.5 shadow-md
          transition-all duration-300 outline-none
          focus-within:border-accent-primary/60 focus-within:shadow-lg
        "
      >
        {resize === 'vertical' && (
          <button
            type="button"
            onMouseDown={handleResizeStart}
            aria-label={t('common.dragToResize')}
            className="absolute -top-1 left-1/2 z-10 flex h-2.5 w-12 -translate-x-1/2 cursor-ns-resize items-center justify-center rounded-full opacity-0 transition-opacity duration-200 group-hover/composer:opacity-100"
          >
            <span className="h-1 w-10 rounded-full bg-border-default" />
          </button>
        )}
        <FileUploadList
          orientation="horizontal"
          className="gap-2 overflow-x-auto px-0.5 py-1"
        >
          {files.map((file, index) => (
            <FileUploadItem
              key={index}
              value={file}
              className="max-w-52 rounded-2xl border border-border-button bg-bg-card/60 p-1.5"
            >
              <FileUploadItemPreview className="size-9 overflow-hidden rounded-lg [&>svg]:size-5">
                <FileUploadItemProgress variant="fill" />
              </FileUploadItemPreview>
              <FileUploadItemMetadata size="sm" />
              <FileUploadItemDelete asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  className="-top-1 -right-1 absolute size-4 shrink-0 cursor-pointer rounded-full"
                  onClick={handleRemoveFile(file)}
                >
                  <X className="size-2.5" />
                </Button>
              </FileUploadItemDelete>
            </FileUploadItem>
          ))}
        </FileUploadList>
        <Textarea
          ref={textareaRef}
          data-testid="chat-textarea"
          value={value}
          onChange={onInputChange}
          placeholder={t('chat.messagePlaceholder')}
          className="
            !min-h-[44px] max-h-[400px] w-full resize-none overflow-auto
            border-0 bg-transparent px-1.5 py-1 text-base leading-relaxed md:text-base
            !outline-none !shadow-none !ring-0 !ring-offset-0
            placeholder:text-text-disabled
          "
          disabled={isUploading || disabled || sendLoading}
          onKeyDown={handleKeyDown}
          resize={resize === 'vertical' ? 'none' : resize}
          autoSize={isManualMode ? undefined : { minRows: 1, maxRows: 8 }}
        />

        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            {showUploadIcon && (
              <FileUploadTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="shrink-0 rounded-full text-text-secondary hover:bg-bg-card hover:text-text-primary"
                  disabled={isUploading || sendLoading}
                  data-testid="chat-detail-attach"
                >
                  <Paperclip className="size-4" />
                  <span className="sr-only">{t('common.attachFile')}</span>
                </Button>
              </FileUploadTrigger>
            )}

            {showReasoning && (
              <EffortSlider
                value={enableThinking}
                onChange={handleThinkingChange}
                disabled={isUploading || sendLoading}
                testId="chat-detail-thinking-toggle"
              />
            )}

            {showInternet && (
              <>
                <ComposerDivider />
                <button
                  type="button"
                  onClick={handleInternetToggle}
                  aria-pressed={enableInternet}
                  data-testid="chat-detail-internet-toggle"
                  className={cn(
                    'flex h-8 shrink-0 items-center gap-1 rounded-full border px-2 text-xs transition-all duration-200',
                    enableInternet
                      ? 'border-accent-primary/40 bg-accent-primary/10 text-accent-primary'
                      : 'border-transparent text-text-secondary hover:bg-bg-card hover:text-text-primary',
                  )}
                >
                  <Globe className="size-4 shrink-0" />
                  <span
                    className={cn(
                      'grid overflow-hidden transition-all duration-200',
                      enableInternet
                        ? 'grid-cols-[1fr] opacity-100'
                        : 'grid-cols-[0fr] opacity-0',
                    )}
                  >
                    <span className="overflow-hidden whitespace-nowrap text-left">
                      {t('chat.internetSearch')}
                    </span>
                  </span>
                </button>
              </>
            )}
          </div>

          {sendLoading ? (
            <Button
              data-testid="chat-stream-status"
              onClick={stopOutputMessage}
              size="icon"
              className="shrink-0 rounded-full"
            >
              <Square className="size-3.5 fill-current" />
              <span className="sr-only">{t('common.stop')}</span>
            </Button>
          ) : (
            <div className="flex shrink-0 items-center gap-1">
              <AudioButton
                onOk={(value) => {
                  setAudioInputValue(value);
                }}
                testId="chat-detail-audio-toggle"
              />

              <Button
                size="icon"
                className="rounded-full"
                disabled={
                  sendDisabled || isUploading || sendLoading || !value.trim()
                }
                data-testid="chat-detail-send"
              >
                <ArrowUp className="size-4" />
                <span className="sr-only">{t('common.sendMessage')}</span>
              </Button>
            </div>
          )}
        </div>
      </form>
    </FileUpload>
  );
}
