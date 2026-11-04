import { cn } from '@/lib/utils';
import { useEffect, useRef } from 'react';

import type { ChunkGraphEdge, ChunkGraphNode } from './types';

export type GraphLayout = 'force' | 'radial';
export type GraphProjection = '3d' | '2d';

export interface GraphCanvasProps {
  nodes: ChunkGraphNode[];
  edges: ChunkGraphEdge[];
  layout?: GraphLayout;
  projection?: GraphProjection;
  selectedId?: string | null;
  search?: string;
  onSelect?: (id: string | null) => void;
  className?: string;
}

const NODE_COLOR: Record<string, string> = {
  document: '#f59e0b',
  part: '#60a5fa',
  chapter: '#38bdf8',
  section: '#22d3ee',
  article: '#a78bfa',
  chunk: '#f472b6',
  sentence: '#94a3b8',
  keyword: '#34d399',
  entity: '#fbbf24',
};

const NODE_RADIUS: Record<string, number> = {
  document: 12,
  part: 9,
  chapter: 8.5,
  section: 5.5,
  article: 6.5,
  chunk: 8,
  sentence: 4.6,
  keyword: 6.5,
  entity: 7,
};

const EDGE_RGB: Record<string, string> = {
  contains: '148,163,184',
  covers: '34,211,238',
  next: '96,165,250',
  mentions: '167,139,250',
  entity: '251,191,36',
};

const EDGE_REST: Record<string, number> = {
  contains: 62,
  covers: 78,
  next: 84,
  mentions: 104,
  entity: 96,
};

const LABEL_TYPES = new Set([
  'document',
  'part',
  'chapter',
  'article',
  'entity',
  'keyword',
]);

const truncate = (text: string, max: number) =>
  text.length > max ? text.slice(0, max) + '…' : text;

const radiusOf = (node: ChunkGraphNode) =>
  (NODE_RADIUS[node.type] ?? 6) + Math.min(5, Math.sqrt(node.weight ?? 1) * 0.9);

interface SimNode {
  data: ChunkGraphNode;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  tx: number;
  ty: number;
  tz: number;
  r: number;
  color: string;
  scale: number;
  sx: number;
  sy: number;
}

interface SimEdge {
  s: number;
  t: number;
  type: string;
  rest: number;
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

export function GraphCanvas({
  nodes,
  edges,
  layout = 'force',
  projection = '3d',
  selectedId,
  search = '',
  onSelect,
  className,
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedRef = useRef<string | null>(null);
  const searchRef = useRef('');
  const onSelectRef = useRef(onSelect);

  selectedRef.current = selectedId ?? null;
  searchRef.current = search.trim().toLowerCase();
  onSelectRef.current = onSelect;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const count = nodes.length;
    if (!count) return;

    let width = 0;
    let height = 0;

    const simNodes: SimNode[] = nodes.map((node, i) => {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / count);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const spread = 70 + 13 * Math.sqrt(count);
      return {
        data: node,
        x: spread * Math.sin(phi) * Math.cos(theta),
        y: spread * Math.cos(phi),
        z: spread * Math.sin(phi) * Math.sin(theta),
        vx: 0,
        vy: 0,
        vz: 0,
        tx: 0,
        ty: 0,
        tz: 0,
        r: radiusOf(node),
        color: NODE_COLOR[node.type] ?? '#94a3b8',
        scale: 1,
        sx: 0,
        sy: 0,
      };
    });

    const indexById = new Map<string, number>();
    simNodes.forEach((node, i) => indexById.set(node.data.id, i));

    const adjacency = new Map<number, Set<number>>();
    simNodes.forEach((_, i) => adjacency.set(i, new Set<number>()));
    const simEdges: SimEdge[] = [];
    edges.forEach((edge) => {
      const s = indexById.get(edge.source);
      const t = indexById.get(edge.target);
      if (s === undefined || t === undefined || s === t) return;
      const type = edge.type ?? 'contains';
      simEdges.push({
        s,
        t,
        type,
        rest: EDGE_REST[type] ?? 80,
      });
      adjacency.get(s)?.add(t);
      adjacency.get(t)?.add(s);
    });

    // ---- radial (concentric rings by node type) ----
    if (layout === 'radial') {
      const ringOf: Record<string, number> = {
        document: 0,
        part: 130,
        chapter: 190,
        article: 300,
        section: 300,
        chunk: 380,
        sentence: 470,
        keyword: 545,
        entity: 320,
      };
      const groups = new Map<string, number[]>();
      simNodes.forEach((node, i) => {
        const key = node.data.type;
        const list = groups.get(key) ?? [];
        list.push(i);
        groups.set(key, list);
      });
      let ringIndex = 0;
      groups.forEach((ids, type) => {
        const radius = ringOf[type] ?? 300;
        ids.sort((a, b) => {
          const oa = simNodes[a].data.order ?? simNodes[a].data.page ?? 0;
          const ob = simNodes[b].data.order ?? simNodes[b].data.page ?? 0;
          return (
            oa - ob ||
            (simNodes[a].data.label || '').localeCompare(
              simNodes[b].data.label || '',
            )
          );
        });
        const phase = ringIndex * 0.35 - Math.PI / 2;
        ids.forEach((index, k) => {
          const node = simNodes[index];
          if (radius === 0) {
            node.tx = 0;
            node.ty = 0;
            node.tz = 0;
          } else {
            const angle = phase + (k / ids.length) * Math.PI * 2;
            node.tx = Math.cos(angle) * radius;
            node.ty = Math.sin(angle) * radius;
            node.tz = Math.sin(angle * 3) * 18;
          }
          node.x = node.tx;
          node.y = node.ty;
          node.z = node.tz;
        });
        ringIndex += 1;
      });
    }

    // ---- camera ----
    let spreadRadius = 1;
    simNodes.forEach((node) => {
      spreadRadius = Math.max(
        spreadRadius,
        Math.sqrt(node.x * node.x + node.y * node.y + node.z * node.z),
      );
    });
    const focal = 980;
    const cam = {
      yaw: 0.62,
      pitch: 0.34,
      dist: clamp(spreadRadius * 3 + 380, 520, 3200),
      zoom: clamp(300 / spreadRadius, 0.4, 1.6),
      panX: 0,
      panY: 0,
    };

    let alpha = 1;
    let fitStage = 0;
    let autoView = true;

    const project = (node: SimNode) => {
      const cx = width / 2;
      const cy = height / 2;
      if (projection === '2d') {
        const scale = cam.zoom;
        node.sx = cx + node.x * scale + cam.panX;
        node.sy = cy - node.y * scale + cam.panY;
        node.scale = scale;
        return;
      }
      const cyaw = Math.cos(cam.yaw);
      const syaw = Math.sin(cam.yaw);
      const x1 = node.x * cyaw - node.z * syaw;
      const z1 = node.x * syaw + node.z * cyaw;
      const cp = Math.cos(cam.pitch);
      const sp = Math.sin(cam.pitch);
      const y2 = node.y * cp - z1 * sp;
      const z2 = node.y * sp + z1 * cp;
      const depth = cam.dist - z2;
      const scale = (focal / Math.max(depth, 90)) * cam.zoom;
      node.sx = cx + x1 * scale + cam.panX;
      node.sy = cy - y2 * scale + cam.panY;
      node.scale = scale;
    };

    if (projection === '2d') cam.dist = 1000;

    const tick = () => {
      if (layout === 'radial') {
        simNodes.forEach((node) => {
          node.vx += (node.tx - node.x) * 0.14 * alpha;
          node.vy += (node.ty - node.y) * 0.14 * alpha;
          node.vz += (node.tz - node.z) * 0.08 * alpha;
        });
      } else {
        for (let i = 0; i < count; i++) {
          const a = simNodes[i];
          for (let j = i + 1; j < count; j++) {
            const b = simNodes[j];
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let dz = a.z - b.z;
            let d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < 1) {
              dx = Math.random() - 0.5;
              dy = Math.random() - 0.5;
              dz = Math.random() - 0.5;
              d2 = 1;
            }
            if (d2 > 122500) continue;
            const d = Math.sqrt(d2);
            const force = (1500 * alpha) / d2;
            dx /= d;
            dy /= d;
            dz /= d;
            a.vx += dx * force;
            a.vy += dy * force;
            a.vz += dz * force;
            b.vx -= dx * force;
            b.vy -= dy * force;
            b.vz -= dz * force;
          }
        }
        simEdges.forEach((edge) => {
          const a = simNodes[edge.s];
          const b = simNodes[edge.t];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dz = b.z - a.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
          const force = ((d - edge.rest) * 0.012 * alpha) / d;
          dx *= force;
          dy *= force;
          dz *= force;
          a.vx += dx;
          a.vy += dy;
          a.vz += dz;
          b.vx -= dx;
          b.vy -= dy;
          b.vz -= dz;
        });
        simNodes.forEach((node) => {
          node.vx -= node.x * 0.004 * alpha;
          node.vy -= node.y * 0.004 * alpha;
          node.vz -= node.z * 0.004 * alpha;
        });
      }

      simNodes.forEach((node) => {
        node.vx *= 0.82;
        node.vy *= 0.82;
        node.vz *= 0.82;
        node.vx = clamp(node.vx, -14, 14);
        node.vy = clamp(node.vy, -14, 14);
        node.vz = clamp(node.vz, -14, 14);
        node.x += node.vx;
        node.y += node.vy;
        node.z += node.vz;
      });

      alpha *= 0.978;
      if (alpha < 0.01) alpha = 0.01;
    };

    // ---- interaction ----
    let hovered = -1;
    let dragMode: 'none' | 'orbit' | 'node' = 'none';
    let dragIndex = -1;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;

    const pick = (px: number, py: number): number => {
      let best = -1;
      let bestScale = -1;
      simNodes.forEach((node, i) => {
        if (node.scale <= 0) return;
        const r = Math.max(6, node.r * node.scale);
        const dx = px - node.sx;
        const dy = py - node.sy;
        if (dx * dx + dy * dy > (r + 4) * (r + 4)) return;
        if (node.scale > bestScale) {
          best = i;
          bestScale = node.scale;
        }
      });
      return best;
    };

    const localPoint = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const handlePointerDown = (event: PointerEvent) => {
      const point = localPoint(event);
      lastX = point.x;
      lastY = point.y;
      downX = point.x;
      downY = point.y;
      const hit = pick(point.x, point.y);
      if (hit >= 0) {
        dragMode = 'node';
        dragIndex = hit;
        alpha = Math.max(alpha, 0.45);
      } else {
        dragMode = 'orbit';
        dragIndex = -1;
      }
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
    };

    const handlePointerMove = (event: PointerEvent) => {
      const point = localPoint(event);
      if (dragMode === 'none') {
        const hit = pick(point.x, point.y);
        if (hit !== hovered) {
          hovered = hit;
          canvas.style.cursor = hit >= 0 ? 'pointer' : 'grab';
        }
        return;
      }
      const dx = point.x - lastX;
      const dy = point.y - lastY;
      lastX = point.x;
      lastY = point.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) autoView = false;

      if (dragMode === 'orbit') {
        if (projection === '2d') {
          cam.panX += dx;
          cam.panY += dy;
        } else {
          cam.yaw += dx * 0.0055;
          cam.pitch = clamp(cam.pitch + dy * 0.0045, -1.35, 1.35);
        }
        return;
      }

      const node = simNodes[dragIndex];
      if (!node) return;
      const scale = node.scale > 0.05 ? node.scale : 0.05;
      const cyaw = Math.cos(cam.yaw);
      const syaw = Math.sin(cam.yaw);
      node.x += (dx * cyaw) / scale;
      node.z += (-dx * syaw) / scale;
      node.y += -dy / (scale * Math.max(0.35, Math.cos(cam.pitch)));
      node.vx = 0;
      node.vy = 0;
      node.vz = 0;
      if (layout === 'radial') {
        node.tx = node.x;
        node.ty = node.y;
        node.tz = node.z;
      }
      alpha = Math.max(alpha, 0.5);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const point = localPoint(event);
      const moved = Math.abs(point.x - downX) + Math.abs(point.y - downY) > 5;
      if (dragMode === 'node' && dragIndex >= 0 && !moved) {
        const id = simNodes[dragIndex].data.id;
        onSelectRef.current?.(
          selectedRef.current === id ? null : id,
        );
      }
      dragMode = 'none';
      dragIndex = -1;
      canvas.style.cursor = hovered >= 0 ? 'pointer' : 'grab';
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      autoView = false;
      if (projection === '2d') {
        cam.zoom = clamp(cam.zoom * Math.exp(-event.deltaY * 0.0012), 0.12, 4);
      } else {
        cam.dist = clamp(cam.dist * Math.exp(event.deltaY * 0.0012), 220, 4200);
      }
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    if (layout === 'radial') {
      let maxR = 1;
      simNodes.forEach((node) => {
        maxR = Math.max(maxR, Math.hypot(node.x, node.y, node.z));
      });
      const target = Math.max(80, Math.min(width, height) / 2 - 64);
      cam.zoom = 1;
      cam.dist = clamp((focal * maxR) / target, 240, 6000);
      cam.panX = 0;
      cam.panY = 0;
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let frame = 0;
    let stopped = false;

    const drawEdge = (edge: SimEdge, highlight: boolean) => {
      const a = simNodes[edge.s];
      const b = simNodes[edge.t];
      const rgb = EDGE_RGB[edge.type] ?? '148,163,184';
      const soft = layout === 'radial' && edge.type === 'mentions' ? 0.3 : 1;
      const fade =
        clamp(
          Math.min(a.scale, b.scale) * 0.55,
          0.05,
          highlight ? 0.85 : 0.55,
        ) * soft;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.strokeStyle = 'rgba(' + rgb + ',' + fade + ')';
      ctx.lineWidth = highlight ? 1.9 : edge.type === 'contains' ? 1.15 : 0.85;
      ctx.stroke();
    };

    const drawLabel = (
      node: SimNode,
      text: string,
      fontSize: number,
      dim: boolean,
    ) => {
      ctx.font = '500 ' + fontSize + 'px Inter, system-ui, sans-serif';
      const textWidth = ctx.measureText(text).width;
      const paddingX = 5;
      const boxHeight = fontSize + 7;
      const x = node.sx + Math.max(6, node.r * node.scale) + 4;
      const y = node.sy;
      ctx.fillStyle = dim ? 'rgba(9,13,20,0.35)' : 'rgba(9,13,20,0.74)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y - boxHeight / 2, textWidth + paddingX * 2, boxHeight, 4);
      } else {
        ctx.rect(x, y - boxHeight / 2, textWidth + paddingX * 2, boxHeight);
      }
      ctx.fill();
      ctx.fillStyle = dim ? 'rgba(226,232,240,0.45)' : 'rgba(226,232,240,0.95)';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + paddingX, y + 0.5);
    };

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      simNodes.forEach(project);

      const selected = selectedRef.current;
      const query = searchRef.current;
      const neighborIds = new Set<string>();
      let selectedIndex = -1;
      if (selected) {
        const index = indexById.get(selected);
        if (index !== undefined) {
          selectedIndex = index;
          neighborIds.add(selected);
          adjacency.get(index)?.forEach((n) => {
            neighborIds.add(simNodes[n].data.id);
          });
        }
      }
      const matchedIds = new Set<string>();
      if (query) {
        simNodes.forEach((node) => {
          const haystack = (
            node.data.label +
            ' ' +
            (node.data.description ?? '')
          ).toLowerCase();
          if (haystack.includes(query)) matchedIds.add(node.data.id);
        });
      }
      const focusMode = Boolean(selected) || Boolean(query);

      simEdges.forEach((edge) => {
        const highlighted =
          (selected !== null && neighborIds.has(simNodes[edge.s].data.id) && neighborIds.has(simNodes[edge.t].data.id)) ||
          (matchedIds.size > 0 && matchedIds.has(simNodes[edge.s].data.id) && matchedIds.has(simNodes[edge.t].data.id));
        drawEdge(edge, highlighted);
      });

      // far to near
      const sorted = simNodes
        .map((_, i) => i)
        .sort((a, b) => simNodes[a].scale - simNodes[b].scale);

      sorted.forEach((i) => {
        const node = simNodes[i];
        if (node.scale <= 0.02) return;
        const isSelected = i === selectedIndex;
        const isNeighbor = neighborIds.has(node.data.id);
        const isMatch = matchedIds.has(node.data.id);
        const dim = focusMode && !isSelected && !isNeighbor && !isMatch;
        const hover = i === hovered;
        const radius = Math.max(2.4, node.r * node.scale);

        ctx.save();
        ctx.globalAlpha = dim ? 0.18 : 1;
        if (isSelected || (hover && !dim)) {
          ctx.shadowColor = node.color;
          ctx.shadowBlur = isSelected ? 22 : 12;
        }
        ctx.beginPath();
        ctx.arc(node.sx, node.sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();

        const highlight = ctx.createRadialGradient(
          node.sx - radius * 0.35,
          node.sy - radius * 0.35,
          radius * 0.05,
          node.sx,
          node.sy,
          radius,
        );
        highlight.addColorStop(0, 'rgba(255,255,255,0.72)');
        highlight.addColorStop(0.55, 'rgba(255,255,255,0.08)');
        highlight.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.shadowBlur = 0;
        ctx.fillStyle = highlight;
        ctx.fill();

        if (LABEL_TYPES.has(node.data.type) || isSelected || hover || isMatch) {
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
        ctx.restore();

      });

      // ---- labels: priority + collision culling ----
      const candidates: { node: SimNode; priority: number; dim: boolean }[] = [];
      simNodes.forEach((node, i) => {
        const isSelected = i === selectedIndex;
        const isNeighbor = neighborIds.has(node.data.id);
        const isMatch = matchedIds.has(node.data.id);
        const hover = i === hovered;
        const show =
          LABEL_TYPES.has(node.data.type) ||
          isSelected ||
          hover ||
          isNeighbor ||
          isMatch;
        if (!show || node.scale <= 0.2) return;
        let priority = 9;
        if (isSelected) priority = 0;
        else if (hover) priority = 1;
        else if (isMatch) priority = 2;
        else if (node.data.type === 'document') priority = 3;
        else if (node.data.type === 'chapter' || node.data.type === 'part') priority = 4;
        else if (node.data.type === 'article' || node.data.type === 'section') priority = 5;
        else if (node.data.type === 'keyword') priority = 6;
        else if (isNeighbor) priority = 7;
        candidates.push({
          node,
          priority,
          dim: focusMode && !isSelected && !isNeighbor && !isMatch,
        });
      });
      candidates.sort((a, b) => a.priority - b.priority);

      const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [];
      candidates.forEach(({ node, dim }) => {
        const fontSize = clamp(Math.round(11 * Math.min(1.35, node.scale)), 9, 14);
        const text = truncate(node.data.label || node.data.id, 18);
        ctx.font = '500 ' + fontSize + 'px Inter, system-ui, sans-serif';
        const textWidth = ctx.measureText(text).width;
        const boxHeight = fontSize + 7;
        const gap = Math.max(6, node.r * node.scale) + 4;
        const rightX = node.sx + gap;
        const leftX = node.sx - gap - textWidth - 10;
        const x = rightX + textWidth + 10 > width ? Math.max(4, leftX) : rightX;
        const y = node.sy;
        const box = {
          x1: x - 2,
          y1: y - boxHeight / 2 - 2,
          x2: x + textWidth + 10,
          y2: y + boxHeight / 2 + 2,
        };
        const collides = boxes.some(
          (b) =>
            !(
              box.x2 < b.x1 ||
              box.x1 > b.x2 ||
              box.y2 < b.y1 ||
              box.y1 > b.y2
            ),
        );
        if (collides) return;
        boxes.push(box);
        ctx.save();
        ctx.globalAlpha = dim ? 0.3 : 1;
        drawLabel(node, text, fontSize, dim);
        ctx.restore();
      });
    };

    const autoFit = () => {
      if (layout === 'radial') return;
      if (!autoView || simNodes.length === 0 || width < 80 || height < 80) return;
      const measure = () => {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        let hit = 4;
        simNodes.forEach((node) => {
          minX = Math.min(minX, node.sx);
          maxX = Math.max(maxX, node.sx);
          minY = Math.min(minY, node.sy);
          maxY = Math.max(maxY, node.sy);
          hit = Math.max(hit, node.r * node.scale);
        });
        return { minX, maxX, minY, maxY, hit };
      };
      const margin = 52;
      const first = measure();
      const availX = Math.max(60, width / 2 - margin);
      const availY = Math.max(60, height / 2 - margin);
      const halfWidth = (first.maxX - first.minX) / 2 + first.hit;
      const halfHeight = (first.maxY - first.minY) / 2 + first.hit;
      const factor = clamp(
        Math.max(halfWidth / availX, halfHeight / availY),
        0.45,
        3,
      );
      if (Number.isFinite(factor) && Math.abs(factor - 1) > 0.04) {
        if (projection === '2d') cam.zoom = clamp(cam.zoom / factor, 0.12, 4);
        else cam.dist = clamp(cam.dist * factor, 220, 4600);
      }
      cam.panX = 0;
      cam.panY = 0;
      simNodes.forEach(project);
      const box = measure();
      cam.panX = width / 2 - (box.minX + box.maxX) / 2;
      cam.panY = height / 2 - (box.minY + box.maxY) / 2;
      simNodes.forEach(project);
    };

    const loop = () => {
      if (stopped) return;
      if (alpha > 0.012) {
        tick();
        if (fitStage === 0 && alpha < 0.15) {
          fitStage = 1;
          autoFit();
        } else if (fitStage === 1 && alpha < 0.03) {
          fitStage = 2;
          autoFit();
        }
      }
      render();
      frame = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerUp);
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [nodes, edges, layout, projection]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('h-full w-full touch-none select-none', className)}
      style={{ cursor: 'grab' }}
    />
  );
}

export default GraphCanvas;
