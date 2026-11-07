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

type Dot = { x: number; y: number; z: number };

const TAU = Math.PI * 2;

const TYPE_LABELS: Record<string, string> = {
  semantic: '语义',
  episodic: '情景',
  procedural: '程序',
  raw: '原始',
};

/**
 * The memory seen from inside: one neuron blown up to fill the stage, with
 * every message hanging off it as a bouton. The boutons orbit the cell on a
 * sphere, so the stage reads as a 3D synapse rather than a flat diagram.
 * Clicking a bouton opens that message, so the detail page stays inside the
 * same visual language as the brain it was entered from.
 */
export function NeuronStage({ seed, messages, activeId, onSelect }: IProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shape = useMemo(() => buildNeuronShape(seed, 'high'), [seed]);
  const [dark, setDark] = useState(() => isDarkTheme());
  const darkRef = useRef(dark);
  darkRef.current = dark;
  const [hovered, setHovered] = useState<number | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const hoverRef = useRef<number | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const sizeState = useRef({ w: 0, h: 0 });
  const nodeRef = useRef<{ x: number; y: number; r: number; index: number }[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  // the orbit turns by itself until the viewer grabs the cell, then their drag
  // takes over and the spin resumes once they let go
  const yaw = useRef(0.55);
  const pitch = useRef(-0.26);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(
    null,
  );
  const dragged = useRef(0);

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
    let last = 0;
    const draw = (time: number) => {
      const { w, h } = sizeState.current;
      if (!w || !h) return;
      const dt = last ? Math.min(0.05, time - last) : 0;
      last = time;
      if (!reduced && !drag.current) yaw.current += dt * 0.24;

      const isDark = darkRef.current;
      const cx = w * 0.44;
      const cy = h * 0.5;
      // the morphology reaches ~1.7 units, so this leaves the dendrites room
      // to breathe while the orbit stays outside their tips
      const unit = Math.min(w * 0.125, h * 0.2);
      const breathe = reduced ? 1 : 1 + Math.sin(time * 0.9) * 0.012;
      const list = messagesRef.current;
      const count = list.length;

      const cyaw = Math.cos(yaw.current);
      const syaw = Math.sin(yaw.current);
      const cp = Math.cos(pitch.current);
      const sp = Math.sin(pitch.current);

      // radius of the shell the boutons ride on, and the perspective distance
      const orbit = unit * 2.05;
      const focal = orbit * 2.1;
      const project = (p: Dot) => {
        const x1 = p.x * cyaw - p.z * syaw;
        const z1 = p.x * syaw + p.z * cyaw;
        const y1 = p.y * cp - z1 * sp;
        const z2 = p.y * sp + z1 * cp;
        const k = focal / (focal - z2);
        return { x: cx + x1 * k, y: cy + y1 * k, z: z2, k };
      };

      ctx.clearRect(0, 0, w, h);

      // light behind the cell
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, unit * 2.9);
      halo.addColorStop(
        0,
        isDark ? 'rgba(0, 190, 180, 0.17)' : 'rgba(0, 150, 145, 0.08)',
      );
      halo.addColorStop(0.5, isDark ? 'rgba(0, 120, 116, 0.05)' : 'rgba(0, 0, 0, 0)');
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      const colour = TYPE_COLORS.semantic[isDark ? 'dark' : 'light'];

      // two faint great circles, so the orbit reads as a sphere in space
      for (const ring of [1, 0.66]) {
        ctx.beginPath();
        for (let step = 0; step <= 64; step += 1) {
          const a = (step / 64) * TAU;
          const p = project({
            x: Math.cos(a) * orbit * ring,
            y: 0,
            z: Math.sin(a) * orbit * ring,
          });
          if (step === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = isDark
          ? 'rgba(120, 220, 210, 0.07)'
          : 'rgba(10, 90, 86, 0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const golden = Math.PI * (3 - Math.sqrt(5));
      const nodes: { x: number; y: number; r: number; index: number }[] = [];
      // a bouton on the far side would vanish behind the cell, so the ones
      // that end up behind are re-marked with a dashed ghost afterwards
      const ghosts: {
        x: number;
        y: number;
        r: number;
        colour: string;
        label: string;
      }[] = [];

      const drawBouton = (i: number, front: boolean) => {
        const message = list[i];
        const nodeColour =
          TYPE_COLORS[message.message_type]?.[isDark ? 'dark' : 'light'] ?? colour;
        const selected = message.message_id === activeRef.current;
        const hover = hoverRef.current === i;

        // a fibonacci shell keeps the boutons apart whatever their number; a
        // slow drift on every one of them keeps the depth legible while the
        // orbit turns
        const t = count === 1 ? 0 : (i + 0.5) / count;
        const drift = reduced ? 0 : Math.sin(time * 0.5 + i * 1.7) * 0.07;
        const rawY = (count === 1 ? 0.18 : 1 - t * 2) + drift;
        const y3 = Math.min(0.92, Math.max(-0.92, rawY));
        const ring = Math.sqrt(Math.max(0, 1 - y3 * y3));
        const phi =
          (count === 1 ? 0.4 : i * golden) +
          (reduced ? 0 : Math.sin(time * 0.34 + i) * 0.12);
        const radius = orbit * (0.92 + ((i * 37) % 11) * 0.014);
        const dot = project({
          x: Math.cos(phi) * ring * radius,
          y: y3 * radius * 0.86,
          z: Math.sin(phi) * ring * radius,
        });

        const depth = (dot.z / orbit + 1) / 2;
        if (front !== (depth >= 0.5)) return;

        const clampX = (value: number) => Math.min(Math.max(value, 52), w - 52);
        const clampY = (value: number) => Math.min(Math.max(value, 40), h - 40);
        const x = clampX(dot.x);
        const y = clampY(dot.y);
        const shrink = 0.68 + depth * 0.62;
        const r = Math.min(
          17,
          (selected ? 13 : hover ? 11.5 : 9) * shrink * dot.k,
        );
        const alpha = Math.min(1, 0.34 + depth * 0.78);
        // the far half sits in a shallow depth of field
        const blur = depth < 0.5 ? (0.5 - depth) * 1.7 : 0;
        const rawLabel =
          message.agent_name && message.agent_name !== 'Unknown'
            ? message.agent_name
            : (TYPE_LABELS[message.message_type] ?? message.message_type);
        const label = rawLabel.length > 10 ? rawLabel.slice(0, 10) + '…' : rawLabel;
        if (!front && depth < 0.5) {
          ghosts.push({ x, y, r: Math.max(r, 7), colour: nodeColour, label });
        }

        // the fibre that ties the message to the cell, bending through space
        const dx = x - cx;
        const dy = y - cy;
        const len = Math.hypot(dx, dy) || 1;
        const sx = cx + (dx / len) * unit * 0.44;
        const sy = cy + (dy / len) * unit * 0.44;
        const mx = (sx + x) / 2 - (dy / len) * 24 * dot.k;
        const my = (sy + y) / 2 + (dx / len) * 24 * dot.k;
        ctx.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(mx, my, x, y);
        ctx.strokeStyle = `rgba(${hexToRgb(nodeColour)}, ${(selected ? 0.62 : 0.3) * alpha})`;
        ctx.lineWidth = (selected ? 1.6 : 1) * dot.k;
        ctx.stroke();

        // travelling signal
        if (!reduced) {
          const s = (time * 0.35 + i * 0.17) % 1;
          const inv = 1 - s;
          const px = inv * inv * sx + 2 * inv * s * mx + s * s * x;
          const py = inv * inv * sy + 2 * inv * s * my + s * s * y;
          const tracer = ctx.createRadialGradient(px, py, 0, px, py, 6 * dot.k);
          tracer.addColorStop(0, `rgba(${hexToRgb(nodeColour)}, ${0.9 * alpha})`);
          tracer.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = tracer;
          ctx.beginPath();
          ctx.arc(px, py, 6 * dot.k, 0, TAU);
          ctx.fill();
        }

        if (selected) {
          const pulse = reduced ? 0.5 : Math.sin(time * 2.4) * 0.5 + 0.5;
          ctx.beginPath();
          ctx.arc(x, y, r + 8 + pulse * 4, 0, TAU);
          ctx.strokeStyle = `rgba(${hexToRgb(nodeColour)}, ${0.4 * alpha})`;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
        glow.addColorStop(0, `rgba(${hexToRgb(nodeColour)}, ${0.38 * alpha})`);
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, r * 3, 0, TAU);
        ctx.fill();

        // a lit sphere rather than a flat disc: the highlight rides the light
        const body = ctx.createRadialGradient(
          x - r * 0.34,
          y - r * 0.4,
          r * 0.1,
          x,
          y,
          r * 1.05,
        );
        body.addColorStop(
          0,
          `rgba(${hexToRgb(nodeColour)}, ${Math.min(1, 0.55 * alpha + 0.3)})`,
        );
        body.addColorStop(1, `rgba(${hexToRgb(nodeColour)}, ${0.22 * alpha})`);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = body;
        ctx.fill();
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = `rgba(${hexToRgb(nodeColour)}, ${alpha})`;
        ctx.stroke();

        if (selected) {
          ctx.beginPath();
          ctx.arc(x, y, r * 0.42, 0, TAU);
          ctx.fillStyle = isDark ? 'rgba(8, 16, 18, 0.9)' : 'rgba(255, 255, 255, 0.9)';
          ctx.fill();
        }

        // only the half in front of the cell carries a caption: on the far
        // side it would sit on top of the soma and read as a mistake
        // only the half in front of the cell carries a caption: on the far
        // side it would sit on top of the soma and read as a mistake
        if (depth < 0.42) {
          nodes.push({ x, y, r: r + 10, index: i });
          return;
        }
        ctx.font =
          (selected || hover ? '600' : '500') +
          ' 12px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.shadowColor = isDark ? 'rgba(3, 10, 10, 0.85)' : 'rgba(255,255,255,0.9)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = selected
          ? isDark
            ? `rgba(235, 250, 248, ${Math.min(1, alpha + 0.2)})`
            : `rgba(12, 40, 40, ${Math.min(1, alpha + 0.2)})`
          : isDark
            ? `rgba(210, 230, 228, ${0.75 * alpha})`
            : `rgba(40, 70, 70, ${0.75 * alpha})`;
        ctx.fillText(label, x, y + r + 8);
        ctx.shadowBlur = 0;
        ctx.filter = 'none';

        nodes.push({ x, y, r: r + 10, index: i });
      };

      // far half first, then the cell, then the near half: that order is what
      // makes the boutons sit in front of and behind the neuron
      for (let i = 0; i < count; i += 1) drawBouton(i, false);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(breathe, breathe * (0.94 + 0.06 * cp));
      paintNeuron(ctx, shape, unit, colour, { dark: isDark, halo: 3.4 });
      ctx.restore();

      for (let i = 0; i < count; i += 1) drawBouton(i, true);

      for (const ghost of ghosts) {
        // the message is behind the cell: mark it so it can still be found
        const rad = Math.max(ghost.r * 1.6, 9);
        ctx.beginPath();
        ctx.arc(ghost.x, ghost.y, rad, 0, TAU);
        ctx.strokeStyle = 'rgba(' + hexToRgb(ghost.colour) + ', 0.55)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(ghost.x, ghost.y, 2, 0, TAU);
        ctx.fillStyle = 'rgba(' + hexToRgb(ghost.colour) + ', 0.7)';
        ctx.fill();
        ctx.font =
          '500 11px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = isDark
          ? 'rgba(210, 230, 228, 0.68)'
          : 'rgba(40, 70, 70, 0.62)';
        ctx.fillText(ghost.label, ghost.x, ghost.y + rad + 6);
      }

      nodeRef.current = nodes;
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

  const pick = (x: number, y: number) => {
    let hit: number | null = null;
    let best = 30;
    for (const node of nodeRef.current) {
      const distance = Math.hypot(node.x - x, node.y - y);
      if (distance < best) {
        best = distance;
        hit = node.index;
      }
    }
    return hit;
  };

  const cursor = grabbing
    ? 'cursor-grabbing'
    : hovered !== null
      ? 'cursor-pointer'
      : 'cursor-grab';

  return (
    <div className="relative min-h-0 flex-1">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="memory neuron"
        className={'absolute inset-0 h-full w-full touch-none select-none ' + cursor}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragged.current = 0;
          setGrabbing(true);
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            yaw: yaw.current,
            pitch: pitch.current,
          };
        }}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          pointer.current = { x, y };
          const grabbed = drag.current;
          if (grabbed) {
            const dx = event.clientX - grabbed.x;
            const dy = event.clientY - grabbed.y;
            dragged.current = Math.max(dragged.current, Math.hypot(dx, dy));
            yaw.current = grabbed.yaw + dx * 0.008;
            pitch.current = Math.min(0.85, Math.max(-1.05, grabbed.pitch + dy * 0.006));
            return;
          }
          const hit = pick(x, y);
          if (hit !== hoverRef.current) {
            hoverRef.current = hit;
            setHovered(hit);
          }
        }}
        onPointerUp={() => {
          drag.current = null;
          setGrabbing(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setGrabbing(false);
        }}
        onPointerLeave={() => {
          pointer.current = null;
          drag.current = null;
          hoverRef.current = null;
          setGrabbing(false);
          setHovered(null);
        }}
        onClick={() => {
          if (dragged.current > 6) return;
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
