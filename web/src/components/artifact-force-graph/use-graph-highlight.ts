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

import { useCallback, useMemo, useState, type ComponentProps } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { orbSprite } from '@/components/particle-orb';
import { renderNodeLabel } from './node-label';
import {
  DefaultLinkWidth,
  DimmedAlpha,
  HighlightLinkWidth,
  MinNodeRadius,
} from './node-style';
import { type ArtifactGraphLink, type ArtifactGraphNode } from './types';
import { getBaseLinkColor, withAlpha } from './utils';

type PaintNodeFn = NonNullable<
  ComponentProps<typeof ForceGraph2D>['nodeCanvasObject']
>;

export const useGraphHighlight = (
  containerRef: React.RefObject<HTMLElement>,
  pinnedNode?: ArtifactGraphNode | null,
) => {
  const [hoverNode, setHoverNode] = useState<ArtifactGraphNode | null>(null);

  // Real hover takes precedence; falls back to the externally controlled pinned node when not hovering
  const activeNode = hoverNode ?? pinnedNode ?? null;

  const highlightNodes = useMemo(() => {
    const nodes = new Set<ArtifactGraphNode>();
    if (activeNode) {
      nodes.add(activeNode);
      activeNode.__neighbors?.forEach((neighbor) => nodes.add(neighbor));
    }
    return nodes;
  }, [activeNode]);

  const highlightLinks = useMemo(
    () => new Set<ArtifactGraphLink>(activeNode?.__links ?? []),
    [activeNode],
  );

  const handleNodeHover = useCallback((node: ArtifactGraphNode | null) => {
    setHoverNode(node ?? null);
  }, []);

  const getNodeColor = useCallback(
    (node: ArtifactGraphNode) =>
      activeNode && !highlightNodes.has(node)
        ? withAlpha(node.__color, DimmedAlpha)
        : node.__color,
    [activeNode, highlightNodes],
  );

  const getLinkColor = useCallback(
    (link: ArtifactGraphLink) => {
      const baseColor = getBaseLinkColor(containerRef.current);
      return activeNode && !highlightLinks.has(link)
        ? withAlpha(baseColor, DimmedAlpha)
        : baseColor;
    },
    [containerRef, activeNode, highlightLinks],
  );

  const getLinkWidth = useCallback(
    (link: ArtifactGraphLink) =>
      highlightLinks.has(link) ? HighlightLinkWidth : DefaultLinkWidth,
    [highlightLinks],
  );

  const paintNode = useCallback<PaintNodeFn>(
    (node, ctx, globalScale) => {
      const graphNode = node as ArtifactGraphNode;
      if (typeof graphNode.x !== 'number' || typeof graphNode.y !== 'number') {
        return;
      }
      const dimmed = activeNode !== null && !highlightNodes.has(graphNode);
      const highlighted = activeNode !== null && highlightNodes.has(graphNode);
      const radius = (graphNode.__radius ?? MinNodeRadius) * (highlighted ? 1.15 : 1);
      const dark = document.documentElement.classList.contains('dark');
      const sprite = orbSprite(graphNode.__color, dark, radius * 2.6);

      if (dimmed) ctx.globalAlpha = DimmedAlpha;
      if (sprite) {
        const size = sprite.width;
        ctx.drawImage(sprite, graphNode.x - size / 2, graphNode.y - size / 2);
      } else {
        ctx.fillStyle = graphNode.__color;
        ctx.beginPath();
        ctx.arc(graphNode.x, graphNode.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      renderNodeLabel(node, ctx, globalScale);
      ctx.globalAlpha = 1;
    },
    [highlightNodes, activeNode],
  );

  return {
    handleNodeHover,
    getNodeColor,
    getLinkColor,
    getLinkWidth,
    paintNode,
  };
};
