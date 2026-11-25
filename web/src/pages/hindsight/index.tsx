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

import { collapseBlackHole } from '@/components/black-hole-universe/collapse';
import { OrbitalNav } from '@/components/orbital-tab';
import { StarKey } from '@/components/orbital-universe';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { RAGFlowSelect } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHindsightBanks, useHindsightStatus } from '@/hooks/use-hindsight-request';
import { useIsDarkTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  // The tabs are driven by state so a click on a neighbouring star in one
  // module's sky can open that module's tab.
  const [tab, setTab] = useState('overview');
  const isDarkTheme = useIsDarkTheme();
  const [covered, setCovered] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  /**
   * Leaving the overview means falling into the hole: the drawing pushes in and
   * twists, the page fades to black behind it, and only then does the next tab
   * appear, revealed from the dark. Other moves stay instant.
   */
  const switchTab = useCallback(
    (next: string) => {
      if (next === tab) return;
      const fallsIn =
        tab === 'overview' &&
        !isDarkTheme &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!fallsIn) {
        setTab(next);
        return;
      }
      setCovered(true);
      void collapseBlackHole().then(() => {
        setTab(next);
        timers.current.push(
          window.setTimeout(() => {
            setRevealing(true);
            timers.current.push(
              window.setTimeout(() => {
                setCovered(false);
                setRevealing(false);
              }, 480),
            );
          }, 90),
        );
      });
    },
    [isDarkTheme, tab],
  );
  const gotoModule = useCallback((key: StarKey) => switchTab(key), [switchTab]);

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
        value={tab}
        onValueChange={switchTab}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="w-fit">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {t(tab.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="relative min-h-0 flex-1 overflow-auto pt-4">
          <OrbitalNav.Provider value={gotoModule}>
            <TabsContent value="overview" className="mt-0 h-full">
              <OverviewTab status={status} bank={bank} />
            </TabsContent>
            <TabsContent value="memories" className="mt-0 h-full">
              <MemoriesTab bank={bank} />
            </TabsContent>
            <TabsContent value="reflect" className="mt-0 h-full">
              <ReflectTab bank={bank} />
            </TabsContent>
            <TabsContent value="knowledge" className="mt-0 h-full">
              <KnowledgeTab bank={bank} />
            </TabsContent>
            <TabsContent value="governance" className="mt-0 h-full">
              <GovernanceTab bank={bank} />
            </TabsContent>
          </OrbitalNav.Provider>

          {/* The black the hole swallows its own panel into before the next tab
              opens. It stays inside the panel, so the header and the tabs keep
              standing in the light. */}
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-0 z-[80] bg-black transition-opacity',
              covered
                ? revealing
                  ? 'opacity-0 duration-500 ease-out'
                  : 'opacity-100 duration-700 ease-in'
                : 'opacity-0',
            )}
          />
        </div>
      </Tabs>
    </section>
  );
};

export default HindsightPage;