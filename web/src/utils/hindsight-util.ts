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

type RecordLike = Record<string, unknown>;

export const isRecord = (value: unknown): value is RecordLike =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Hindsight sometimes answers with a bare list and sometimes wraps it in an
 * envelope ({ memories: [...] }, { pages: [...] }, ...). Accept both shapes so
 * a remote version bump does not blank the console.
 */
export const asArray = <T,>(payload: unknown, keys: string[]): T[] => {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (!isRecord(payload)) {
    return [];
  }
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value as T[];
    }
  }
  for (const key of [...keys, 'data', 'result', 'results']) {
    const value = payload[key];
    if (isRecord(value)) {
      const nested = asArray<T>(value, keys);
      if (nested.length) {
        return nested;
      }
    }
  }
  return [];
};

/** Picks the object under a wrapper key, falling back to the payload itself. */
export const asRecord = (payload: unknown, keys: string[] = []): RecordLike => {
  if (!isRecord(payload)) {
    return {};
  }
  for (const key of keys) {
    const value = payload[key];
    if (isRecord(value)) {
      return value;
    }
  }
  return payload;
};

/** Total record count, tolerating the different counters Hindsight reports. */
export const asCount = (payload: unknown): number | undefined => {
  const record = asRecord(payload);
  for (const key of ['total', 'count', 'total_count']) {
    const value = record[key];
    if (typeof value === 'number') {
      return value;
    }
  }
  return undefined;
};

export const memoryText = (memory: {
  text?: string;
  content?: string;
}): string => memory.text || memory.content || '';

export const memoryScore = (memory: {
  score?: number;
  scores?: Record<string, number>;
}): number => {
  if (typeof memory.score === 'number') {
    return memory.score;
  }
  const scores = memory.scores ?? {};
  return scores.final ?? scores.rerank ?? scores.semantic ?? 0;
};

export const formatTime = (value?: string | number) => {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export const prettyJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};
