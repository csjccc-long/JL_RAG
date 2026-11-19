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

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spin } from '@/components/ui/spin';
import {
  useConsolidate,
  useHindsightStats,
} from '@/hooks/use-hindsight-request';
import { HindsightStatus } from '@/interfaces/database/hindsight';
import { formatTime, prettyJson } from '@/utils/hindsight-util';
import { useTranslation } from 'react-i18next';

type OverviewTabProps = {
  status?: HindsightStatus;
  bank: string;
};

const OverviewTab = ({ status, bank }: OverviewTabProps) => {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useHindsightStats(bank);
  const consolidate = useConsolidate(bank);

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

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('hindsight.configTitle')}</CardTitle>
          <CardDescription>{t('hindsight.configHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="min-w-0">
                <dt className="text-xs text-text-secondary">{row.label}</dt>
                <dd className="truncate text-text-primary" title={row.value}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {status?.error && (
            <p className="mt-4 rounded-md bg-bg-base p-3 text-xs text-state-error">
              {status.error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">
              {t('hindsight.statsTitle')}
            </CardTitle>
            <CardDescription>{t('hindsight.statsHint')}</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => consolidate.mutate()}
            disabled={consolidate.isPending || !status?.enabled}
          >
            {t('hindsight.consolidate')}
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Spin />
          ) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-bg-base p-3 text-xs text-text-secondary">
              {stats ? prettyJson(stats) : t('hindsight.empty')}
            </pre>
          )}
          {status && (
            <p className="mt-3 text-xs text-text-secondary">
              {t('hindsight.healthCheckedAt', {
                time: formatTime(Date.now()),
              })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default OverviewTab;
