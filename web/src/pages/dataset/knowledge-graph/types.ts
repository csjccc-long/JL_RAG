export type ChunkGraphNodeType =
  | 'document'
  | 'part'
  | 'chapter'
  | 'section'
  | 'article'
  | 'chunk'
  | 'sentence'
  | 'keyword'
  | 'entity';

export interface ChunkGraphNode {
  id: string;
  label: string;
  type: ChunkGraphNodeType | string;
  description?: string;
  weight?: number;
  doc_id?: string;
  doc_name?: string;
  order?: number;
  page?: number;
  value?: number;
  chunk_index?: number;
  level?: number;
  number?: string;
}

export interface ChunkGraphEdge {
  id?: string;
  source: string;
  target: string;
  type?: string;
  weight?: number;
}

export interface ChunkGraphDocument {
  id: string;
  name: string;
  chunk_count: number;
}

export interface ChunkGraphStats {
  documents?: number;
  chapters?: number;
  articles?: number;
  chunks?: number;
  sentences?: number;
  keywords?: number;
  nodes?: number;
  edges?: number;
}

export interface ChunkGraphData {
  nodes: ChunkGraphNode[];
  edges: ChunkGraphEdge[];
  stats: ChunkGraphStats;
  documents: ChunkGraphDocument[];
  granularity?: string;
  dataset_id?: string;
}

export interface EntityGraphData {
  graph?: {
    nodes?: { id?: string; entity_type?: string; description?: string; rank?: number }[];
    edges?: { source?: string; target?: string; weight?: number }[];
  };
  mind_map?: Record<string, unknown>;
}
