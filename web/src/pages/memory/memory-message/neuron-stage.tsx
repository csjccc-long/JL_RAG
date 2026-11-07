import { isDarkTheme, watchTheme } from '@/components/live-orb';
import {
  buildNeuronShape,
  hexToRgb,
  paintNeuron,
} from '@/pages/memories/neuron-shape';
import { TYPE_COLORS } from '@/pages/memories/brain-model';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IMessageInfo } from './interface';

interface IProps {
  seed: number;
  messages: IMessageInfo[];
  activeId: number | null;
  onSelect: (message: IMessageInfo) => void;
}

/**
 * The memory seen from inside: one neuron blown up to fill the stage, with
 * every message hanging off it as a bouton. Clicking a bouton opens that
 * message, so the detail page stays inside the same visual language as the
 * brain it was entered from.
 */
export function NeuronStage({ seed, messages, activeId, onSelect }: IProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shape = useMemo(() => buildNeuronShape(seed, 'high'), [seed]);
  const [dark, setDark] = useState(() => isDarkTheme());
  const darkRef = useRef(dark);
  darkRef.current = dark;
  const [hovered, setHovered] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const sizeState = useRef({ w: 0, h: 0 });
  const nodeRef = useRef<{ x: number; y: number; r: number; index: number }[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  useEffect(() => watchTheme(() => setDark(isDarkTheme())), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeState.current = { w: rect.width, h: rect.height };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let raf = 0;
    const draw = (time: number) => {
      const { w, h } = sizeState.current;
      if (!w || !h) return;
      const isDark = darkRef.current;
      const cx = w * 0.44;
      const cy = h * 0.5;
      // the morphology reaches ~1.7 units, so this leaves the dendrites room
      // to breathe while the boutons stay outside their tips
      const unit = Math.min(w * 0.14, h * 0.23);
      const breathe = reduced ? 1 : 1 + Math.sin(time * 0.9) * 0.012;
      const list = messagesRef.current;

      ctx.clearRect(0, 0, w, h);

      // light behind the cell
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, unit * 2.6);
      halo.addColorStop(
        0,
        isDark ? 'rgba(0, 190, 180, 0.16)' : 'rgba(0, 150, 145, 0.08)',
      );
      halo.addColorStop(0.5, isDark ? 'rgba(0, 120, 116, 0.05)' : 'rgba(0, 0, 0, 0)');
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      const colour = TYPE_COLORS.semantic[isDark ? 'dark' : 'light'];

      // the boutons first, so the neuron's own glow sits on top of the wires
      const nodes: { x: number; y: number; r: number; index: number }[] = [];
      const count = list.length;
      const radiusX = Math.min(w * 0.42, 480);
      const radiusY = Math.min(h * 0.42, 300);
      for (let i = 0; i < count; i += 1) {
        const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
        const x = cx + Math.cos(angle) * radiusX;
        const y = cy + Math.sin(angle) * radiusY;
        const nodeColour =
          TYPE_COLORS[list[i].message_type]?.[isDark ? 'dark' : 'light'] ?? colour;
        const selected = list[i].message_id === activeRef.current;
        const hover = hoverRef.current === i;
        const r = selected ? 13 : hover ? 11.5 : 9;

        // the fibre that ties the message to the cell
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const sx = cx + dx * unit * 0.42;
        const sy = cy + dy * unit * 0.42;
        const mx = (sx + x) / 2 - dy * 26;
        const my = (sy + y) / 2 + dx * 26;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(mx, my, x, y);
        ctx.strokeStyle = `rgba(${hexToRgb(nodeColour)}, ${selected ? 0.6 : 0.26})`;
        ctx.lineWidth = selected ? 1.6 : 1;
        ctx.stroke();

        // travelling signal
        if (!reduced) {
          const s = (time * 0.35 + i * 0.17) % 1;
          const inv = 1 - s;
          const px = inv * inv * sx + 2 * inv * s * mx + s * s * x;
          const py = inv * inv * sy + 2 * inv * s * my + s * s * y;
          const dot = ctx.createRadialGradient(px, py, 0, px, py, 6);
          dot.addColorStop(0, `rgba(${hexToRgb(nodeColour)}, 0.9)`);
          dot.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = dot;
          ctx.beginPath();
          ctx.arc(px, py, 6, 0, Math.PI * 2);
          ctx.fill();
        }

        if (selected) {
          const pulse = reduced ? 0.5 : Math.sin(time * 2.4) * 0.5 + 0.5;
          ctx.beginPath();
          ctx.arc(x, y, r + 8 + pulse * 4, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${hexToRgb(nodeColour)}, 0.35)`;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
        glow.addColorStop(0, `rgba(${hexToRgb(nodeColour)}, 0.35)`);
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, r * 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = selected
          ? nodeColour
          : `rgba(${hexToRgb(nodeColour)}, 0.24)`;
        ctx.fill();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = nodeColour;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x, y, selected ? r * 0.42 : r * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = selected
          ? isDark
            ? 'rgba(8, 16, 18, 0.9)'
            : 'rgba(255, 255, 255, 0.9)'
          : nodeColour;
        ctx.fill();

        const label = list[i].agent_name || list[i].message_type;
        ctx.font = `${selected || hover ? '600' : '500'} 12px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.shadowColor = isDark ? 'rgba(3, 10, 10, 0.85)' : 'rgba(255,255,255,0.9)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = selected
          ? isDark
            ? 'rgba(235, 250, 248, 0.98)'
            : 'rgba(12, 40, 40, 0.95)'
          : isDark
            ? 'rgba(210, 230, 228, 0.72)'
            : 'rgba(40, 70, 70, 0.72)';
        ctx.fillText(label.length > 10 ? `${label.slice(0, 10)}…` : label, x, y + r + 8);
        ctx.shadowBlur = 0;

        nodes.push({ x, y, r: r + 10, index: i });
      }
      nodeRef.current = nodes;

      // the cell itself
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(breathe, breathe);
      paintNeuron(ctx, shape, unit, colour, { dark: isDark, halo: 3.4 });
      ctx.restore();
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      draw(now / 1000);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [shape]);

  return (
    <div className="relative min-h-0 flex-1">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="memory neuron"
        className={`absolute inset-0 h-full w-full touch-none select-none ${
          hovered !== null ? 'cursor-pointer' : 'cursor-default'
        }`}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          pointer.current = { x, y };
          let hit: number | null = null;
          let best = 26;
          for (const node of nodeRef.current) {
            const d = Math.hypot(node.x - x, node.y - y);
            if (d < best) {
              best = d;
              hit = node.index;
            }
          }
          if (hit !== hoverRef.current) {
            hoverRef.current = hit;
            setHovered(hit);
          }
        }}
        onPointerLeave={() => {
          pointer.current = null;
          hoverRef.current = null;
          setHovered(null);
        }}
        onClick={() => {
          const hit = hoverRef.current;
          if (hit === null) return;
          const message = messagesRef.current[hit];
          if (message) onSelect(message);
        }}
      />
      {messages.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-1 text-center">
          <p className="text-sm text-text-secondary">这条记忆还没有消息</p>
          <p className="text-[11px] text-text-secondary/60">
            抽取出的每一条信息都会成为这颗神经元上的一个突触
          </p>
        </div>
      )}
    </div>
  );
}
