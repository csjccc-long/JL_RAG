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

import message from '@/components/ui/message';
import type {
  Directive,
  HindsightAlias,
  HindsightBank,
  HindsightDelivery,
  HindsightDocument,
  HindsightIngestResult,
  HindsightMemory,
  HindsightOperation,
  HindsightStatus,
  HindsightWebhook,
  HindsightWorker,
  KnowledgePage,
  MentalModel,
  ObservationTree,
  ReflectResult,
} from '@/interfaces/database/hindsight';
import hindsightService from '@/services/hindsight-service';
import { asArray } from '@/utils/hindsight-util';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

export const HindsightKeys = {
  status: () => ['hindsight', 'status'] as const,
  banks: () => ['hindsight', 'banks'] as const,
  stats: (bank: string) => ['hindsight', 'stats', bank] as const,
  memories: (bank: string) => ['hindsight', 'memories', bank] as const,
  mentalModels: (bank: string) => ['hindsight', 'mental-models', bank] as const,
  observations: (bank: string) => ['hindsight', 'observations', bank] as const,
  pages: (bank: string) => ['hindsight', 'pages', bank] as const,
  directives: (bank: string) => ['hindsight', 'directives', bank] as const,
  documents: (bank: string) => ['hindsight', 'documents', bank] as const,
  document: (bank: string, documentId: string) =>
    ['hindsight', 'document', bank, documentId] as const,
  operations: (bank: string) => ['hindsight', 'operations', bank] as const,
  aliases: (bank: string) => ['hindsight', 'aliases', bank] as const,
  webhooks: (bank: string) => ['hindsight', 'webhooks', bank] as const,
  deliveries: (bank: string, webhookId: string) =>
    ['hindsight', 'deliveries', bank, webhookId] as const,
  worker: () => ['hindsight', 'worker'] as const,
};

export const useHindsightStatus = () =>
  useQuery<HindsightStatus, Error>({
    queryKey: HindsightKeys.status(),
    queryFn: hindsightService.status,
    staleTime: 30_000,
    retry: 1,
  });

export const useHindsightBanks = () =>
  useQuery<HindsightBank[], Error>({
    queryKey: HindsightKeys.banks(),
    queryFn: async () =>
      asArray<HindsightBank>(await hindsightService.banks(), ['banks']),
  });

export const useHindsightStats = (bank: string) =>
  useQuery<Record<string, unknown>, Error>({
    queryKey: HindsightKeys.stats(bank),
    queryFn: () => hindsightService.stats(bank),
    enabled: !!bank,
  });

export const useHindsightMemories = (bank: string) =>
  useQuery<HindsightMemory[], Error>({
    queryKey: HindsightKeys.memories(bank),
    queryFn: async () =>
      asArray<HindsightMemory>(
        await hindsightService.listMemories(bank, { limit: 50 }),
        ['memories', 'results', 'items'],
      ),
    enabled: !!bank,
  });

export const useHindsightMentalModels = (bank: string) =>
  useQuery<MentalModel[], Error>({
    queryKey: HindsightKeys.mentalModels(bank),
    queryFn: async () =>
      asArray<MentalModel>(
        await hindsightService.mentalModels(bank),
        ['mental_models', 'models'],
      ),
    enabled: !!bank,
  });

export const useHindsightObservations = (bank: string) =>
  useQuery<ObservationTree, Error>({
    queryKey: HindsightKeys.observations(bank),
    queryFn: async () =>
      (await hindsightService.observationsTree(bank)) as ObservationTree,
    enabled: !!bank,
  });

export const useHindsightPages = (bank: string) =>
  useQuery<KnowledgePage[], Error>({
    queryKey: HindsightKeys.pages(bank),
    queryFn: async () =>
      asArray<KnowledgePage>(await hindsightService.pages(bank), ['pages']),
    enabled: !!bank,
  });

export const useHindsightDirectives = (bank: string) =>
  useQuery<Directive[], Error>({
    queryKey: HindsightKeys.directives(bank),
    queryFn: async () =>
      asArray<Directive>(await hindsightService.directives(bank), [
        'directives',
      ]),
    enabled: !!bank,
  });

export const useHindsightDocuments = (bank: string) =>
  useQuery<Record<string, unknown>[], Error>({
    queryKey: HindsightKeys.documents(bank),
    queryFn: async () =>
      asArray<Record<string, unknown>>(
        await hindsightService.documents(bank, { limit: 20 }),
        ['documents'],
      ),
    enabled: !!bank,
  });

export const useHindsightDocument = (bank: string, documentId: string) =>
  useQuery<HindsightDocument, Error>({
    queryKey: HindsightKeys.document(bank, documentId),
    queryFn: () => hindsightService.document(bank, documentId),
    enabled: !!bank && !!documentId,
  });

export const useHindsightOperations = (bank: string) =>
  useQuery<HindsightOperation[], Error>({
    queryKey: HindsightKeys.operations(bank),
    queryFn: async () =>
      asArray<HindsightOperation>(
        await hindsightService.operations(bank),
        ['operations'],
      ),
    enabled: !!bank,
  });

export const useHindsightAliases = (bank: string) =>
  useQuery<HindsightAlias[], Error>({
    queryKey: HindsightKeys.aliases(bank),
    queryFn: async () =>
      asArray<HindsightAlias>(await hindsightService.aliases(bank), ['aliases']),
    enabled: !!bank,
  });

export const useHindsightWebhooks = (bank: string) =>
  useQuery<HindsightWebhook[], Error>({
    queryKey: HindsightKeys.webhooks(bank),
    queryFn: async () =>
      asArray<HindsightWebhook>(await hindsightService.webhooks(bank), [
        'webhooks',
      ]),
    enabled: !!bank,
  });

export const useHindsightDeliveries = (bank: string, webhookId: string) =>
  useQuery<HindsightDelivery[], Error>({
    queryKey: HindsightKeys.deliveries(bank, webhookId),
    queryFn: async () =>
      asArray<HindsightDelivery>(
        await hindsightService.webhookDeliveries(bank, webhookId, {
          limit: 20,
        }),
        ['deliveries'],
      ),
    enabled: !!bank && !!webhookId,
  });

/** Queue and scheduler health; polled while the console is open. */
export const useHindsightWorker = () =>
  useQuery<HindsightWorker, Error>({
    queryKey: HindsightKeys.worker(),
    queryFn: hindsightService.worker,
    refetchInterval: 15_000,
    retry: 1,
  });

/** Shared success/error plumbing for the console actions. */
const useAction = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const done = (keys: ReadonlyArray<readonly unknown[]>) => {
    message.success(t('hindsight.actionDone'));
    keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
  };
  const failed = (error: Error) => message.error(error.message);
  return { done, failed };
};

export const useRetainMemory = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: ({
      content,
      tags,
      documentId,
    }: {
      content: string;
      tags?: string[];
      documentId?: string;
    }) =>
      hindsightService.retain(bank, {
        items: [
          {
            content,
            tags,
            document_id: documentId || undefined,
            timestamp: new Date().toISOString(),
          },
        ],
        async: true,
      }),
    onSuccess: () =>
      done([
        HindsightKeys.memories(bank),
        HindsightKeys.stats(bank),
        HindsightKeys.operations(bank),
        HindsightKeys.documents(bank),
      ]),
    onError: failed,
  });
};

export const useDeleteMemory = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: (memoryId: string) =>
      hindsightService.deleteMemory(bank, memoryId),
    onSuccess: () =>
      done([
        HindsightKeys.memories(bank),
        HindsightKeys.stats(bank),
        HindsightKeys.operations(bank),
      ]),
    onError: failed,
  });
};

export const useRecall = (bank: string) =>
  useMutation({
    mutationFn: (query: string) =>
      hindsightService.recall(bank, {
        query,
        budget: 'mid',
        max_tokens: 2048,
      }),
  });

export const useReflect = (bank: string) =>
  useMutation<ReflectResult, Error, Record<string, unknown>>({
    mutationFn: (body) => hindsightService.reflect(bank, body),
  });

export const useConsolidate = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: () => hindsightService.consolidate(bank, {}),
    onSuccess: () =>
      done([
        HindsightKeys.memories(bank),
        HindsightKeys.observations(bank),
        HindsightKeys.stats(bank),
        HindsightKeys.operations(bank),
      ]),
    onError: failed,
  });
};

export const useCreateBank = () => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: (name: string) =>
      hindsightService.createBank({ name, bank_id: name }),
    onSuccess: () => done([HindsightKeys.banks(), HindsightKeys.status()]),
    onError: failed,
  });
};

export const useDeleteBank = () => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: (bank: string) => hindsightService.deleteBank(bank),
    onSuccess: () => done([HindsightKeys.banks(), HindsightKeys.status()]),
    onError: failed,
  });
};

export const useCreateDirective = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: (content: string) =>
      hindsightService.createDirective(bank, { content, priority: 1 }),
    onSuccess: () => done([HindsightKeys.directives(bank)]),
    onError: failed,
  });
};

export const useDeleteDirective = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: (directiveId: string) =>
      hindsightService.deleteDirective(bank, directiveId),
    onSuccess: () => done([HindsightKeys.directives(bank)]),
    onError: failed,
  });
};

export const useCreateMentalModel = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: ({ name, sourceQuery }: { name: string; sourceQuery: string }) =>
      hindsightService.createMentalModel(bank, {
        name,
        source_query: sourceQuery,
      }),
    onSuccess: () => done([HindsightKeys.mentalModels(bank)]),
    onError: failed,
  });
};

export const useRefreshMentalModel = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: (modelId: string) =>
      hindsightService.refreshMentalModel(bank, modelId, {}),
    onSuccess: () => done([HindsightKeys.mentalModels(bank)]),
    onError: failed,
  });
};

export const useClearMentalModel = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: (modelId: string) =>
      hindsightService.clearMentalModel(bank, modelId),
    onSuccess: () => done([HindsightKeys.mentalModels(bank)]),
    onError: failed,
  });
};

export const useDeleteMentalModel = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: (modelId: string) =>
      hindsightService.deleteMentalModel(bank, modelId),
    onSuccess: () => done([HindsightKeys.mentalModels(bank)]),
    onError: failed,
  });
};

export const useSearchPages = (bank: string) =>
  useMutation({
    mutationFn: (query: string) =>
      hindsightService.searchPages(bank, { query, limit: 10 }),
  });

export const useDeletePage = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: (pageId: string) => hindsightService.deletePage(bank, pageId),
    onSuccess: () => done([HindsightKeys.pages(bank)]),
    onError: failed,
  });
};

export const useCancelOperation = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: (operationId: string) =>
      hindsightService.cancelOperation(bank, operationId),
    onSuccess: () => done([HindsightKeys.operations(bank)]),
    onError: failed,
  });
};

export const useRetryOperation = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: (operationId: string) =>
      hindsightService.retryOperation(bank, operationId),
    onSuccess: () =>
      done([HindsightKeys.operations(bank), HindsightKeys.worker()]),
    onError: failed,
  });
};

export const useIngestFile = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation<HindsightIngestResult, Error, { file: File; tags?: string; chunkSize?: number; dryRun?: boolean }>({
    mutationFn: ({ file, tags, chunkSize, dryRun }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (tags) formData.append('tags', tags);
      if (chunkSize) formData.append('chunk_size', String(chunkSize));
      if (dryRun) formData.append('dry_run', 'true');
      return hindsightService.ingest(bank, formData);
    },
    onSuccess: (_data, variables) => {
      if (variables.dryRun) return;
      done([
        HindsightKeys.memories(bank),
        HindsightKeys.documents(bank),
        HindsightKeys.stats(bank),
        HindsightKeys.operations(bank),
        HindsightKeys.worker(),
      ]);
    },
    onError: failed,
  });
};

export const useCreateAlias = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: ({ alias, canonical }: { alias: string; canonical: string }) =>
      hindsightService.createAlias(bank, { alias, canonical }),
    onSuccess: () =>
      done([HindsightKeys.aliases(bank), HindsightKeys.status()]),
    onError: failed,
  });
};

export const useDeleteAlias = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: (alias: string) => hindsightService.deleteAlias(bank, alias),
    onSuccess: () => done([HindsightKeys.aliases(bank)]),
    onError: failed,
  });
};

export const useCreateWebhook = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: ({ url, events }: { url: string; events: string[] }) =>
      hindsightService.createWebhook(bank, { url, events }),
    onSuccess: () => done([HindsightKeys.webhooks(bank)]),
    onError: failed,
  });
};

export const useDeleteWebhook = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: (webhookId: string) =>
      hindsightService.deleteWebhook(bank, webhookId),
    onSuccess: () => done([HindsightKeys.webhooks(bank)]),
    onError: failed,
  });
};

export const useToggleWebhook = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      hindsightService.toggleWebhook(bank, id, active),
    onSuccess: () => done([HindsightKeys.webhooks(bank)]),
    onError: failed,
  });
};

export const useTestWebhook = (bank: string) => {
  const { failed } = useAction();
  return useMutation({
    mutationFn: (webhookId: string) =>
      hindsightService.testWebhook(bank, webhookId),
    onError: failed,
  });
};

export const usePruneMemory = (bank: string) => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: (days: number) =>
      hindsightService.prune(bank, { days, dry_run: false }),
    onSuccess: () =>
      done([
        HindsightKeys.memories(bank),
        HindsightKeys.documents(bank),
        HindsightKeys.operations(bank),
        HindsightKeys.stats(bank),
      ]),
    onError: failed,
  });
};

export const useRunMaintenance = () => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: () => hindsightService.maintenance(),
    onSuccess: () => done([HindsightKeys.worker()]),
    onError: failed,
  });
};

export const useStartWorker = () => {
  const { done, failed } = useAction();
  return useMutation({
    mutationFn: () => hindsightService.startWorker(),
    onSuccess: () => done([HindsightKeys.worker()]),
    onError: failed,
  });
};
