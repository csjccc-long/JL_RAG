import { isDarkTheme, watchTheme } from '@/components/live-orb';
import { hexToRgb } from '@/pages/memories/neuron-shape';
import { buildNeuron3D, Tip3D } from '@/pages/memories/neuron3d';
import { TYPE_COLORS } from '@/pages/memories/brain-model';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IMessageInfo } from './interface';

interface IProps {
  seed: number;
  messages: IMessageInfo[];
  activeId: number | null;
  onSelect: (message: IMessageInfo) => void;
}

const TAU = Math.PI * 2;

const TYPE_LABELS: Record<string, string> = {
  semantic: '语义',
  episodic: '情景',
  procedural: '程序',
  raw: '原始',
};

interface Segment {
  a: [number, number, number];
  b: [number, number, number];
  wa: number;
  wb: number;
}

/**
 * The memory seen from inside: the neuron itself is modelled in three
 * dimensions and turned by the viewer, and every message hangs off one of its
 * dendritic terminals. Rotating the cell therefore moves the messages through
 * space with it, the way synapses sit on a real arbor.
 */
export function NeuronStage({ seed, messages, activeId, onSelect }: IProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const neuron = useMemo(() => buildNeuron3D(seed, 'high'), [seed]);
  const [dark, setDark] = useState(() => isDarkTheme());
  const darkRef = useRef(dark);
  darkRef.current = dark;
  const [hovered, setHovered] = useState<number | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const hoverRef = useRef<number | null>(null);
  const sizeState = useRef({ w: 0, h: 0 });
  const nodeRef = useRef<{ x: number; y: number; r: number; index: number }[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const yaw = useRef(0.62);
  const sway = useRef(true);
  const pitch = useRef(-0.32);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(
    null,
  );
  const dragged = useRef(0);

  // flatten the arbor once: the frame loop only projects and sorts
  const segments = useMemo<Segment[]>(() => {
    const out: Segment[] = [];
    for (const branch of neuron.branches) {
      const { pts, w } = branch;
      for (let i = 3; i < pts.length; i += 3) {
        out.push({
          a: [pts[i - 3], pts[i - 2], pts[i - 1]],
          b: [pts[i], pts[i + 1], pts[i + 2]],
          wa: w[i / 3 - 1],
          wb: w[i / 3],
        });
      }
    }
    return out;
  }, [neuron]);

  // every message gets its own terminal, spread around the arbor
  const anchors = useMemo<Tip3D[]>(() => {
    if (!neuron.tips.length) return [];
    // score every terminal as it appears from the opening camera: messages
    // start on the side facing the viewer instead of hiding behind the soma
    const cyaw = Math.cos(0.62);
    const syaw = Math.sin(0.62);
    const cp = Math.cos(-0.32);
    const sp = Math.sin(-0.32);
    const scored = neuron.tips
      .map((tip) => {
        const x1 = tip.x * cyaw - tip.z * syaw;
        const z1 = tip.x * syaw + tip.z * cyaw;
        const y1 = tip.y * cp - z1 * sp;
        const z2 = tip.y * sp + z1 * cp;
        return {
          tip,
          depth: Math.min(1, Math.max(0, (z2 / neuron.reach + 1) / 2)),
          screen: Math.hypot(x1, y1),
          angle: Math.atan2(y1, x1),
        };
      })
      .filter((item) => Math.hypot(item.tip.x, item.tip.z) > 0.5);
    const visible = scored.filter((item) => item.depth >= 0.52);
    const pool = visible.length >= messages.length ? visible : scored;
    if (!pool.length) return [];
    const sorted = [...pool].sort((a, b) => a.angle - b.angle);
    if (messages.length === 1) {
      // keep the single message on the face of the cell, not on its silhouette
      const facing = sorted.filter((item) => item.depth >= 0.7);
      const pickFrom = facing.length ? facing : sorted;
      const best = [...pickFrom].sort((a, b) => b.screen - a.screen);
      return [best[0].tip];
    }
    return messages.map((_, i) => {
      const at = Math.floor((i * sorted.length) / messages.length);
      return sorted[at % sorted.length].tip;
    });
  }, [neuron, messages]);

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
      // a slow sway shows the depth of the arbor without ever turning the
      // terminals away from the viewer
      if (!reduced && !drag.current && sway.current) {
        yaw.current = 0.62 + Math.sin(time * 0.24) * 0.2;
      }

      const isDark = darkRef.current;
      const cx = w * 0.44;
      const cy = h * 0.5;
      const unit = Math.min(w * 0.155, h * 0.225);
      const breathe = reduced ? 1 : 1 + Math.sin(time * 0.9) * 0.01;
      const list = messagesRef.current;

      const cyaw = Math.cos(yaw.current);
      const syaw = Math.sin(yaw.current);
      const cp = Math.cos(pitch.current);
      const sp = Math.sin(pitch.current);
      const focal = neuron.reach * 2.35;
      const project = (p: [number, number, number]) => {
        const x1 = p[0] * cyaw - p[2] * syaw;
        const z1 = p[0] * syaw + p[2] * cyaw;
        const y1 = p[1] * cp - z1 * sp;
        const z2 = p[1] * sp + z1 * cp;
        const k = focal / (focal - z2);
        return { x: cx + x1 * unit * k, y: cy + y1 * unit * k, z: z2, k };
      };
      const depthOf = (z: number) =>
        Math.min(1, Math.max(0, (z / neuron.reach + 1) / 2));

      const colour = TYPE_COLORS.semantic[isDark ? 'dark' : 'light'];
      const rgb = hexToRgb(colour);

      ctx.clearRect(0, 0, w, h);

      // light behind the cell
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, unit * 2.8);
      halo.addColorStop(
        0,
        isDark ? 'rgba(0, 190, 180, 0.16)' : 'rgba(0, 150, 145, 0.08)',
      );
      halo.addColorStop(0.55, isDark ? 'rgba(0, 120, 116, 0.05)' : 'rgba(0, 0, 0, 0)');
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      // project the arbor and sort it back to front: that ordering is what
      // makes dendrites pass in front of and behind the soma
      const drawn = segments.map((seg) => {
        const a = project(seg.a);
        const b = project(seg.b);
        return { a, b, wa: seg.wa, wb: seg.wb, z: (a.z + b.z) / 2 };
      });
      drawn.sort((p, q) => p.z - q.z);

      const somaR = neuron.somaR * unit;
      const somaPoint = project([0, 0, 0]);
      const somaKeepOut = somaR * 1.22;

      const strokeSegment = (item: (typeof drawn)[number]) => {
        const depth = depthOf(item.z);
        const k = (item.a.k + item.b.k) / 2;
        const width = ((item.wa + item.wb) / 2) * unit * k;
        ctx.beginPath();
        ctx.moveTo(item.a.x, item.a.y);
        ctx.lineTo(item.b.x, item.b.y);
        ctx.lineCap = 'round';
        // wide dim membrane, then the bright filament inside it
        ctx.strokeStyle = 'rgba(' + rgb + ', ' + (0.07 + 0.2 * depth).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1.2, width * 3);
        ctx.stroke();
        ctx.strokeStyle =
          'rgba(' + rgb + ', ' + (0.16 + 0.7 * depth * depth).toFixed(3) + ')';
        ctx.lineWidth = Math.max(0.9, width * 1.25);
        ctx.stroke();
      };

      const scale = breathe;
      const drawSoma = () => {
        ctx.save();
        ctx.translate(somaPoint.x, somaPoint.y);
        // the body is a lumpy sphere; pitch squashes it a little, which sells
        // the turn of the cell
        ctx.scale(scale, scale * (0.9 + 0.1 * cp));
        ctx.beginPath();
        for (let i = 0; i <= 64; i += 1) {
          const a = (i / 64) * TAU;
          const wobble =
            1 +
            0.09 * Math.sin(neuron.lobes * a + neuron.lobePhase) +
            0.04 * Math.sin(2 * neuron.lobes * a - neuron.lobePhase);
          const x = Math.cos(a) * somaR * wobble;
          const y = Math.sin(a) * somaR * wobble;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const body = ctx.createRadialGradient(
          -somaR * 0.34,
          -somaR * 0.38,
          somaR * 0.12,
          0,
          0,
          somaR * 1.08,
        );
        body.addColorStop(0, 'rgba(' + rgb + ', 0.98)');
        body.addColorStop(0.62, 'rgba(' + rgb + ', 0.72)');
        body.addColorStop(1, 'rgba(' + rgb + ', ' + (isDark ? 0.36 : 0.3) + ')');
        ctx.fillStyle = body;
        ctx.fill();
        ctx.strokeStyle = 'rgba(' + rgb + ', 0.9)';
        ctx.lineWidth = Math.max(0.8, unit * 0.026);
        ctx.stroke();

        // nucleus sits toward the viewer, so it moves with the turning
        const shift = 0.09;
        const nx = Math.sin(yaw.current) * somaR * shift;
        const ny = Math.cos(pitch.current) * somaR * shift * 0.5;
        const nr = neuron.nucleus * unit;
        const nuc = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr * 1.3);
        nuc.addColorStop(0, isDark ? 'rgba(4, 20, 20, 0.72)' : 'rgba(255,255,255,0.55)');
        nuc.addColorStop(1, isDark ? 'rgba(6, 28, 28, 0.82)' : 'rgba(255,255,255,0.4)');
        ctx.beginPath();
        ctx.arc(nx, ny, nr, 0, TAU);
        ctx.fillStyle = nuc;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(nx - nr * 0.2, ny - nr * 0.16, nr * 0.36, 0, TAU);
        ctx.fillStyle = 'rgba(' + rgb + ', 0.95)';
        ctx.fill();

        // specular
        ctx.beginPath();
        ctx.arc(-somaR * 0.36, -somaR * 0.42, somaR * 0.15, 0, TAU);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fill();
        ctx.restore();
      };

      const nodes: { x: number; y: number; r: number; index: number }[] = [];
      const ghosts: {
        x: number;
        y: number;
        r: number;
        colour: string;
        label: string;
      }[] = [];

      const clampX = (value: number) => Math.min(Math.max(value, 46), w - 46);
      const clampY = (value: number) => Math.min(Math.max(value, 36), h - 36);

      const anchorScreen = () =>
        anchors.map((tip) => {
          // the message sits a hair beyond the terminal it hangs from
          const p = project([
            tip.x + tip.dx * 0.05,
            tip.y + tip.dy * 0.05,
            tip.z + tip.dz * 0.05,
          ]);
          const base = project([tip.x, tip.y, tip.z]);
          return { tip, base, p };
        });

      const screen = anchorScreen();
      // keep the captions from stacking: when two terminals land on top of each
      // other the deeper one slides outward, its stalk showing the true origin
      const placed: { x: number; y: number }[] = [];
      for (const item of [...screen].sort((a, b) => a.p.z - b.p.z)) {
        let px = item.p.x;
        let py = item.p.y;
        for (const other of placed) {
          const dx = px - other.x;
          const dy = py - other.y;
          const d = Math.hypot(dx, dy);
          if (d < 86) {
            const push = (86 - d) / (d || 1);
            px += dx * push;
            py += dy * push;
          }
        }
        // a bead must not land on the cell body: slide it out along the same
        // bearing, the stalk keeps showing where it really hangs
        const ox = px - somaPoint.x;
        const oy = py - somaPoint.y;
        const out = Math.hypot(ox, oy);
        if (out < somaKeepOut) {
          const push = (somaKeepOut - out) / (out || 1);
          px += ox * push;
          py += oy * push;
        }
        placed.push({ x: px, y: py });
        item.p = { ...item.p, x: px, y: py };
      }

      const drawMessage = (index: number, near: boolean) => {
        const message = list[index];
        const { base, p } = screen[index];
        const depth = depthOf(p.z);
        if (near !== depth >= 0.5) return;
        const nodeColour =
          TYPE_COLORS[message.message_type]?.[isDark ? 'dark' : 'light'] ?? colour;
        const nodeRgb = hexToRgb(nodeColour);
        const selected = message.message_id === activeRef.current;
        const hover = hoverRef.current === index;
        const alpha = 0.34 + depth * 0.66;
        const r = Math.min(
          16,
          (selected ? 12.5 : hover ? 11 : 8.5) * (0.7 + depth * 0.55) * p.k,
        );
        const x = clampX(p.x);
        const y = clampY(p.y);
        const rawLabel =
          message.agent_name && message.agent_name !== 'Unknown'
            ? message.agent_name
            : (TYPE_LABELS[message.message_type] ?? message.message_type);
        const label = rawLabel.length > 10 ? rawLabel.slice(0, 10) + '…' : rawLabel;

        if (!near) {
          ghosts.push({ x, y, r: Math.max(r, 7), colour: nodeColour, label });
        }

        // the short stalk that ties the message to its terminal
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(x, y);
        ctx.strokeStyle = 'rgba(' + nodeRgb + ', ' + (0.32 * alpha).toFixed(3) + ')';
        ctx.lineWidth = 1.1 * p.k;
        ctx.stroke();

        // the synapse itself, a small knob on the fibre
        ctx.beginPath();
        ctx.arc(base.x, base.y, Math.max(1.6, 2.4 * p.k), 0, TAU);
        ctx.fillStyle = 'rgba(' + nodeRgb + ', ' + (0.6 * alpha).toFixed(3) + ')';
        ctx.fill();

        if (selected) {
          const pulse = reduced ? 0.5 : Math.sin(time * 2.4) * 0.5 + 0.5;
          ctx.beginPath();
          ctx.arc(x, y, r + 7 + pulse * 4, 0, TAU);
          ctx.strokeStyle = 'rgba(' + nodeRgb + ', ' + (0.4 * alpha).toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
        glow.addColorStop(0, 'rgba(' + nodeRgb + ', ' + (0.36 * alpha).toFixed(3) + ')');
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, r * 3, 0, TAU);
        ctx.fill();

        const body = ctx.createRadialGradient(
          x - r * 0.34,
          y - r * 0.4,
          r * 0.1,
          x,
          y,
          r * 1.05,
        );
        body.addColorStop(0, 'rgba(' + nodeRgb + ', ' + Math.min(1, 0.55 * alpha + 0.3) + ')');
        body.addColorStop(1, 'rgba(' + nodeRgb + ', ' + (0.22 * alpha).toFixed(3) + ')');
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = body;
        ctx.fill();
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = 'rgba(' + nodeRgb + ', ' + alpha.toFixed(3) + ')';
        ctx.stroke();

        if (selected) {
          ctx.beginPath();
          ctx.arc(x, y, r * 0.42, 0, TAU);
          ctx.fillStyle = isDark ? 'rgba(8, 16, 18, 0.9)' : 'rgba(255, 255, 255, 0.9)';
          ctx.fill();
        }

        nodes.push({ x, y, r: r + 9, index });

        if (depth < 0.44) return;
        ctx.font =
          (selected || hover ? '600' : '500') +
          ' 12px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.shadowColor = isDark ? 'rgba(3, 10, 10, 0.85)' : 'rgba(255,255,255,0.9)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = selected
          ? isDark
            ? 'rgba(235, 250, 248, ' + Math.min(1, alpha + 0.2) + ')'
            : 'rgba(12, 40, 40, ' + Math.min(1, alpha + 0.2) + ')'
          : isDark
            ? 'rgba(210, 230, 228, ' + (0.72 * alpha).toFixed(3) + ')'
            : 'rgba(40, 70, 70, ' + (0.72 * alpha).toFixed(3) + ')';
        ctx.fillText(label, x, y + r + 7);
        ctx.shadowBlur = 0;
      };

      // far half of the messages, then the arbor, then the near half
      for (let i = 0; i < list.length; i += 1) drawMessage(i, false);

      // synaptic knobs on every terminal, so the arbor reads as a real cell
      const drawTip = (tip: Tip3D, near: boolean) => {
        const q = project([tip.x, tip.y, tip.z]);
        const depth = depthOf(q.z);
        if (near !== depth >= 0.5) return;
        ctx.beginPath();
        ctx.arc(q.x, q.y, Math.max(1.1, 2.4 * q.k * (0.55 + depth * 0.7)), 0, TAU);
        ctx.fillStyle =
          'rgba(' + rgb + ', ' + (0.22 + 0.42 * depth).toFixed(3) + ')';
        ctx.fill();
      };
      for (const tip of neuron.tips) drawTip(tip, false);

      let somaDrawn = false;
      for (const item of drawn) {
        if (!somaDrawn && item.z > 0) {
          drawSoma();
          somaDrawn = true;
        }
        strokeSegment(item);
      }
      if (!somaDrawn) drawSoma();
      for (const tip of neuron.tips) drawTip(tip, true);

      for (let i = 0; i < list.length; i += 1) drawMessage(i, true);

      for (const ghost of ghosts) {
        const rad = Math.max(ghost.r * 1.55, 9);
        // seen through the cell: a dim bead behind a dashed outline
        ctx.beginPath();
        ctx.arc(ghost.x, ghost.y, Math.max(5, rad * 0.52), 0, TAU);
        ctx.fillStyle = 'rgba(' + hexToRgb(ghost.colour) + ', 0.45)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ghost.x, ghost.y, rad, 0, TAU);
        ctx.strokeStyle = 'rgba(' + hexToRgb(ghost.colour) + ', 0.62)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
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
  }, [neuron, segments, anchors]);

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
          sway.current = false;
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
