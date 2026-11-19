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

import { RAGFlowSelect } from '@/components/ui/select';
import { prefixName } from '@/utils/form';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './ui/form';

export const MemoryMode = {
  Auto: 'auto',
  Work: 'work',
  Chat: 'chat',
  Off: 'off',
} as const;

export type MemoryModeType = (typeof MemoryMode)[keyof typeof MemoryMode];

interface MemoryModeFormFieldProps {
  prefix?: string;
}

/**
 * Selects which long-term memory backend this assistant talks to.
 *
 * work -> the built-in Hindsight engine, one bank per project (fact extraction
 * costs LLM tokens), chat -> self-hosted Mem0, auto lets the backend infer from
 * the assistant, off disables recall and write-back. Work is never inferred:
 * it must be selected explicitly. The RAGFlow memory library keeps working
 * regardless of this setting.
 */
export function MemoryModeFormField({ prefix = '' }: MemoryModeFormFieldProps) {
  const form = useFormContext();
  const { t } = useTranslation();

  const options = [
    { label: t('chat.memoryModeAuto'), value: MemoryMode.Auto },
    { label: t('chat.memoryModeWork'), value: MemoryMode.Work },
    { label: t('chat.memoryModeChat'), value: MemoryMode.Chat },
    { label: t('chat.memoryModeOff'), value: MemoryMode.Off },
  ];

  return (
    <FormField
      control={form.control}
      name={prefixName(prefix, 'prompt_config.memory_mode')}
      render={({ field }) => (
        <FormItem>
          <FormLabel tooltip={t('chat.memoryModeTip')}>
            {t('chat.memoryMode')}
          </FormLabel>
          <FormControl>
            <RAGFlowSelect
              {...field}
              value={field.value ?? MemoryMode.Auto}
              options={options}
              triggerTestId="memory-mode"
              optionTestIdPrefix="memory-mode-option"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
