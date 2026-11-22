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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spin } from '@/components/ui/spin';
import {
  useClearMentalModel,
  useCreateMentalModel,
  useDeleteMentalModel,
  useDeletePage,
  useHindsightMentalModels,
  useHindsightObservations,
  useHindsightPages,
  useRefreshMentalModel,
  useSearchPages,
} from '@/hooks/use-hindsight-request';
import { KnowledgePage } from '@/interfaces/database/hindsight';
import { asArray, formatTime, memoryText } from '@/utils/hindsight-util';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import OrbitalTab, { OrbitalPanel } from '@/components/orbital-tab';
import DocumentEvidenceDialog from './document-evidence-dialog';

type KnowledgeTabProps = {
  bank: string;
};

const KnowledgeTab = ({ bank }: KnowledgeTabProps) => {
  const { t } = useTranslation();
  const { data: models, isLoading: modelsLoading } =
    useHindsightMentalModels(bank);
  const { data: observations, isLoading: observationsLoading } =
    useHindsightObservations(bank);
  const { data: pages, isLoading: pagesLoading } = useHindsightPages(bank);
  const createModel = useCreateMentalModel(bank);
  const refreshModel = useRefreshMentalModel(bank);
  const clearModel = useClearMentalModel(bank);
  const removeModel = useDeleteMentalModel(bank);
  const removePage = useDeletePage(bank);
  const searchPages = useSearchPages(bank);

  const [name, setName] = useState('');
  const [sourceQuery, setSourceQuery] = useState('');
  const [pageQuery, setPageQuery] = useState('');
  const [pageResults, setPageResults] = useState<KnowledgePage[] | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [pageDetail, setPageDetail] = useState<KnowledgePage | null>(null);

  const handleCreateModel = () => {
    if (!name.trim() || !sourceQuery.trim()) {
      return;
    }
    createModel.mutate(
      { name: name.trim(), sourceQuery: sourceQuery.trim() },
      {
        onSuccess: () => {
          setName('');
          setSourceQuery('');
        },
      },
    );
  };

  const handleSearchPages = async () => {
    if (!pageQuery.trim()) {
      return;
    }
    const result = await searchPages.mutateAsync(pageQuery.trim());
    setPageResults(asArray<KnowledgePage>(result, ['pages', 'results']));
  };

  const visiblePages = pageResults ?? pages ?? [];

  const features = [
    { key: 'models', label: t('hindsight.mentalModelsTitle') },
    { key: 'observations', label: t('hindsight.observationsTitle') },
    { key: 'pages', label: t('hindsight.pagesTitle') },
  ];

  return (
    <>
      <OrbitalTab
        starKey="knowledge"
        hint={t('hindsight.orbitHint')}
        drawerLabel={t('hindsight.dataPanel')}
        features={features}
      >
        <OrbitalPanel id="models">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('hindsight.mentalModelsTitle')}
          </CardTitle>
          <CardDescription>{t('hindsight.mentalModelsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('hindsight.modelNamePlaceholder')}
            />
            <Input
              value={sourceQuery}
              onChange={(event) => setSourceQuery(event.target.value)}
              placeholder={t('hindsight.modelQueryPlaceholder')}
              className="sm:col-span-2"
            />
          </div>
          <div>
            <Button
              variant="outline"
              onClick={handleCreateModel}
              disabled={
                createModel.isPending || !name.trim() || !sourceQuery.trim()
              }
            >
              {t('hindsight.createModel')}
            </Button>
          </div>

          {modelsLoading ? (
            <Spin />
          ) : models?.length ? (
            <div className="grid gap-2">
              {models.map((model) => (
                <div
                  key={model.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-bg-base p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary">
                      {model.name || model.id}
                    </p>
                    <p className="mt-1 text-xs text-text-secondary">
                      {model.source_query || '-'}
                    </p>
                    <p className="mt-1 text-xs text-text-secondary">
                      {formatTime(model.updated_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => refreshModel.mutate(model.id)}
                      disabled={refreshModel.isPending}
                    >
                      {t('hindsight.refreshModel')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => clearModel.mutate(model.id)}
                      disabled={clearModel.isPending}
                    >
                      {t('hindsight.clearModel')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeModel.mutate(model.id)}
                      disabled={removeModel.isPending}
                    >
                      {t('hindsight.delete')}
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

        <OrbitalPanel id="observations">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('hindsight.observationsTitle')}
          </CardTitle>
          <CardDescription>{t('hindsight.observationsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {observationsLoading ? (
            <Spin />
          ) : observations?.groups?.length ? (
            observations.groups.map((group) => (
              <div key={group.scope || 'general'} className="grid gap-2">
                <p className="text-xs font-medium text-text-secondary">
                  {group.scope || t('hindsight.observationsGeneral')}
                </p>
                {(group.observations ?? []).map((item) => (
                  <div key={item.id} className="rounded-md bg-bg-base p-3">
                    <p className="text-sm text-text-primary">
                      {item.text || item.content || '-'}
                    </p>
                    <p className="mt-1 text-xs text-text-secondary">
                      {t('hindsight.proofCount', {
                        count: item.proof_count ?? 0,
                      })}
                    </p>
                    {item.evidence?.length ? (
                      <div className="mt-2 grid gap-1 border-t border-border-default pt-2">
                        <p className="text-xs font-medium text-text-secondary">
                          {t('hindsight.evidenceTitle')}
                        </p>
                        {item.evidence.map((evidence) => (
                          <div
                            key={evidence.id}
                            className="flex flex-wrap items-start justify-between gap-2"
                          >
                            <p className="min-w-0 flex-1 text-xs text-text-secondary">
                              {memoryText(evidence) || '-'}
                            </p>
                            {evidence.document_id ? (
                              <button
                                type="button"
                                className="text-xs underline decoration-dotted"
                                onClick={() =>
                                  setDocumentId(evidence.document_id || '')
                                }
                              >
                                {t('hindsight.viewDocument')}
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))
          ) : (
            <p className="text-sm text-text-secondary">{t('hindsight.empty')}</p>
          )}
        </CardContent>
      </Card>
        </OrbitalPanel>

        <OrbitalPanel id="pages">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('hindsight.pagesTitle')}</CardTitle>
          <CardDescription>{t('hindsight.pagesHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex gap-2">
            <Input
              value={pageQuery}
              onChange={(event) => setPageQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleSearchPages();
                }
              }}
              placeholder={t('hindsight.pagesSearchPlaceholder')}
            />
            <Button
              variant="outline"
              onClick={handleSearchPages}
              disabled={searchPages.isPending || !pageQuery.trim()}
            >
              {t('hindsight.pagesSearchButton')}
            </Button>
          </div>

          {pagesLoading && !pageResults ? (
            <Spin />
          ) : visiblePages.length ? (
            <div className="grid gap-2">
              {visiblePages.map((page) => (
                <div
                  key={page.id}
                  className="flex items-start justify-between gap-3 rounded-md bg-bg-base p-3"
                >
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="text-left text-sm text-text-primary underline-offset-2 hover:underline"
                      onClick={() => setPageDetail(page)}
                    >
                      {page.title || page.id}
                    </button>
                    <p className="mt-1 truncate text-xs text-text-secondary">
                      {page.path || '-'}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removePage.mutate(page.id)}
                    disabled={removePage.isPending}
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
      </OrbitalTab>

      <Dialog
        open={!!pageDetail}
        onOpenChange={(open) => {
          if (!open) {
            setPageDetail(null);
          }
        }}
      >
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {pageDetail?.title || pageDetail?.id || ''}
            </DialogTitle>
            <DialogDescription className="break-all">
              {pageDetail?.path || ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <p className="whitespace-pre-wrap break-words text-sm text-text-primary">
              {pageDetail?.content || t('hindsight.documentEmpty')}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
              {pageDetail?.tags?.length ? (
                <span>
                  {t('hindsight.pageTags')}: {pageDetail.tags.join(', ')}
                </span>
              ) : null}
              {pageDetail?.updated_at ? (
                <span>
                  {t('hindsight.pageUpdatedAt')}:{' '}
                  {formatTime(pageDetail.updated_at)}
                </span>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <DocumentEvidenceDialog
        bank={bank}
        documentId={documentId}
        open={!!documentId}
        onOpenChange={(open) => {
          if (!open) {
            setDocumentId('');
          }
        }}
      />
    </>
  );
};

export default KnowledgeTab;