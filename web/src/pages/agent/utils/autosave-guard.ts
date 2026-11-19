// Autosave policy for the agent canvas.
//
// The canvas debounces a save on every nodes/edges change. Two cases
// must never reach the server:
//
//  1. The save fires before the agent detail has loaded. The store is
//     still empty at that point, so the payload is a blank canvas.
//  2. The loaded DSL carries a definition (nodes or components) but
//     the store is empty. That is either a render failure or a row the
//     canvas could not reconstruct; writing it back destroys the
//     stored topology — which is exactly how a components-only team
//     canvas got wiped.
//
// An intentionally cleared canvas is not covered by rule 2: clearing
// every node leaves the stored DSL empty too, so the guard lets the
// save through.

import { DSL } from '@/interfaces/database/agent';

export interface AutosaveGuardInput {
  /** The run drawer is open; the canvas is being executed, not edited. */
  chatDrawerVisible: boolean;
  /** The agent detail request has resolved at least once. */
  detailLoaded: boolean;
  /** Number of nodes currently in the canvas store. */
  nodeCount: number;
  /** The DSL last received from the server. */
  storedDsl?: Partial<DSL> | null;
}

const storedDefinitionSize = (storedDsl?: Partial<DSL> | null): number => {
  const nodeCount = storedDsl?.graph?.nodes?.length ?? 0;
  const componentCount = Object.keys(storedDsl?.components ?? {}).length;
  return Math.max(nodeCount, componentCount);
};

/**
 * Whether the debounced canvas autosave must be skipped for this tick.
 */
export const shouldSkipAgentAutosave = ({
  chatDrawerVisible,
  detailLoaded,
  nodeCount,
  storedDsl,
}: AutosaveGuardInput): boolean => {
  if (chatDrawerVisible) return true;
  if (!detailLoaded) return true;
  if (nodeCount === 0 && storedDefinitionSize(storedDsl) > 0) return true;
  return false;
};
