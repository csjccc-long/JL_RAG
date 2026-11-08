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
interface SummaryChoice {
  enabled: boolean;
  modelId: string;
  effort: EffortLevel;
}

/**
 * The search detail prop is fetched by the page and can lag behind a chip click,
 * so the last choice made in this session is cached per app id. The home input
 * and the results input mount separately and both read this cache.
 */
const summaryChoiceCache = new Map<string, SummaryChoice>();

export function useSummarySettings(data?: ISearchAppDetailProps) {
  const { t } = useTranslation();
  const { updateSearch } = useUpdateSearch();
  const [updating, setUpdating] = useState(false);

  const config = data?.search_config;
  const cacheKey = data?.id ?? '';

  const readChoice = (): SummaryChoice => {
    const cached = summaryChoiceCache.get(cacheKey);
    if (cached) return cached;
    return {
      enabled: !!config?.summary,
      modelId: config?.chat_id || '',
      effort: deriveEffortLevel(config?.llm_setting),
    };
  };

  const [choice, setChoice] = useState<SummaryChoice>(readChoice);

  // A different app starts from its own configuration.
  useEffect(() => {
    setChoice(readChoice());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  const remember = useCallback(
    (patch: Partial<SummaryChoice>) => {
      setChoice((prev) => {
        const next = { ...prev, ...patch };
        summaryChoiceCache.set(cacheKey, next);
        return next;
      });
    },
    [cacheKey],
  );

  const enabled = choice.enabled;
  const modelId = choice.modelId;
  const effort = choice.effort;

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
      remember({ enabled: next });
      return patchConfig({ summary: next });
    },
    [patchConfig, remember],
  );

  const setModel = useCallback(
    (nextModelId: string) => {
      remember({ modelId: nextModelId });
      return patchConfig({ chat_id: nextModelId });
    },
    [patchConfig, remember],
  );

  const setEffort = useCallback(
    (level: EffortLevel) => {
      remember({ effort: level });
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
    [config?.llm_setting, patchConfig, remember],
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
