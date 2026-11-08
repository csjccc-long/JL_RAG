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

import {
  deriveEffortLevel,
  EffortLevel,
  getEffortPreset,
} from '@/components/ai-prompt-input';
import message from '@/components/ui/message';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ISearchAppDetailProps,
  IUpdateSearchProps,
  useUpdateSearch,
} from '../next-searches/hooks';

/**
 * Read/write the AI-summary model + effort of a search app.
 *
 * The search request itself carries no model parameters (the server reads the
 * app configuration), so the chips on the search input persist their choice
 * back onto search_config instead of being sent with the question.
 */
export function useSummarySettings(data?: ISearchAppDetailProps) {
  const { t } = useTranslation();
  const { updateSearch } = useUpdateSearch();
  const [updating, setUpdating] = useState(false);

  const config = data?.search_config;
  // Optimistic mirrors so the chips flip as soon as they are clicked, before
  // the search detail is re-fetched by the parent.
  const [enabledState, setEnabledState] = useState(!!config?.summary);
  const [modelState, setModelState] = useState(config?.chat_id || '');
  const [effortState, setEffortState] = useState<EffortLevel>(
    deriveEffortLevel(config?.llm_setting),
  );

  useEffect(() => {
    setEnabledState(!!config?.summary);
  }, [config?.summary]);
  useEffect(() => {
    setModelState(config?.chat_id || '');
  }, [config?.chat_id]);
  useEffect(() => {
    setEffortState(deriveEffortLevel(config?.llm_setting));
  }, [config?.llm_setting]);

  const enabled = enabledState;
  const modelId = modelState;
  const effort = effortState;

  const patchConfig = useCallback(
    async (nextConfig: Record<string, unknown>) => {
      if (!data) return;
      const payload: Record<string, unknown> = {
        ...data,
        search_config: { ...data.search_config, ...nextConfig },
        search_id: data.id,
      };
      delete payload.id;
      delete payload.created_by;
      delete payload.update_time;

      setUpdating(true);
      try {
        await updateSearch(payload as unknown as IUpdateSearchProps);
      } catch (error) {
        message.error(
          t('message.error', { error: (error as Error)?.message ?? '' }),
        );
      } finally {
        setUpdating(false);
      }
    },
    [data, t, updateSearch],
  );

  const setEnabled = useCallback(
    (next: boolean) => {
      setEnabledState(next);
      return patchConfig({ summary: next });
    },
    [patchConfig],
  );

  const setModel = useCallback(
    (nextModelId: string) => {
      setModelState(nextModelId);
      return patchConfig({ chat_id: nextModelId });
    },
    [patchConfig],
  );

  const setEffort = useCallback(
    (level: EffortLevel) => {
      setEffortState(level);
      return patchConfig({
        llm_setting: {
          ...(config?.llm_setting ?? {}),
          ...getEffortPreset(level),
          parameter: 'Custom',
          temperature_enabled: true,
          top_p_enabled: true,
          presence_penalty_enabled: true,
          frequency_penalty_enabled: true,
        },
      });
    },
    [config?.llm_setting, patchConfig],
  );

  return {
    enabled,
    modelId,
    effort,
    updating,
    setEnabled,
    setModel,
    setEffort,
  };
}
