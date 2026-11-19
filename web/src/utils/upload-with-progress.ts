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

import { Authorization } from '@/constants/authorization';
import { getAuthorization } from '@/utils/authorization-util';

/* The request layer is fetch based (umi-request) and cannot report how much
   of a body has left the browser, so an upload that wants to show its
   progress has to go through XMLHttpRequest. Everything else about the
   request is deliberately the same: a POST, the same FormData, and the same
   Authorization header the interceptors would have added. */

export interface UploadResponseBody<T = unknown> {
  code?: number;
  message?: string;
  data?: T;
}

export interface PostFormOptions {
  url: string;
  formData: FormData;
  /** 0..99 while the body is going out, never 100 — that is the server.
   * answering, and the caller should only see 100 once it has. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

const parseBody = <T,>(text: string): UploadResponseBody<T> | null => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const postFormWithProgress = <T,>(
  options: PostFormOptions,
): Promise<UploadResponseBody<T>> => {
  const { url, formData, onProgress, signal } = options;

  return new Promise<UploadResponseBody<T>>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('POST', url, true);
    try {
      xhr.setRequestHeader(Authorization, getAuthorization());
    } catch {
      // A blank token is the backend's problem to report, not ours to throw.
    }

    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable || event.total <= 0) {
        return;
      }
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onload = () => {
      const body = parseBody<T>(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(
          body ?? {
            code: -1,
            message: `Unexpected response (HTTP ${xhr.status})`,
          },
        );
        return;
      }
      reject(new Error(body?.message || `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.onabort = () => reject(new Error('Upload aborted'));

    if (signal) {
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(formData);
  });
};

export default postFormWithProgress;
