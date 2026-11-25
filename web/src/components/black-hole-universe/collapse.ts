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

/**
 * The hole is drawn inside the overview tab, but the tab change belongs to the
 * page. This one-slot bridge lets the page ask the drawing to fall in before it
 * swaps the content, without either side importing the other.
 */
type Collapse = () => Promise<void>;

let handler: Collapse | null = null;

export const setBlackHoleCollapse = (next: Collapse) => {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
};

/** Resolves once the hole has swallowed the frame; immediate when there is none. */
export const collapseBlackHole = () => (handler ? handler() : Promise.resolve());
