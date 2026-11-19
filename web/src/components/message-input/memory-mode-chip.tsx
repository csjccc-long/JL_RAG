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

import { RAGFlowSelect } from '@/components/ui/select';
import {
  ChatMemoryMode,
  ChatMemoryModeType,
  useChatMemoryMode,
  useChatMemoryModeStore,
} from '@/stores/chat-memory-mode';
import { BrainCircuit } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface MemoryModeChipProps {
  conversationId?: string;
  disabled?: boolean;
}

/**
 * Composer chip that switches the long-term memory backend for THIS conversation
 * only. Nothing is persisted to the assistant: the pick travels with the
 * completion request as `memory_mode` and takes precedence for that turn.
 *
 * `auto` keeps the assistant setting, so users who never touch the chip see no
 * behaviour change. Work is deliberately never inferred: it runs the Hindsight
 * engine, spends LLM quota, and has to be chosen here or in the settings.
 */
export function MemoryModeChip({
  conversationId,
  disabled = false,
}: MemoryModeChipProps) {
  const { t } = useTranslation();
  const mode = useChatMemoryMode(conversationId);
  const setMode = useChatMemoryModeStore((state) => state.setMode);

  const options = [
    { value: ChatMemoryMode.Auto, label: t('chat.memoryModeShortAuto') },
    { value: ChatMemoryMode.Work, label: t('chat.memoryModeShortWork') },
    { value: ChatMemoryMode.Chat, label: t('chat.memoryModeShortChat') },
    { value: ChatMemoryMode.Off, label: t('chat.memoryModeShortOff') },
  ].map((option) => ({
    ...option,
    label: (
      <span className="flex items-center gap-1">
        <BrainCircuit className="size-3.5 shrink-0" />
        {option.label}
      </span>
    ),
  }));

  return (
    <RAGFlowSelect
      value={mode}
      onChange={(value) =>
        setMode(conversationId, value as ChatMemoryModeType)
      }
      disabled={disabled}
      options={options}
      // Match the neighbouring toggle chips (thinking / internet) instead of
      // the full-width form field the same component renders in settings.
      triggerClassName="h-8 w-auto min-w-0 shrink-0 gap-1 rounded-full border-transparent bg-transparent px-2 text-xs text-text-secondary hover:bg-bg-card hover:text-text-primary"
      triggerTestId="chat-memory-mode"
      optionTestIdPrefix="chat-memory-mode-option"
    />
  );
}
