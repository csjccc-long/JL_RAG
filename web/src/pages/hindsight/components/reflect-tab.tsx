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
import { Spin } from '@/components/ui/spin';
import { Textarea } from '@/components/ui/textarea';
import { useReflect } from '@/hooks/use-hindsight-request';
import { HindsightMemory } from '@/interfaces/database/hindsight';
import { asArray, formatTime, isRecord, memoryText } from '@/utils/hindsight-util';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import OrbitalTab, { OrbitalPanel } from '@/components/orbital-tab';
import DocumentEvidenceDialog from './document-evidence-dialog';

type ReflectTabProps = {
  bank: string;
};

const ReflectTab = ({ bank }: ReflectTabProps) => {
  const { t } = useTranslation();
  const reflect = useReflect(bank);
  const [query, setQuery] = useState('');
  const [documentId, setDocumentId] = useState('');

  const result = reflect.data;
  const answer = useMemo(() => {
    if (!isRecord(result)) {
      return '';
    }
    return String(result.answer ?? result.text ?? result.response ?? '');
  }, [result]);

  const citations = useMemo<HindsightMemory[]>(() => {
    if (!isRecord(result)) {
      return [];
    }
    const facts = asArray<HindsightMemory>(result.facts, ['facts']);
    if (facts.length) {
      return facts;
    }
    return asArray<HindsightMemory>(result.memories, ['memories']);
  }, [result]);

  // citations are the ids the model actually used; facts also contains the
  // evidence it retrieved but did not cite, so the difference is worth showing.
  const citedIds = useMemo(() => {
    if (!isRecord(result) || !Array.isArray(result.citations)) {
      return new Set<string>();
    }
    return new Set(result.citations.map((id) => String(id)));
  }, [result]);

  const handleReflect = () => {
    if (!query.trim()) {
      return;
    }
    reflect.mutate({
      query: query.trim(),
      budget: 'low',
      max_tokens: 2048,
      include: { facts: true },
    });
  };

  const features = [
    { key: 'ask', label: t('hindsight.reflectTitle') },
    { key: 'answer', label: t('hindsight.reflectAnswer') },
  ];

  return (
    <>
      <OrbitalTab
        starKey="reflect"
        hint={t('hindsight.orbitHint')}
        drawerLabel={t('hindsight.dataPanel')}
        features={features}
      >
        <OrbitalPanel id="ask">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('hindsight.reflectTitle')}
          </CardTitle>
          <CardDescription>{t('hindsight.reflectHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Textarea
            rows={3}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('hindsight.reflectPlaceholder')}
          />
          <div>
            <Button
              onClick={handleReflect}
              disabled={reflect.isPending || !query.trim()}
            >
              {t('hindsight.reflectButton')}
            </Button>
          </div>
        </CardContent>
      </Card>
        </OrbitalPanel>

        <OrbitalPanel id="answer">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('hindsight.reflectAnswer')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {reflect.isPending && <Spin />}
          {reflect.isError && (
            <p className="text-sm text-state-error">
              {(reflect.error as Error).message}
            </p>
          )}
          {!reflect.isPending && !answer && (
            <p className="text-sm text-text-secondary">
              {t('hindsight.reflectEmpty')}
            </p>
          )}
          {answer && (
            <p className="whitespace-pre-wrap break-words text-sm text-text-primary">
              {answer}
            </p>
          )}
          {citations.length > 0 && (
            <div className="grid gap-2">
              <div>
                <p className="text-xs uppercase text-text-secondary">
                  {t('hindsight.reflectCitations')}
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  {t('hindsight.evidenceHint')}
                </p>
              </div>
              {citations.map((citation, index) => (
                <div
                  key={citation.id || index}
                  className="rounded-md bg-bg-base p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-text-primary">[{index + 1}]</span>
                    {citedIds.has(String(citation.id)) && (
                      <Badge variant="secondary">
                        {t('hindsight.citedBadge')}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-text-secondary">
                    {memoryText(citation) || '-'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
                    {citation.type ? (
                      <span>
                        {t('hindsight.evidenceType')}: {citation.type}
                      </span>
                    ) : null}
                    {citation.mentioned_at ? (
                      <span>
                        {t('hindsight.evidenceTime')}:{' '}
                        {formatTime(citation.mentioned_at)}
                      </span>
                    ) : null}
                    {citation.document_id ? (
                      <button
                        type="button"
                        className="underline decoration-dotted"
                        onClick={() =>
                          setDocumentId(citation.document_id || '')
                        }
                      >
                        {t('hindsight.viewDocument')}: {citation.document_id}
                      </button>
                    ) : null}
                    {citation.tags?.length ? (
                      <span>
                        {t('hindsight.evidenceTags')}:{' '}
                        {citation.tags.join(', ')}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
        </OrbitalPanel>
      </OrbitalTab>

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

export default ReflectTab;