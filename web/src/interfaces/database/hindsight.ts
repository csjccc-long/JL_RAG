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

/** Status reported by GET /v1/hindsight/status. */
export interface HindsightStatus {
  enabled: boolean;
  backend: string;
  db_path: string;
  bank: string;
  budget: string;
  max_tokens: number;
  top_k: number;
  retain_async: boolean;
  prefer_observations: boolean;
  defense: boolean;
  consolidate_after: number;
  chunk_chars?: number;
  /** Where embeddings live: 'elasticsearch' or 'sqlite'. */
  vector_backend?: string;
  /** Index name, or a prefix with <tenant> when no tenant is in scope. */
  vector_index?: string;
  vector_dirty?: boolean;
  healthy: boolean;
  health?: unknown;
  error?: string;
}

export interface RecalledMemory {
  id: string;
  text: string;
  type?: string;
  score?: number;
  document_id?: string;
  mentioned_at?: string;
  tags?: string[];
  scores?: Record<string, number>;
}

export interface HindsightMemory {
  id: string;
  text?: string;
  content?: string;
  type?: string;
  kind?: string;
  context?: string;
  document_id?: string;
  chunk_id?: string;
  tags?: string[];
  source_fact_ids?: string[];
  evidence?: HindsightMemory[];
  mentioned_at?: string;
  occurred_start?: string;
  occurred_end?: string;
  created_at?: string;
  proof_count?: number;
  metadata?: Record<string, unknown>;
}

export interface ObservationGroup {
  scope?: string;
  observations?: HindsightMemory[];
}

export interface ObservationTree {
  groups?: ObservationGroup[];
  total?: number;
}

export interface HindsightBank {
  bank_id?: string;
  id?: string;
  name?: string;
  mission?: string;
  memory_count?: number;
  created_at?: string;
}

export interface MentalModel {
  id: string;
  name?: string;
  source_query?: string;
  content?: string;
  updated_at?: string;
}

export interface KnowledgePage {
  id: string;
  title?: string;
  content?: string;
  parent_id?: string;
  path?: string;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
}

/** A retained document: the raw text the facts were extracted from. */
export interface HindsightDocument {
  document_id: string;
  content?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface Directive {
  id: string;
  content?: string;
  text?: string;
  priority?: number;
  tags?: string[];
}

export interface HindsightOperation {
  id: string;
  kind?: string;
  status?: string;
  attempts?: number;
  error?: string;
  operation_type?: string;
  type?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ReflectResult {
  answer?: string;
  text?: string;
  memories?: RecalledMemory[];
  facts?: RecalledMemory[];
  [key: string]: unknown;
}

/** alias -> canonical entity name, so one person is not three nodes. */
export interface HindsightAlias {
  alias: string;
  canonical: string;
  created_at?: string;
}

export interface HindsightWebhook {
  id: string;
  url: string;
  events?: string[];
  secret?: string;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface HindsightDelivery {
  id: string;
  webhook_id?: string;
  event?: string;
  status?: string;
  attempts?: number;
  response_code?: number | null;
  error?: string;
  created_at?: string;
  updated_at?: string;
}

export interface HindsightQueueStatus {
  started: boolean;
  concurrency: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
  operations: Record<string, number>;
}

export interface HindsightWorker {
  worker: HindsightQueueStatus;
  scheduler: {
    started: boolean;
    refresh_hours: number;
    consolidate_minutes: number;
    last_run: string;
    last_error: string;
    refreshed: number;
    consolidated: number;
  };
}

/** What one upload produced: text was read, chunked and (unless previewed) stored. */
export interface HindsightIngestResult {
  filename: string;
  chars: number;
  chunks: number;
  preview?: string;
  queued?: string[];
  dry_run: boolean;
}
