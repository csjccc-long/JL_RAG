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
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spin } from '@/components/ui/spin';
import {
  useCancelOperation,
  useCreateAlias,
  useCreateBank,
  useCreateDirective,
  useCreateWebhook,
  useDeleteAlias,
  useDeleteBank,
  useDeleteDirective,
  useDeleteWebhook,
  useHindsightAliases,
  useHindsightBanks,
  useHindsightDeliveries,
  useHindsightDirectives,
  useHindsightDocuments,
  useHindsightOperations,
  useHindsightWebhooks,
  useHindsightWorker,
  usePruneMemory,
  useRetryOperation,
  useRunMaintenance,
  useStartWorker,
  useTestWebhook,
  useToggleWebhook,
} from '@/hooks/use-hindsight-request';
import { formatTime, isRecord } from '@/utils/hindsight-util';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import OrbitalTab, { OrbitalPanel } from '@/components/orbital-tab';

type GovernanceTabProps = {
  bank: string;
};

const textOf = (record: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value) {
      return value;
    }
  }
  return '';
};

const WebhookDeliveries = ({
  bank,
  webhookId,
}: {
  bank: string;
  webhookId: string;
}) => {
  const { t } = useTranslation();
  const { data, isLoading } = useHindsightDeliveries(bank, webhookId);
  if (isLoading) {
    return <Spin />;
  }
  if (!data?.length) {
    return (
      <p className="mt-2 text-xs text-text-secondary">{t('hindsight.empty')}</p>
    );
  }
  return (
    <div className="mt-2 grid gap-1">
      {data.map((delivery) => (
        <p key={delivery.id} className="text-xs text-text-secondary">
          {[
            formatTime(delivery.created_at),
            delivery.event,
            delivery.status,
            delivery.attempts ? String(delivery.attempts) + 'x' : '',
            delivery.error,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ))}
    </div>
  );
};

const GovernanceTab = ({ bank }: GovernanceTabProps) => {
  const { t } = useTranslation();
  const { data: banks, isLoading: banksLoading } = useHindsightBanks();
  const { data: directives, isLoading: directivesLoading } =
    useHindsightDirectives(bank);
  const { data: documents, isLoading: documentsLoading } =
    useHindsightDocuments(bank);
  const { data: operations, isLoading: operationsLoading } =
    useHindsightOperations(bank);

  const createBank = useCreateBank();
  const deleteBank = useDeleteBank();
  const createDirective = useCreateDirective(bank);
  const deleteDirective = useDeleteDirective(bank);
  const cancelOperation = useCancelOperation(bank);
  const retryOperation = useRetryOperation(bank);
  const { data: aliases, isLoading: aliasesLoading } = useHindsightAliases(bank);
  const { data: webhooks, isLoading: webhooksLoading } =
    useHindsightWebhooks(bank);
  const { data: worker, isLoading: workerLoading } = useHindsightWorker();
  const createAlias = useCreateAlias(bank);
  const deleteAlias = useDeleteAlias(bank);
  const createWebhook = useCreateWebhook(bank);
  const deleteWebhook = useDeleteWebhook(bank);
  const toggleWebhook = useToggleWebhook(bank);
  const testWebhook = useTestWebhook(bank);
  const prune = usePruneMemory(bank);
  const maintenance = useRunMaintenance();
  const startWorker = useStartWorker();

  const [bankName, setBankName] = useState('');
  const [directive, setDirective] = useState('');
  const [alias, setAlias] = useState('');
  const [canonical, setCanonical] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState('');
  const [pruneDays, setPruneDays] = useState('90');
  const [openWebhook, setOpenWebhook] = useState('');

  const features = [
    { key: 'banks', label: t('hindsight.banksTitle') },
    { key: 'directives', label: t('hindsight.directivesTitle') },
    { key: 'documents', label: t('hindsight.documentsTitle') },
    { key: 'operations', label: t('hindsight.operationsTitle') },
    { key: 'queue', label: t('hindsight.queueTitle') },
    { key: 'aliases', label: t('hindsight.aliasesTitle') },
    { key: 'webhooks', label: t('hindsight.webhooksTitle') },
  ];

  return (
    <>
      <OrbitalTab
        starKey="governance"
        hint={t('hindsight.orbitHint')}
        drawerLabel={t('hindsight.dataPanel')}
        features={features}
      >
        <OrbitalPanel id="banks">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('hindsight.banksTitle')}</CardTitle>
          <CardDescription>{t('hindsight.banksHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex gap-2">
            <Input
              value={bankName}
              onChange={(event) => setBankName(event.target.value)}
              placeholder={t('hindsight.bankNamePlaceholder')}
            />
            <Button
              variant="outline"
              onClick={() =>
                createBank.mutate(bankName.trim(), {
                  onSuccess: () => setBankName(''),
                })
              }
              disabled={createBank.isPending || !bankName.trim()}
            >
              {t('hindsight.createBank')}
            </Button>
          </div>
          {banksLoading ? (
            <Spin />
          ) : banks?.length ? (
            <div className="grid gap-2">
              {banks.map((item) => {
                const id = item.bank_id || item.id || item.name || '';
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-2 rounded-md bg-bg-base p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-text-primary">
                        {item.name || id}
                        {id === bank && (
                          <Badge variant="secondary" className="ml-2">
                            {t('hindsight.currentBank')}
                          </Badge>
                        )}
                      </p>
                      {item.mission && (
                        <p className="mt-1 truncate text-xs text-text-secondary">
                          {item.mission}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteBank.mutate(id)}
                      disabled={deleteBank.isPending || id === bank}
                    >
                      {t('hindsight.delete')}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">{t('hindsight.empty')}</p>
          )}
        </CardContent>
      </Card>
        </OrbitalPanel>

        <OrbitalPanel id="directives">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('hindsight.directivesTitle')}
          </CardTitle>
          <CardDescription>{t('hindsight.directivesHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex gap-2">
            <Input
              value={directive}
              onChange={(event) => setDirective(event.target.value)}
              placeholder={t('hindsight.directivePlaceholder')}
            />
            <Button
              variant="outline"
              onClick={() =>
                createDirective.mutate(directive.trim(), {
                  onSuccess: () => setDirective(''),
                })
              }
              disabled={createDirective.isPending || !directive.trim()}
            >
              {t('hindsight.addDirective')}
            </Button>
          </div>
          {directivesLoading ? (
            <Spin />
          ) : directives?.length ? (
            <div className="grid gap-2">
              {directives.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-2 rounded-md bg-bg-base p-3 text-sm"
                >
                  <p className="min-w-0 whitespace-pre-wrap break-words text-text-primary">
                    {item.content || '-'}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteDirective.mutate(item.id)}
                    disabled={deleteDirective.isPending}
                  >
                    {t('hindsight.delete')}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">{t('hindsight.empty')}</p>
          )}
        </CardContent>
      </Card>
        </OrbitalPanel>

        <OrbitalPanel id="documents">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('hindsight.documentsTitle')}
          </CardTitle>
          <CardDescription>{t('hindsight.documentsHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {documentsLoading ? (
            <Spin />
          ) : documents?.length ? (
            <div className="grid gap-2">
              {documents.map((document, index) => {
                const record = isRecord(document) ? document : {};
                const id =
                  textOf(record, 'id', 'document_id') || String(index);
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-2 rounded-md bg-bg-base p-3 text-sm"
                  >
                    <span className="min-w-0 truncate text-text-primary" title={id}>
                      {textOf(record, 'title', 'name') || id}
                    </span>
                    <span className="text-xs text-text-secondary">
                      {formatTime(textOf(record, 'created_at', 'updated_at'))}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">{t('hindsight.empty')}</p>
          )}
        </CardContent>
      </Card>
        </OrbitalPanel>

        <OrbitalPanel id="operations">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('hindsight.operationsTitle')}
          </CardTitle>
          <CardDescription>{t('hindsight.operationsHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {operationsLoading ? (
            <Spin />
          ) : operations?.length ? (
            <div className="grid gap-2">
              {operations.map((operation) => (
                <div
                  key={operation.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-bg-base p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate text-text-primary">{operation.id}</p>
                    <p className="mt-1 text-xs text-text-secondary">
                      {[
                        operation.kind ||
                          operation.operation_type ||
                          operation.type,
                        operation.status,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cancelOperation.mutate(operation.id)}
                      disabled={cancelOperation.isPending}
                    >
                      {t('hindsight.cancelOperation')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => retryOperation.mutate(operation.id)}
                      disabled={retryOperation.isPending}
                    >
                      {t('hindsight.retryOperation')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">{t('hindsight.empty')}</p>
          )}
        </CardContent>
      </Card>
        </OrbitalPanel>

        <OrbitalPanel id="queue">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('hindsight.queueTitle')}</CardTitle>
          <CardDescription>{t('hindsight.queueHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {workerLoading ? (
            <Spin />
          ) : (
            <div className="grid gap-1 text-sm text-text-secondary">
              <p>
                {t('hindsight.queueCounts', {
                  queued: worker?.worker.queued ?? 0,
                  running: worker?.worker.running ?? 0,
                  done: worker?.worker.done ?? 0,
                  failed: worker?.worker.failed ?? 0,
                })}
              </p>
              <p>
                {t('hindsight.schedulerLastRun')}:{' '}
                {formatTime(worker?.scheduler.last_run) || '-'}
              </p>
              {!!worker?.scheduler.last_error && (
                <p className="break-words text-state-error">
                  {worker.scheduler.last_error}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => startWorker.mutate()}
              disabled={startWorker.isPending}
            >
              {t('hindsight.startWorker')}
            </Button>
            <Button
              variant="outline"
              onClick={() => maintenance.mutate()}
              disabled={maintenance.isPending}
            >
              {t('hindsight.runMaintenance')}
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              value={pruneDays}
              onChange={(event) => setPruneDays(event.target.value)}
              placeholder={t('hindsight.pruneDays')}
            />
            <Button
              variant="outline"
              onClick={() => prune.mutate(Number(pruneDays) || 90)}
              disabled={prune.isPending}
            >
              {t('hindsight.pruneButton')}
            </Button>
          </div>
        </CardContent>
      </Card>
        </OrbitalPanel>

        <OrbitalPanel id="aliases">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('hindsight.aliasesTitle')}</CardTitle>
          <CardDescription>{t('hindsight.aliasesHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              placeholder={t('hindsight.aliasPlaceholder')}
            />
            <Input
              value={canonical}
              onChange={(event) => setCanonical(event.target.value)}
              placeholder={t('hindsight.canonicalPlaceholder')}
            />
          </div>
          <div>
            <Button
              variant="outline"
              onClick={() =>
                createAlias.mutate(
                  { alias: alias.trim(), canonical: canonical.trim() },
                  {
                    onSuccess: () => {
                      setAlias('');
                      setCanonical('');
                    },
                  },
                )
              }
              disabled={
                createAlias.isPending || !alias.trim() || !canonical.trim()
              }
            >
              {t('hindsight.addAlias')}
            </Button>
          </div>
          {aliasesLoading ? (
            <Spin />
          ) : aliases?.length ? (
            <div className="grid gap-2">
              {aliases.map((item) => (
                <div
                  key={item.alias}
                  className="flex items-center justify-between gap-2 rounded-md bg-bg-base p-3 text-sm"
                >
                  <p className="min-w-0 truncate text-text-primary">
                    {item.alias} → {item.canonical}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteAlias.mutate(item.alias)}
                    disabled={deleteAlias.isPending}
                  >
                    {t('hindsight.delete')}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">{t('hindsight.empty')}</p>
          )}
        </CardContent>
      </Card>
        </OrbitalPanel>

        <OrbitalPanel id="webhooks">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('hindsight.webhooksTitle')}
          </CardTitle>
          <CardDescription>{t('hindsight.webhooksHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              placeholder={t('hindsight.webhookUrlPlaceholder')}
            />
            <Input
              value={webhookEvents}
              onChange={(event) => setWebhookEvents(event.target.value)}
              placeholder={t('hindsight.webhookEventsPlaceholder')}
            />
          </div>
          <div>
            <Button
              variant="outline"
              onClick={() =>
                createWebhook.mutate(
                  {
                    url: webhookUrl.trim(),
                    events: webhookEvents
                      .split(',')
                      .map((event) => event.trim())
                      .filter(Boolean),
                  },
                  {
                    onSuccess: () => {
                      setWebhookUrl('');
                      setWebhookEvents('');
                    },
                  },
                )
              }
              disabled={createWebhook.isPending || !webhookUrl.trim()}
            >
              {t('hindsight.addWebhook')}
            </Button>
          </div>
          {webhooksLoading ? (
            <Spin />
          ) : webhooks?.length ? (
            <div className="grid gap-2">
              {webhooks.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md bg-bg-base p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-text-primary" title={item.url}>
                        {item.url}
                      </p>
                      <p className="mt-1 text-xs text-text-secondary">
                        {[
                          item.active ? t('hindsight.active') : t('hindsight.paused'),
                          item.events?.length
                            ? item.events.join(', ')
                            : t('hindsight.allEvents'),
                        ].join(' · ')}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setOpenWebhook(openWebhook === item.id ? '' : item.id)}
                      >
                        {t('hindsight.deliveries')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => testWebhook.mutate(item.id)}
                        disabled={testWebhook.isPending}
                      >
                        {t('hindsight.testWebhook')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          toggleWebhook.mutate({ id: item.id, active: !item.active })
                        }
                        disabled={toggleWebhook.isPending}
                      >
                        {item.active
                          ? t('hindsight.pause')
                          : t('hindsight.resume')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteWebhook.mutate(item.id)}
                        disabled={deleteWebhook.isPending}
                      >
                        {t('hindsight.delete')}
                      </Button>
                    </div>
                  </div>
                  {openWebhook === item.id && (
                    <WebhookDeliveries bank={bank} webhookId={item.id} />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">{t('hindsight.empty')}</p>
          )}
        </CardContent>
      </Card>
        </OrbitalPanel>
      </OrbitalTab>
    </>
  );
};

export default GovernanceTab;