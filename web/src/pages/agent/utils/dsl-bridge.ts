// DSL bridge — single wire shape for the agent canvas.
//
// The RAGFlow agent DSL has exactly one canonical wire shape, used
// for every operation (PUT/GET/create/export/import):
//
//   {
//     "globals":    {...},
//     "graph":      { "nodes": [...], "edges": [...] },   // React-Flow
//     "variables":  {...},
//     "components": { "<Name>:<UUID>": {                   // execution topology
//       "downstream": [...], "upstream": [...],
//       "obj": { "component_name": "Name", "params": {...} }
//     }},
//     "path": [...], "retrieval": {...}, "history": [...]
//   }
//
// `graph` is React-Flow's layout surface (positions, source/target
// handles). `components` is the topology the engine executes. The
// front-end rebuilds `components` from `graph` on every save so the
// two stay in lockstep; the back-end reads `components` only and
// ignores `graph`.
//
// `importDsl` reads the canonical `graph` block from a parsed
// import file. `_layout` is intentionally NOT consumed here — it
// was a one-shot import-time hint that historical v1 export files
// used to carry canvas positions, and it has not been a wire
// contract field since the v1/v2 split was removed. A payload with
// `_layout` but no `graph` (or with neither) falls through to the
// empty seed.

import { Edge, Position } from '@xyflow/react';

import { EmptyDsl, Operator } from '@/constants/agent';
import {
  DSL,
  DSLComponents,
  GlobalVariableType,
  IOperator,
  RAGFlowNodeType,
} from '@/interfaces/database/agent';
import { DataflowEmptyDsl } from '@/pages/agent/empty-dsl';

import { NodeMap } from '../constant';
import { buildDslComponentsByGraph, buildDslGlobalVariables } from '../utils';

const LEGACY_ITERATION_NODE_TYPE = 'group';
const ITERATION_NODE_TYPE = 'iterationNode';

const normalizeGraphNodes = (nodes: RAGFlowNodeType[]): RAGFlowNodeType[] =>
  nodes.map((node) => {
    if (
      node?.data?.label === Operator.Iteration &&
      node.type === LEGACY_ITERATION_NODE_TYPE
    ) {
      return {
        ...node,
        type: ITERATION_NODE_TYPE,
      };
    }

    return node;
  });

// ─── Public API ─────────────────────────────────────────────────────────

/** Initial empty DSL for a new canvas. `isAgent` picks agent vs dataflow seed. */
export const initialEmptyDsl = (isAgent: boolean): DSL =>
  isAgent ? (EmptyDsl as unknown as DSL) : (DataflowEmptyDsl as unknown as DSL);

/**
 * Convert a parsed JSON object from a user-uploaded file into a
 * renderable DSL. Caller must have already parsed the file (we take
 * the object, not the string). `isAgent` is the form-level flag, not
 * re-inferred here.
 *
 * Reads the canonical `graph` block from a parsed import file.
 * `raw.graph.nodes` must be present and non-empty for the input
 * to be rendered as-is; anything else falls through to the empty
 * seed (an empty canvas).
 *
 * `_layout` is NOT read — that field was a one-shot import-time
 * hint in historical v1 export files and is no longer part of the
 * wire contract. A payload that carries `_layout` (and nothing
 * else) is treated the same as an empty file.
 */
export const importDsl = (
  rawParsed: Record<string, any>,
  isAgent: boolean,
): DSL => {
  const seed = isAgent ? EmptyDsl : DataflowEmptyDsl;

  // Single precedence level: `raw.graph.nodes` is the canonical
  // wire shape. Every DSL the back-end returns has a populated
  // `graph` block, so anything else (a `_layout`-only payload from
  // a stale test fixture, a `components`-only payload from a
  // third-party tool, an empty file) falls through to the empty
  // seed.
  let graph: { nodes: RAGFlowNodeType[]; edges: Edge[] };
  let components: DSLComponents;

  if (Array.isArray(rawParsed?.graph?.nodes)) {
    const rawEdges = rawParsed.graph.edges;
    const edges: Edge[] = Array.isArray(rawEdges) ? rawEdges : [];
    graph = {
      nodes: normalizeGraphNodes(rawParsed.graph.nodes as RAGFlowNodeType[]),
      edges,
    };
    components =
      (rawParsed.components as DSLComponents | undefined) ??
      (buildDslComponentsByGraph(
        graph.nodes,
        graph.edges,
        seed.components as DSLComponents,
      ) as DSLComponents);
  } else {
    graph = { nodes: [], edges: [] };
    components = seed.components as DSLComponents;
  }

  return {
    ...seed,
    graph,
    components,
    retrieval: rawParsed.retrieval ?? seed.retrieval,
    history: rawParsed.history ?? seed.history,
    path: rawParsed.path ?? seed.path,
    variables: rawParsed.variables ?? seed.variables,
    globals: rawParsed.globals ?? seed.globals,
  } as unknown as DSL;
};

const COMPONENT_COLUMN_GAP = 320;
const COMPONENT_ROW_GAP = 180;

/** Display name of a component node: the part after the `:` in its id. */
const componentNodeName = (componentId: string): string => {
  const [, name] = componentId.split(':');
  return name || componentId;
};

/**
 * Rebuild a React-Flow graph from a components-only DSL.
 *
 * Rows written by the canvas always carry `graph` (React-Flow layout)
 * *and* `components` (execution topology), but topology can also
 * arrive alone — a canvas created through the HTTP API, an imported
 * file produced by a third-party tool, or a row seeded straight into
 * the database. Without a graph such a canvas rendered blank and the
 * debounced autosave then persisted that blank canvas, destroying the
 * team definition. This reconstructs a left-to-right layout from the
 * topology so the canvas shows (and can still re-save) those rows.
 */
export const componentsToGraph = (
  components: DSLComponents | undefined,
): { nodes: RAGFlowNodeType[]; edges: Edge[] } => {
  const componentIds = Object.keys(components ?? {});
  if (componentIds.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Breadth-first layering from the roots (components with no upstream
  // inside this DSL) keeps the layout readable left-to-right.
  const layerOf = new Map<string, number>();
  const roots = componentIds.filter((id) => {
    const upstream = components?.[id]?.upstream ?? [];
    return upstream.every((parent) => !components?.[parent]);
  });
  const queue = roots.length > 0 ? [...roots] : [componentIds[0]];
  queue.forEach((id) => layerOf.set(id, 0));
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const layer = layerOf.get(id) ?? 0;
    for (const next of components?.[id]?.downstream ?? []) {
      if (!components?.[next] || layerOf.has(next)) continue;
      layerOf.set(next, layer + 1);
      queue.push(next);
    }
  }
  // Unreachable components (cycles, or upstream pointing at a missing
  // id) each get their own column instead of piling onto column 0.
  let spillColumn = layerOf.size > 0 ? Math.max(...layerOf.values()) + 1 : 0;
  for (const id of componentIds) {
    if (!layerOf.has(id)) layerOf.set(id, spillColumn++);
  }

  const rowCursor = new Map<number, number>();
  const nodes = componentIds.map((id) => {
    const layer = layerOf.get(id) ?? 0;
    const row = rowCursor.get(layer) ?? 0;
    rowCursor.set(layer, row + 1);
    const obj = components?.[id]?.obj;
    const label = obj?.component_name ?? id.split(':')[0];
    return {
      id,
      type: NodeMap[label as Operator] || 'ragNode',
      position: { x: layer * COMPONENT_COLUMN_GAP, y: row * COMPONENT_ROW_GAP },
      data: {
        label,
        name: componentNodeName(id),
        form: obj?.params ?? {},
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    } as RAGFlowNodeType;
  });

  const edges: Edge[] = [];
  for (const id of componentIds) {
    for (const target of components?.[id]?.downstream ?? []) {
      if (!components?.[target]) continue;
      edges.push({
        id: `xy-edge__${id}start-${target}end`,
        source: id,
        sourceHandle: 'start',
        target,
        targetHandle: 'end',
      } as Edge);
    }
  }

  return { nodes, edges };
};

/**
 * Convert a server-returned DSL into the React-Flow `{nodes, edges}`
 * shape the store consumes. Reads `dsl.graph` first; a DSL that
 * carries only `components` is laid out from its topology by
 * `componentsToGraph` so those rows render instead of opening blank.
 */
export const dslToGraph = (
  dsl: DSL,
): { nodes: RAGFlowNodeType[]; edges: Edge[] } => {
  // Canvas-saved rows always carry `graph` (layout) and
  // `components` (topology). A components-only row — created through
  // the HTTP API, imported from a third-party file, or seeded straight
  // into the database — used to fall through to an empty canvas; the
  // debounced autosave then persisted that empty graph and wiped the
  // definition. Fall back to the topology so those rows render.
  const graphNodes = dsl?.graph?.nodes;
  if (Array.isArray(graphNodes) && graphNodes.length > 0) {
    const rawEdges = dsl?.graph?.edges;
    return {
      nodes: normalizeGraphNodes(graphNodes as RAGFlowNodeType[]),
      edges: (Array.isArray(rawEdges) ? rawEdges : []) as Edge[],
    };
  }
  return componentsToGraph(dsl?.components as DSLComponents | undefined);
};

/**
 * Build a fresh DSL from the current React-Flow state. Emits
 * `graph` + `components` plus a spread of the previous DSL for any
 * untouched fields (`messages`, `path`, `retrieval`, etc.).
 */
export const graphToDsl = (
  currentNodes: RAGFlowNodeType[],
  currentEdges: Edge[],
  oldDsl: DSL,
  globalVariables?: Record<string, GlobalVariableType>,
): DSL => {
  const filteredNodes = currentNodes.filter(
    (n) => n.data?.label !== Operator.Placeholder,
  );
  const filteredEdges = currentEdges.filter((edge) => {
    const s = currentNodes.find((n) => n.id === edge.source);
    const t = currentNodes.find((n) => n.id === edge.target);
    return (
      s?.data?.label !== Operator.Placeholder &&
      t?.data?.label !== Operator.Placeholder
    );
  });

  const dslComponents = buildDslComponentsByGraph(
    filteredNodes,
    filteredEdges,
    oldDsl?.components ?? {},
  );
  const globals = buildDslGlobalVariables(
    oldDsl ?? ({} as DSL),
    globalVariables,
  );

  return {
    ...oldDsl,
    ...globals,
    graph: { nodes: filteredNodes, edges: filteredEdges },
    components: dslComponents,
  };
};

/**
 * Build a downloadable JSON for the export button. Returns the
 * conventional wire shape (`graph` + `components` + `globals` +
 * `variables` + spread of any untouched fields). The caller is
 * responsible for stripping sensitive fields (api_key) before
 * handing the result to the file writer.
 */
export const exportDsl = (
  currentNodes: RAGFlowNodeType[],
  currentEdges: Edge[],
  oldDsl: DSL,
  globalVariables?: Record<string, GlobalVariableType>,
): Record<string, any> => {
  return graphToDsl(
    currentNodes,
    currentEdges,
    oldDsl,
    globalVariables,
  ) as Record<string, any>;
};

/**
 * Detect whether an imported JSON is a dataflow canvas. Looks at
 * both shapes (v1 components / v2 graph.nodes) for the dataflow
 * markers ("File" begin + "Parser"). Defaults to `true` (agent)
 * when ambiguous.
 */
export const inferIsAgentFromImport = (raw: Record<string, any>): boolean => {
  const graph = raw?.graph;
  if (graph && Array.isArray(graph.nodes)) {
    const labels = (graph.nodes as any[]).map((n: any) => n?.data?.label);
    if (labels.includes(Operator.File) && labels.includes(Operator.Parser)) {
      return false;
    }
    return true;
  }
  // No `graph` block — treat as agent. The strict-graph
  // import contract in `importDsl` already handles the
  // empty-payload case elsewhere.
  return true;
};

export type { IOperator };
