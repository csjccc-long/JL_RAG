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

import { CosmicUniverse } from '@/components/cosmic-universe';
import MemoryDrawer from '@/components/memory-drawer';
import MemorySky from '@/components/memory-sky';
import { Button } from '@/components/ui/button';
import { Spin } from '@/components/ui/spin';
import {
  useConsolidate,
  useHindsightStats,
} from '@/hooks/use-hindsight-request';
import { HindsightStatus } from '@/interfaces/database/hindsight';
import { formatTime, prettyJson } from '@/utils/hindsight-util';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

type OverviewTabProps = {
  status?: HindsightStatus;
  bank: string;
};

/**
 * The overview draws the engine as a small universe rather than a wall of
 * cards: the numbers a reader came for are still here, but they wait in the
 * drawer on the right edge until the pointer asks for them.
 */
const OverviewTab = ({ status, bank }: OverviewTabProps) => {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useHindsightStats(bank);
  const consolidate = useConsolidate(bank);
  const [pinned, setPinned] = useState(false);

  const rows: { label: string; value: string }[] = [
    { label: t('hindsight.backend'), value: status?.backend || '-' },
    { label: t('hindsight.dbPath'), value: status?.db_path || '-' },
    {
      label: t('hindsight.vectorBackend'),
      value: status?.vector_backend || '-',
    },
    { label: t('hindsight.vectorIndex'), value: status?.vector_index || '-' },
    { label: t('hindsight.bank'), value: status?.bank || '-' },
    { label: t('hindsight.budget'), value: status?.budget || '-' },
    {
      label: t('hindsight.maxTokens'),
      value: String(status?.max_tokens ?? '-'),
    },
    { label: t('hindsight.topK'), value: String(status?.top_k ?? '-') },
    {
      label: t('hindsight.retainAsync'),
      value: status?.retain_async ? t('hindsight.yes') : t('hindsight.no'),
    },
    {
      label: t('hindsight.preferObservations'),
      value: status?.prefer_observations ? t('hindsight.yes') : t('hindsight.no'),
    },
    {
      label: t('hindsight.defense'),
      value: status?.defense ? t('hindsight.yes') : t('hindsight.no'),
    },
    {
      label: t('hindsight.consolidateAfter'),
      value: String(status?.consolidate_after ?? '-'),
    },
    {
      label: t('hindsight.chunkChars'),
      value: String(status?.chunk_chars ?? '-'),
    },
  ];

  // Hover opens the drawer on its own; a click pins it for touch and keyboard
  // readers who cannot hover at all.
  const togglePinned = useCallback(() => {
    setPinned((open) => !open);
  }, []);

  const handleConsolidate = useCallback(() => {
    consolidate.mutate();
  }, [consolidate]);

  return (
    <MemorySky>
      <CosmicUniverse className="memory-sky__field" />

      <p className="memory-sky__hint">{t('hindsight.universeHint')}</p>

      <MemoryDrawer
        label={t('hindsight.dataPanel')}
        pinned={pinned}
        onTogglePinned={togglePinned}
      >
        <section className="memory-drawer__section">
          <h2 className="memory-drawer__title">{t('hindsight.configTitle')}</h2>
          <p className="memory-drawer__note">{t('hindsight.configHint')}</p>
          <dl className="memory-drawer__rows">
            {rows.map((row) => (
              <div key={row.label} className="min-w-0">
                <dt className="memory-drawer__label">{row.label}</dt>
                <dd className="memory-drawer__value" title={row.value}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {status?.error && (
            <p className="memory-drawer__error">{status.error}</p>
          )}
        </section>

        <section className="memory-drawer__section">
          <div className="memory-drawer__section-head">
            <h2 className="memory-drawer__title">{t('hindsight.statsTitle')}</h2>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleConsolidate}
              disabled={consolidate.isPending || !status?.enabled}
            >
              {t('hindsight.consolidate')}
            </Button>
          </div>
          <p className="memory-drawer__note">{t('hindsight.statsHint')}</p>
          {isLoading ? (
            <Spin />
          ) : (
            <pre className="memory-drawer__stats">
              {stats ? prettyJson(stats) : t('hindsight.empty')}
            </pre>
          )}
          {status && (
            <p className="memory-drawer__note">
              {t('hindsight.healthCheckedAt', {
                time: formatTime(Date.now()),
              })}
            </p>
          )}
        </section>
      </MemoryDrawer>
    </MemorySky>
  );
};

export default OverviewTab;