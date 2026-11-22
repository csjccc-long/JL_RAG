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

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import MemoryDrawer from '@/components/memory-drawer';
import MemorySky from '@/components/memory-sky';
import { OrbitalUniverse, StarKey } from '@/components/orbital-universe';

import './orbital-tab.css';

export type OrbitalFeature = {
  key: string;
  /** Planet label and the drawer's grip text. */
  label: string;
};

const ActiveFeature = createContext<string>('');

type OrbitalPanelProps = {
  /** Must match the feature key this panel belongs to. */
  id: string;
  children: ReactNode;
};

/**
 * One feature's controls. Every panel stays mounted so half-typed text
 * survives a trip to another planet; only the active one is drawn.
 */
export const OrbitalPanel = ({ id, children }: OrbitalPanelProps) => {
  const active = useContext(ActiveFeature);
  return (
    <div className="orbital-panel" data-active={active === id ? 'on' : 'off'}>
      {children}
    </div>
  );
};

type OrbitalTabProps = {
  /** Which module this console tab is, so the flight starts from its star. */
  starKey: StarKey;
  hint: string;
  /** Shown on the grip before a planet is picked. */
  drawerLabel: string;
  features: OrbitalFeature[];
  children: ReactNode;
};

/**
 * A console tab drawn as a small universe: the module is the star at the
 * centre, its features are planets on the ring, and a feature's controls slide
 * out of the right edge when its planet is hovered or clicked.
 */
const OrbitalTab = ({
  starKey,
  hint,
  drawerLabel,
  features,
  children,
}: OrbitalTabProps) => {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [shownKey, setShownKey] = useState<string>(features[0]?.key ?? '');
  const activeKey = pinnedKey ?? hoverKey;

  // The panel outlives the hover, so the drawer does not go blank while it
  // slides shut.
  useEffect(() => {
    if (activeKey) setShownKey(activeKey);
  }, [activeKey]);

  const planets = useMemo(
    () => features.map((item) => ({ key: item.key, label: item.label })),
    [features],
  );
  const shown = features.find((item) => item.key === shownKey) ?? null;

  const handleHover = useCallback((key: string) => setHoverKey(key), []);
  const handleSelect = useCallback((key: string) => {
    setPinnedKey((previous) => (previous === key ? null : key));
  }, []);
  const handleTogglePinned = useCallback(() => {
    setPinnedKey((previous) => (previous ? null : hoverKey));
  }, [hoverKey]);
  const handleLeave = useCallback(() => setHoverKey(null), []);

  return (
    <MemorySky className="orbital-tab" onPointerLeave={handleLeave}>
      <OrbitalUniverse
        starKey={starKey}
        planets={planets}
        activeKey={activeKey ?? shownKey}
        onHover={handleHover}
        onSelect={handleSelect}
      />
      <p className="memory-sky__hint">{hint}</p>
      <MemoryDrawer
        label={shown ? shown.label : drawerLabel}
        pinned={Boolean(pinnedKey)}
        open={Boolean(activeKey)}
        onTogglePinned={handleTogglePinned}
      >
        <ActiveFeature.Provider value={shownKey}>
          {children}
        </ActiveFeature.Provider>
      </MemoryDrawer>
    </MemorySky>
  );
};

export default OrbitalTab;