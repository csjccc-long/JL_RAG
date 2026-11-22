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

import { ReactNode } from 'react';

import './memory-drawer.css';

type MemoryDrawerProps = {
  /** Text on the vertical grip: what is behind it right now. */
  label: string;
  pinned: boolean;
  /** Opened without hover, for a view that opens it from an outside control. */
  open?: boolean;
  onTogglePinned: () => void;
  children: ReactNode;
};

/**
 * The console's one way of showing details: a drawer that lives on the right
 * edge, keeps out of the picture until asked, and scrolls on its own when the
 * content is taller than the page.
 */
const MemoryDrawer = ({
  label,
  pinned,
  open = false,
  onTogglePinned,
  children,
}: MemoryDrawerProps) => {
  return (
    <aside
      className="memory-drawer"
      data-pinned={pinned ? 'on' : 'off'}
      data-open={open ? 'on' : 'off'}
    >
      <button
        type="button"
        className="memory-drawer__grip"
        onClick={onTogglePinned}
        aria-expanded={pinned || open}
        aria-controls="memory-drawer-panel"
      >
        <span className="memory-drawer__grip-text">{label}</span>
      </button>
      <div className="memory-drawer__panel" id="memory-drawer-panel">
        <div className="memory-drawer__body">{children}</div>
      </div>
    </aside>
  );
};

export default MemoryDrawer;