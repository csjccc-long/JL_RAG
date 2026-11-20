import { DSL, IAgentTeamWorker } from '@/interfaces/database/agent';

/* ── write the crew back into the team's own definition ────
   The team node keeps its params in two places: the component (what the
   backend runs) and the graph node's form (what the canvas shows). Both are
   written from the same array so the canvas and the board never disagree about
   who is on the team. */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const applyTeamWorkers = (
  dsl: Partial<DSL> | null | undefined,
  componentId: string,
  workers: IAgentTeamWorker[],
): DSL => {
  const next = clone((dsl ?? {}) as DSL);
  const operator = next.components?.[componentId];
  if (operator?.obj?.params) {
    (operator.obj.params as Record<string, unknown>).workers = clone(workers);
  }

  const nodes = next.graph?.nodes ?? [];
  nodes.forEach((node) => {
    if (node.id !== componentId) return;
    const form = node.data?.form as Record<string, unknown> | undefined;
    if (form) form.workers = clone(workers);
  });

  return next;
};
