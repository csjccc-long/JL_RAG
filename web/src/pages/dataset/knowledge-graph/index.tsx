import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Spin } from '@/components/ui/spin';
import {
  KnowledgeApiAction,
  useFetchChunkGraph,
  useFetchKnowledgeGraph,
  useKnowledgeBaseId,
} from '@/hooks/use-knowledge-request';
import { deleteKnowledgeGraph, runIndex } from '@/services/knowledge-service';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  History,
  Maximize2,
  Network,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import GraphCanvas, { type GraphLayout, type GraphProjection } from './graph-canvas';
import type { ChunkGraphEdge, ChunkGraphNode } from './types';

type GraphView = 'relation' | 'structure' | 'entity';

const TYPE_DOT: Record<string, string> = {
  document: '#a9bfd2',
  part: '#d2c3a8',
  chapter: '#8398a9',
  section: '#c3aed2',
  article: '#a6bda3',
  chunk: '#6c7f90',
  sentence: '#dfc7a5',
  keyword: '#5c6c7a',
  entity: '#e2d7c6',
};

const TYPE_ORDER = [
  'document',
  'part',
  'chapter',
  'section',
  'article',
  'chunk',
  'sentence',
  'keyword',
  'entity',
];

export default function KnowledgeGraphPage({
  initialView = 'relation',
}: {
  initialView?: GraphView;
}) {
  const { t } = useTranslation();
  const knowledgeBaseId = useKnowledgeBaseId();
  const queryClient = useQueryClient();

  const [view, setView] = useState<GraphView>(initialView);
  const [projection, setProjection] = useState<GraphProjection>('3d');
  const [granularity, setGranularity] = useState<'sentence' | 'chunk'>('sentence');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [layoutSeed, setLayoutSeed] = useState(0);

  const {
    data: chunkData,
    loading,
    refetch,
  } = useFetchChunkGraph(granularity);
  const { data: entityData } = useFetchKnowledgeGraph();

  const entityNodes = useMemo<ChunkGraphNode[]>(() => {
    const nodes = (entityData?.graph?.nodes ?? []) as {
      id?: string;
      entity_type?: string;
      description?: string;
      rank?: number;
    }[];
    return nodes
      .filter((node) => node.id)
      .map((node) => ({
        id: node.id as string,
        label: node.id as string,
        type: 'entity',
        description: node.description,
        weight: node.rank ?? 1,
      }));
  }, [entityData]);

  const entityEdges = useMemo<ChunkGraphEdge[]>(() => {
    const edges = (entityData?.graph?.edges ?? []) as {
      source?: string;
      target?: string;
      weight?: number;
    }[];
    return edges
      .filter((edge) => edge.source && edge.target)
      .map((edge) => ({
        source: edge.source as string,
        target: edge.target as string,
        type: 'entity',
        weight: edge.weight ?? 1,
      }));
  }, [entityData]);

  const baseNodes = view === 'entity' ? entityNodes : chunkData?.nodes ?? [];
  const baseEdges = view === 'entity' ? entityEdges : chunkData?.edges ?? [];

  const nodes = useMemo(
    () => baseNodes.filter((node) => !hiddenTypes.has(node.type)),
    [baseNodes, hiddenTypes],
  );

  const edges = useMemo(() => {
    const ids = new Set(nodes.map((node) => node.id));
    return baseEdges.filter(
      (edge) => ids.has(edge.source) && ids.has(edge.target),
    );
  }, [baseEdges, nodes]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, ChunkGraphNode>();
    nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [nodes]);

  const selectedNode = selectedId ? nodeMap.get(selectedId) : undefined;

  const neighbors = useMemo(() => {
    if (!selectedId) return [] as { node: ChunkGraphNode; edge: string }[];
    const result: { node: ChunkGraphNode; edge: string }[] = [];
    baseEdges.forEach((edge) => {
      if (edge.source !== selectedId && edge.target !== selectedId) return;
      const otherId = edge.source === selectedId ? edge.target : edge.source;
      const node = nodeMap.get(otherId);
      if (node) result.push({ node, edge: edge.type ?? 'contains' });
    });
    return result.slice(0, 40);
  }, [baseEdges, nodeMap, selectedId]);

  const presentTypes = useMemo(() => {
    const types = new Set(baseNodes.map((node) => node.type));
    return TYPE_ORDER.filter((type) => types.has(type));
  }, [baseNodes]);

  const stats = chunkData?.stats;
  const docCount = chunkData?.documents?.length ?? stats?.documents ?? 0;

  const statsText = useMemo(() => {
    if (view === 'entity') {
      return t('knowledgeDetails.graphEntityStats', {
        nodes: entityNodes.length,
        edges: entityEdges.length,
      });
    }
    return t('knowledgeDetails.graphChunkStats', {
      documents: docCount,
      chunks: stats?.chunks ?? 0,
      chapters: (stats?.chapters ?? 0) + (stats?.articles ?? 0),
      keywords: stats?.keywords ?? 0,
      nodes: baseNodes.length,
      edges: baseEdges.length,
    });
  }, [baseEdges.length, baseNodes.length, docCount, entityEdges.length, entityNodes.length, stats, t, view]);

  const toggleType = useCallback((type: string) => {
    setHiddenTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const { mutate: removeEntityGraph, isPending: deleting } = useMutation({
    mutationFn: () => deleteKnowledgeGraph(knowledgeBaseId),
    onSuccess: () => {
      setNotice(t('knowledgeDetails.graphEntityDeleted'));
      queryClient.invalidateQueries({
        queryKey: [KnowledgeApiAction.FetchKnowledgeGraph, knowledgeBaseId],
      });
    },
  });

  const { mutate: generateEntityGraph, isPending: generating } = useMutation({
    mutationFn: () => runIndex(knowledgeBaseId, 'graph'),
    onSuccess: () => {
      setNotice(t('knowledgeDetails.graphEntitySubmitted'));
      window.setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: [KnowledgeApiAction.FetchKnowledgeGraph, knowledgeBaseId],
        });
      }, 3000);
    },
    onError: () => {
      setNotice(t('knowledgeDetails.graphEntityFailed'));
    },
  });

  const isEmpty = nodes.length === 0;
  const layout: GraphLayout = view === 'structure' ? 'radial' : 'force';

  const renderBody = () => {
    if (loading && view !== 'entity') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-text-secondary">
          <Spin size="large" />
          <span className="text-sm">{t('knowledgeDetails.graphLoading')}</span>
        </div>
      );
    }

    if (isEmpty) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="grid size-14 place-items-center rounded-2xl border border-border-button bg-bg-card">
            <Network className="size-6 text-text-secondary" />
          </div>
          <h3 className="text-base font-medium text-text-primary">
            {view === 'entity'
              ? t('knowledgeDetails.graphEntityEmptyTitle')
              : t('knowledgeDetails.graphEmptyTitle')}
          </h3>
          <p className="max-w-md text-sm text-text-secondary">
            {view === 'entity'
              ? t('knowledgeDetails.graphEntityEmptyDesc')
              : t('knowledgeDetails.graphEmptyDesc')}
          </p>
          <div className="flex items-center gap-2 pt-1">
            {view === 'entity' ? (
              <Button
                size="sm"
                onClick={() => generateEntityGraph()}
                disabled={generating}
              >
                <Sparkles className="size-3.5" />
                {generating
                  ? t('knowledgeDetails.graphGenerating')
                  : t('knowledgeDetails.graphGenerateEntity')}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                <RefreshCw className="size-3.5" />
                {t('knowledgeDetails.graphReload')}
              </Button>
            )}
          </div>
        </div>
      );
    }

    return (
      <GraphCanvas
        key={layoutSeed}
        nodes={nodes}
        edges={edges}
        layout={layout}
        projection={projection}
        selectedId={selectedId}
        search={search}
        onSelect={setSelectedId}
      />
    );
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl border border-border-button bg-bg-card">
            <Network className="size-5 text-text-primary" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-medium text-text-primary">
              {t(
                view === 'structure'
                  ? 'knowledgeDetails.graphStructure'
                  : view === 'entity'
                    ? 'knowledgeDetails.graphEntity'
                    : 'knowledgeDetails.graphPageTitle',
              )}
            </h2>
            <p className="text-xs text-text-secondary">{statsText}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Segmented
            value={view}
            onChange={(value) => {
              setView(value as GraphView);
              setSelectedId(null);
            }}
            options={[
              { value: 'relation', label: t('knowledgeDetails.graphRelation') },
              { value: 'structure', label: t('knowledgeDetails.graphStructure') },
              { value: 'entity', label: t('knowledgeDetails.graphEntity') },
            ]}
          />
          {view !== 'entity' && (
            <Segmented
              value={projection}
              onChange={(value) => setProjection(value as GraphProjection)}
              options={[
                { value: '3d', label: '3D' },
                { value: '2d', label: '2D' },
              ]}
            />
          )}
          {view !== 'entity' && (
            <Segmented
              value={granularity}
              onChange={(value) => {
                setGranularity(value as 'sentence' | 'chunk');
                setSelectedId(null);
              }}
              options={[
                { value: 'sentence', label: t('knowledgeDetails.graphGranularitySentence') },
                { value: 'chunk', label: t('knowledgeDetails.graphGranularityChunk') },
              ]}
            />
          )}
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('knowledgeDetails.graphSearchPlaceholder')}
            prefix={<Search className="size-3.5" />}
            className="w-44"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="size-3.5" />
            {t('knowledgeDetails.graphReload')}
          </Button>
          {view !== 'entity' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLayoutSeed((seed) => seed + 1)}
            >
              <RotateCcw className="size-3.5" />
              {t('knowledgeDetails.graphRelayout')}
            </Button>
          )}
          {view === 'entity' && entityNodes.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={deleting}
              onClick={() => removeEntityGraph()}
            >
              <Trash2 className="size-3.5" />
              {t('knowledgeDetails.graphDeleteEntity')}
            </Button>
          )}
        </div>
      </header>

      {notice && (
        <div className="flex items-center justify-between rounded-md border border-border-button bg-bg-card px-3 py-2 text-xs text-text-secondary">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}>
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border-button bg-bg-base">
          {renderBody()}

          {!isEmpty && !loading && (
            <>
              <div className="pointer-events-auto absolute bottom-3 left-3 flex max-w-[70%] flex-wrap items-center gap-1.5 rounded-lg border border-border-button bg-bg-card/85 px-2 py-1.5 backdrop-blur">
                {presentTypes.map((type) => {
                  const hidden = hiddenTypes.has(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleType(type)}
                      className={
                        'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-opacity ' +
                        (hidden
                          ? 'opacity-35 text-text-secondary'
                          : 'text-text-primary hover:bg-bg-base')
                      }
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: TYPE_DOT[type] ?? '#94a3b8' }}
                      />
                      {t('knowledgeDetails.graphNodeTypes.' + type, {
                        defaultValue: type,
                      })}
                    </button>
                  );
                })}
              </div>
              <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg border border-border-button bg-bg-card/80 px-2 py-1 text-[11px] text-text-secondary backdrop-blur">
                <Maximize2 className="size-3" />
                {projection === '3d'
                  ? t('knowledgeDetails.graphHint3d')
                  : t('knowledgeDetails.graphHint2d')}
              </div>
            </>
          )}
        </div>

        {selectedNode && (
          <aside className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border border-border-button bg-bg-card">
            <div className="flex items-start justify-between gap-2 border-b border-border-button px-4 py-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-secondary">
                  <span
                    className="size-2 rounded-full"
                    style={{
                      backgroundColor: TYPE_DOT[selectedNode.type] ?? '#94a3b8',
                    }}
                  />
                  {t('knowledgeDetails.graphNodeTypes.' + selectedNode.type, {
                    defaultValue: selectedNode.type,
                  })}
                </div>
                <h3 className="break-words text-sm font-medium text-text-primary">
                  {selectedNode.label}
                </h3>
              </div>
              <button
                type="button"
                className="rounded p-1 text-text-secondary hover:bg-bg-base"
                onClick={() => setSelectedId(null)}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
              {selectedNode.description ? (
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-text-secondary">
                  {selectedNode.description}
                </p>
              ) : null}

              <dl className="grid grid-cols-[88px_1fr] gap-y-1.5 text-xs">
                {selectedNode.doc_name && (
                  <>
                    <dt className="text-text-secondary">
                      {t('knowledgeDetails.graphFieldDoc')}
                    </dt>
                    <dd className="break-words text-text-primary">
                      {selectedNode.doc_name}
                    </dd>
                  </>
                )}
                {typeof selectedNode.page === 'number' && (
                  <>
                    <dt className="text-text-secondary">
                      {t('knowledgeDetails.graphFieldPage')}
                    </dt>
                    <dd className="text-text-primary">{selectedNode.page}</dd>
                  </>
                )}
                {typeof selectedNode.order === 'number' && (
                  <>
                    <dt className="text-text-secondary">
                      {t('knowledgeDetails.graphFieldOrder')}
                    </dt>
                    <dd className="text-text-primary">{selectedNode.order + 1}</dd>
                  </>
                )}
                {typeof selectedNode.value === 'number' && (
                  <>
                    <dt className="text-text-secondary">
                      {t('knowledgeDetails.graphFieldLength')}
                    </dt>
                    <dd className="text-text-primary">{selectedNode.value}</dd>
                  </>
                )}
                {typeof selectedNode.weight === 'number' && (
                  <>
                    <dt className="text-text-secondary">
                      {t('knowledgeDetails.graphFieldDegree')}
                    </dt>
                    <dd className="text-text-primary">{selectedNode.weight}</dd>
                  </>
                )}
              </dl>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-secondary">
                  <History className="size-3" />
                  {t('knowledgeDetails.graphNeighbors', {
                    count: neighbors.length,
                  })}
                </div>
                <ul className="space-y-1">
                  {neighbors.map(({ node, edge }) => (
                    <li key={edge + ':' + node.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(node.id)}
                        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-text-primary hover:bg-bg-base"
                      >
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: TYPE_DOT[node.type] ?? '#94a3b8',
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {node.label}
                        </span>
                        <span className="shrink-0 text-[10px] text-text-secondary">
                          {edge}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
