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

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { RAGFlowSelect } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useHindsightBanks,
  useHindsightStatus,
} from '@/hooks/use-hindsight-request';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import GovernanceTab from './components/governance-tab';
import KnowledgeTab from './components/knowledge-tab';
import MemoriesTab from './components/memories-tab';
import OverviewTab from './components/overview-tab';
import ReflectTab from './components/reflect-tab';

const TABS = [
  { value: 'overview', labelKey: 'hindsight.tabOverview' },
  { value: 'memories', labelKey: 'hindsight.tabMemories' },
  { value: 'reflect', labelKey: 'hindsight.tabReflect' },
  { value: 'knowledge', labelKey: 'hindsight.tabKnowledge' },
  { value: 'governance', labelKey: 'hindsight.tabGovernance' },
];

/**
 * Hindsight memory console.
 *
 * Everything here is opt-in: the assistant only talks to Hindsight when a
 * session explicitly selects the mode, so this page is a management surface
 * rather than a default part of the chat path.
 */
const HindsightPage = () => {
  const { t } = useTranslation();
  const { data: status, isLoading } = useHindsightStatus();
  const { data: banks } = useHindsightBanks();
  const [pickedBank, setPickedBank] = useState('');

  // Work mode keeps one bank per project (work-<hash>), so the console has to
  // let the reader pick which one to inspect. The configured bank stays the
  // default until something else is chosen.
  const defaultBank = status?.bank || 'ragflow';
  const bank = pickedBank || defaultBank;
  const bankOptions = [
    { label: defaultBank, value: defaultBank },
    ...(banks ?? [])
      .map((item) => item.bank_id || item.id || item.name || '')
      .filter((id) => id && id !== defaultBank)
      .map((id) => ({ label: id, value: id })),
  ];

  return (
    <section className="flex h-full flex-col p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium text-text-primary">
            {t('hindsight.title')}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-text-secondary">
            {t('hindsight.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">
              {t('hindsight.bank')}
            </span>
            <RAGFlowSelect
              value={bank}
              onChange={(value) => setPickedBank(String(value))}
              options={bankOptions}
              triggerClassName="h-8 w-56 text-xs"
              triggerTestId="hindsight-bank"
              optionTestIdPrefix="hindsight-bank-option"
            />
          </div>
          <span className="text-xs text-text-secondary">
            {t('hindsight.statusTitle')}
          </span>
          {isLoading ? (
            <Badge variant="secondary">{t('hindsight.loading')}</Badge>
          ) : (
            <Badge
              variant={
                status?.enabled && status?.healthy === false
                  ? 'destructive'
                  : status?.enabled
                    ? 'success'
                    : 'secondary'
              }
            >
              {!status?.enabled
                ? t('hindsight.statusDisabled')
                : status?.healthy === false
                  ? t('hindsight.statusOffline')
                  : t('hindsight.statusOnline')}
            </Badge>
          )}
        </div>
      </header>

      {!isLoading && !status?.enabled && (
        <Card className="mb-4">
          <CardContent className="pt-6 text-sm text-text-secondary">
            {t('hindsight.disabledHint')}
          </CardContent>
        </Card>
      )}

      <Tabs
        defaultValue="overview"
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="w-fit">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {t(tab.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="min-h-0 flex-1 overflow-auto pt-4">
          <TabsContent value="overview" className="mt-0">
            <OverviewTab status={status} bank={bank} />
          </TabsContent>
          <TabsContent value="memories" className="mt-0">
            <MemoriesTab bank={bank} />
          </TabsContent>
          <TabsContent value="reflect" className="mt-0">
            <ReflectTab bank={bank} />
          </TabsContent>
          <TabsContent value="knowledge" className="mt-0">
            <KnowledgeTab bank={bank} />
          </TabsContent>
          <TabsContent value="governance" className="mt-0">
            <GovernanceTab bank={bank} />
          </TabsContent>
        </div>
      </Tabs>
    </section>
  );
};

export default HindsightPage;
