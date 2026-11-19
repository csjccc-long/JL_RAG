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

import type {
  Directive,
  HindsightAlias,
  HindsightBank,
  HindsightDocument,
  HindsightIngestResult,
  HindsightMemory,
  HindsightOperation,
  HindsightStatus,
  HindsightWebhook,
  HindsightWorker,
  KnowledgePage,
  MentalModel,
  RecalledMemory,
  ReflectResult,
} from '@/interfaces/database/hindsight';
import api from '@/utils/api';
import request from '@/utils/next-request';

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

/**
 * Every Hindsight route answers with the usual { code, message, data } envelope.
 * Unwrap it once here so pages and hooks work with plain payloads.
 */
const read = async <T>(call: Promise<{ data: Envelope<T> }>): Promise<T> => {
  const response = await call;
  const body = response?.data;
  if (!body || body.code !== 0) {
    throw new Error(body?.message || 'Hindsight request failed');
  }
  return body.data;
};

const query = async <T>(url: string, params?: Record<string, unknown>) =>
  read<T>(request.get(url, { params }));

const post = async <T>(url: string, body?: Record<string, unknown>) =>
  read<T>(request.post(url, body ?? {}));

const patch = async <T>(url: string, body?: Record<string, unknown>) =>
  read<T>(request.patch(url, body ?? {}));

const remove = async <T>(url: string, params?: Record<string, unknown>) =>
  read<T>(request.delete(url, { params }));

const hindsightService = {
  status: () => query<HindsightStatus>(api.hindsightStatus),

  banks: () => query<HindsightBank[]>(api.hindsightBanks),
  createBank: (body: Record<string, unknown>) =>
    post<HindsightBank>(api.hindsightBanks, body),
  deleteBank: (bank: string) => remove<unknown>(api.hindsightBank(bank)),

  config: (bank: string) => query<Record<string, unknown>>(api.hindsightConfig(bank)),
  patchConfig: (bank: string, body: Record<string, unknown>) =>
    patch<Record<string, unknown>>(api.hindsightConfig(bank), body),
  stats: (bank: string) => query<Record<string, unknown>>(api.hindsightStats(bank)),
  tags: (bank: string) => query<unknown>(api.hindsightTags(bank)),

  recall: (bank: string, body: Record<string, unknown>) =>
    post<{ memories?: RecalledMemory[]; results?: RecalledMemory[] }>(
      api.hindsightRecall(bank),
      body,
    ),
  listMemories: (bank: string, params?: Record<string, unknown>) =>
    query<unknown>(api.hindsightMemoryList(bank), params),
  retain: (bank: string, body: Record<string, unknown>) =>
    post<unknown>(api.hindsightRetain(bank), body),
  dryRunExtract: (bank: string, body: Record<string, unknown>) =>
    post<unknown>(api.hindsightDryRunExtract(bank), body),
  memoryHistory: (bank: string, memoryId: string) =>
    query<unknown>(api.hindsightMemoryHistory(bank, memoryId)),
  deleteMemory: (bank: string, memoryId: string) =>
    remove<unknown>(api.hindsightMemory(bank, memoryId)),
  updateMemory: (bank: string, memoryId: string, body: Record<string, unknown>) =>
    patch<unknown>(api.hindsightMemory(bank, memoryId), body),

  reflect: (bank: string, body: Record<string, unknown>) =>
    post<ReflectResult>(api.hindsightReflect(bank), body),
  promptPreview: (bank: string, body: Record<string, unknown>) =>
    post<unknown>(api.hindsightPromptPreview(bank), body),

  observationsTree: (bank: string) =>
    query<unknown>(api.hindsightObservationsTree(bank)),
  consolidate: (bank: string, body?: Record<string, unknown>) =>
    post<unknown>(api.hindsightConsolidate(bank), body),
  consolidationPreview: (bank: string, body: Record<string, unknown>) =>
    post<unknown>(api.hindsightConsolidationPreview(bank), body),

  mentalModels: (bank: string) => query<unknown>(api.hindsightMentalModels(bank)),
  createMentalModel: (bank: string, body: Record<string, unknown>) =>
    post<MentalModel>(api.hindsightMentalModels(bank), body),
  updateMentalModel: (bank: string, modelId: string, body: Record<string, unknown>) =>
    patch<MentalModel>(api.hindsightMentalModel(bank, modelId), body),
  deleteMentalModel: (bank: string, modelId: string) =>
    remove<unknown>(api.hindsightMentalModel(bank, modelId)),
  refreshMentalModel: (bank: string, modelId: string, body?: Record<string, unknown>) =>
    post<unknown>(api.hindsightMentalModelRefresh(bank, modelId), body),
  clearMentalModel: (bank: string, modelId: string) =>
    post<unknown>(api.hindsightMentalModelClear(bank, modelId)),
  mentalModelHistory: (bank: string, modelId: string) =>
    query<unknown>(api.hindsightMentalModelHistory(bank, modelId)),

  pages: (bank: string, params?: Record<string, unknown>) =>
    query<unknown>(api.hindsightPages(bank), params),
  pagesTree: (bank: string) => query<unknown>(api.hindsightPagesTree(bank)),
  searchPages: (bank: string, body: Record<string, unknown>) =>
    post<{ pages?: KnowledgePage[]; results?: KnowledgePage[] }>(
      api.hindsightPagesSearch(bank),
      body,
    ),
  page: (bank: string, pageId: string) =>
    query<KnowledgePage>(api.hindsightPage(bank, pageId)),
  createPage: (bank: string, body: Record<string, unknown>) =>
    post<KnowledgePage>(api.hindsightPages(bank), body),
  deletePage: (bank: string, pageId: string) =>
    remove<unknown>(api.hindsightPage(bank, pageId)),

  directives: (bank: string) => query<unknown>(api.hindsightDirectives(bank)),
  createDirective: (bank: string, body: Record<string, unknown>) =>
    post<Directive>(api.hindsightDirectives(bank), body),
  deleteDirective: (bank: string, directiveId: string) =>
    remove<unknown>(api.hindsightDirective(bank, directiveId)),

  documents: (bank: string, params?: Record<string, unknown>) =>
    query<unknown>(api.hindsightDocuments(bank), params),
  document: (bank: string, documentId: string) =>
    query<HindsightDocument>(api.hindsightDocument(bank, documentId)),
  deleteDocument: (bank: string, documentId: string) =>
    remove<unknown>(api.hindsightDocument(bank, documentId)),

  operations: (bank: string) => query<unknown>(api.hindsightOperations(bank)),
  cancelOperation: (bank: string, operationId: string) =>
    post<unknown>(api.hindsightOperationCancel(bank, operationId)),
  retryOperation: (bank: string, operationId: string) =>
    post<unknown>(api.hindsightOperationRetry(bank, operationId)),

  auditLogs: (bank: string, params?: Record<string, unknown>) =>
    query<unknown>(api.hindsightAuditLogs(bank), params),
  llmRequests: (bank: string, params?: Record<string, unknown>) =>
    query<unknown>(api.hindsightLlmRequests(bank), params),

  ingest: (bank: string, formData: FormData) =>
    read<HindsightIngestResult>(request.post(api.hindsightIngest(bank), formData)),
  prune: (bank: string, body: Record<string, unknown>) =>
    post<Record<string, number>>(api.hindsightPrune(bank), body),

  worker: () => query<HindsightWorker>(api.hindsightWorker),
  startWorker: () => post<HindsightWorker>(api.hindsightWorkerStart),
  maintenance: () => post<Record<string, number>>(api.hindsightMaintenance),

  aliases: (bank: string) => query<unknown>(api.hindsightAliases(bank)),
  createAlias: (bank: string, body: Record<string, unknown>) =>
    post<HindsightAlias>(api.hindsightAliases(bank), body),
  deleteAlias: (bank: string, alias: string) =>
    remove<unknown>(api.hindsightAlias(bank, alias)),

  webhooks: (bank: string) => query<unknown>(api.hindsightWebhooks(bank)),
  createWebhook: (bank: string, body: Record<string, unknown>) =>
    post<HindsightWebhook>(api.hindsightWebhooks(bank), body),
  deleteWebhook: (bank: string, webhookId: string) =>
    remove<unknown>(api.hindsightWebhook(bank, webhookId)),
  toggleWebhook: (bank: string, webhookId: string, active: boolean) =>
    patch<unknown>(api.hindsightWebhook(bank, webhookId), { active }),
  webhookDeliveries: (bank: string, webhookId: string, params?: Record<string, unknown>) =>
    query<unknown>(api.hindsightWebhookDeliveries(bank, webhookId), params),
  testWebhook: (bank: string, webhookId: string) =>
    post<{ status?: number; body?: string }>(api.hindsightWebhookTest(bank, webhookId)),
};

export type { HindsightMemory, HindsightOperation };

export default hindsightService;
