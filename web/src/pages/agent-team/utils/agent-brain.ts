import { DSL } from '@/interfaces/database/agent';

/* ── what an existing agent is, as a worker ────────────────
   A collaboration is assembled out of agents that already exist, not authored
   inline as one more team. So the picker does not ask for a prompt and a model:
   it reads them off the agent you picked.

   An agent canvas has exactly one node that is its brain — the Agent operator,
   or Generate on an older canvas. Its params (llm_id, sys_prompt, prompts,
   temperature, tools) are what the worker should run with, so they are lifted
   whole rather than re-typed. */
const BRAIN_COMPONENTS = ['Agent', 'Generate'];

export const extractAgentParams = (
  dsl?: Partial<DSL> | null,
): Record<string, unknown> | null => {
  const components = dsl?.components;
  if (!components || typeof components !== 'object') return null;

  const nodes = Object.values(components).filter(
    (node) => !!node?.obj?.params && typeof node.obj.params === 'object',
  );

  const named = BRAIN_COMPONENTS.map((name) =>
    nodes.find((node) => node.obj.component_name === name),
  ).find(Boolean);

  /* An agent that talks to the user through a Message node has a brain; one
     built only from retrieval steps does not, and falls back to whatever node
     actually carries a model. */
  const withModel = nodes.find(
    (node) => typeof (node.obj.params as Record<string, unknown>).llm_id === 'string',
  );

  const brain = named ?? withModel;
  return brain ? { ...(brain.obj.params as Record<string, unknown>) } : null;
};
