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

import { MemoryCard } from '@/components/memory-card';
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
import { Textarea } from '@/components/ui/textarea';
import {
  useDeleteMemory,
  useHindsightMemories,
  useIngestFile,
  useRecall,
  useRetainMemory,
} from '@/hooks/use-hindsight-request';
import {
  HindsightIngestResult,
  RecalledMemory,
} from '@/interfaces/database/hindsight';
import { asArray, formatTime, memoryScore, memoryText } from '@/utils/hindsight-util';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type MemoriesTabProps = {
  bank: string;
};

const MemoriesTab = ({ bank }: MemoriesTabProps) => {
  const { t } = useTranslation();
  const { data: memories, isLoading } = useHindsightMemories(bank);
  const retain = useRetainMemory(bank);
  const recall = useRecall(bank);
  const remove = useDeleteMemory(bank);
  const ingest = useIngestFile(bank);

  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [query, setQuery] = useState('');
  const [recalled, setRecalled] = useState<RecalledMemory[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileTags, setFileTags] = useState('');
  const [preview, setPreview] = useState<HindsightIngestResult | null>(null);

  const handleRetain = () => {
    if (!content.trim()) {
      return;
    }
    retain.mutate(
      {
        content: content.trim(),
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        documentId: documentId.trim() || undefined,
      },
      { onSuccess: () => setContent('') },
    );
  };

  const handleRecall = async () => {
    if (!query.trim()) {
      return;
    }
    const result = await recall.mutateAsync(query.trim());
    setRecalled(asArray<RecalledMemory>(result, ['memories', 'results', 'items']));
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('hindsight.retainTitle')}
            </CardTitle>
            <CardDescription>{t('hindsight.retainHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={t('hindsight.retainPlaceholder')}
              rows={4}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder={t('hindsight.retainTagsPlaceholder')}
              />
              <Input
                value={documentId}
                onChange={(event) => setDocumentId(event.target.value)}
                placeholder={t('hindsight.retainDocumentPlaceholder')}
              />
            </div>
            <div>
              <Button
                onClick={handleRetain}
                disabled={retain.isPending || !content.trim()}
              >
                {t('hindsight.retainButton')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('hindsight.recallTitle')}
            </CardTitle>
            <CardDescription>{t('hindsight.recallHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleRecall();
                  }
                }}
                placeholder={t('hindsight.recallPlaceholder')}
              />
              <Button
                variant="outline"
                onClick={handleRecall}
                disabled={recall.isPending || !query.trim()}
              >
                {t('hindsight.recallButton')}
              </Button>
            </div>
            <div className="grid gap-2">
              {recall.isPending && <Spin />}
              {recalled?.length === 0 && (
                <p className="text-sm text-text-secondary">
                  {t('hindsight.recallEmpty')}
                </p>
              )}
              {recalled?.map((item, index) => (
                <div
                  key={item.id || index}
                  className="rounded-md bg-bg-base p-3 text-sm"
                >
                  <p className="whitespace-pre-wrap break-words text-text-primary">
                    {memoryText(item) || '-'}
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {[item.type, memoryScore(item)]
                      .filter((value) => value !== undefined && value !== '')
                      .join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('hindsight.ingestTitle')}
          </CardTitle>
          <CardDescription>{t('hindsight.ingestHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              type="file"
              accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.html,.png,.jpg,.jpeg,.webp,.tif,.tiff"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
              }}
            />
            <Input
              value={fileTags}
              onChange={(event) => setFileTags(event.target.value)}
              placeholder={t('hindsight.retainTagsPlaceholder')}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                file &&
                ingest.mutate(
                  { file, tags: fileTags, dryRun: true },
                  { onSuccess: (result) => setPreview(result) },
                )
              }
              disabled={ingest.isPending || !file}
            >
              {t('hindsight.ingestPreview')}
            </Button>
            <Button
              onClick={() =>
                file &&
                ingest.mutate(
                  { file, tags: fileTags },
                  { onSuccess: (result) => setPreview(result) },
                )
              }
              disabled={ingest.isPending || !file}
            >
              {t('hindsight.ingestUpload')}
            </Button>
          </div>
          {preview && (
            <div className="rounded-md bg-bg-base p-3 text-sm">
              <p className="text-text-primary">
                {t('hindsight.ingestResult', {
                  chunks: preview.chunks,
                  chars: preview.chars,
                })}
              </p>
              {preview.preview && (
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-text-secondary">
                  {preview.preview}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('hindsight.memoriesTitle')}
          </CardTitle>
          <CardDescription>{t('hindsight.memoriesHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Spin />
          ) : memories?.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {memories.map((memory, index) => (
                <MemoryCard
                  key={memory.id}
                  heading={'记忆' + String(index + 1).padStart(2, '0')}
                  title={memoryText(memory) || '-'}
                  meta={String(
                    formatTime(memory.mentioned_at || memory.created_at) || '',
                  )}
                  badge={String(memory.type || 'memory').toUpperCase()}
                  removeLabel={t('hindsight.delete')}
                  onRemove={() => remove.mutate(memory.id)}
                  removePending={remove.isPending}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">{t('hindsight.empty')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MemoriesTab;
