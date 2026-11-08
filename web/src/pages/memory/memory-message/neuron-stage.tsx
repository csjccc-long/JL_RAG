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

interface BranchShape {
  pts: [number, number, number][];
  widths: number[];
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

  // keep the arbor as continuous strands: stroking them point to point keeps
  // the taper smooth instead of leaving a bead at every joint
  const branches = useMemo<BranchShape[]>(
    () =>
      neuron.branches.map((branch) => {
        const pts: [number, number, number][] = [];
        for (let i = 0; i < branch.pts.length; i += 3) {
          pts.push([branch.pts[i], branch.pts[i + 1], branch.pts[i + 2]]);
        }
        return { pts, widths: branch.w };
      }),
    [neuron],
  );

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

    // the arbor is painted into two offscreen layers — one behind the soma and
    // one in front — so overlapping strokes cannot stack up into beads
    const farLayer = document.createElement('canvas');
    const nearLayer = document.createElement('canvas');
    const farCtx = farLayer.getContext('2d');
    const nearCtx = nearLayer.getContext('2d');
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeState.current = { w: rect.width, h: rect.height };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const [layer, layerCtx] of [
        [farLayer, farCtx] as const,
        [nearLayer, nearCtx] as const,
      ]) {
        if (!layerCtx) continue;
        layer.width = canvas.width;
        layer.height = canvas.height;
        layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
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
      const membraneStroke = isDark ? 'rgba(16, 126, 120, 1)' : 'rgba(120, 205, 198, 1)';
      const coreStroke = isDark ? 'rgba(196, 255, 246, 1)' : 'rgba(12, 128, 120, 1)';

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
      const drawn = branches.map((branch) => {
        const screen = branch.pts.map((point) => project(point));
        let z = 0;
        let k = 0;
        for (const point of screen) {
          z += point.z;
          k += point.k;
        }
        return {
          screen,
          widths: branch.widths,
          z: z / screen.length,
          k: k / screen.length,
        };
      });
      drawn.sort((p, q) => p.z - q.z);

      const somaR = neuron.somaR * unit;
      const somaPoint = project([0, 0, 0]);
      const somaKeepOut = somaR * 1.22;

      // one stroke per stretch of a strand: the width follows the taper, and
      // because the layer is opaque the joins cannot stack into beads
      // a strand is filled rather than stroked: a ribbon whose width follows the
      // taper has soft edges and no caps, so nothing can step or bead
      const strokeStrands = (
        layer: CanvasRenderingContext2D,
        group: typeof drawn,
        scale: number,
        fill: string,
      ) => {
        layer.fillStyle = fill;
        for (const item of group) {
          const count = item.screen.length;
          if (count < 2) continue;
          const raw = item.screen.map((point, i) => ({
            x: point.x,
            y: point.y,
            w: Math.max(
              0.8,
              (item.widths[i] ?? 0.05) * unit * item.k * scale,
            ),
          }));
          // one smoothing pass, then the two offset rails of the ribbon
          const pts: typeof raw = [];
          for (let i = 0; i < raw.length - 1; i += 1) {
            const a = raw[i];
            const b = raw[i + 1];
            pts.push({
              x: a.x * 0.75 + b.x * 0.25,
              y: a.y * 0.75 + b.y * 0.25,
              w: a.w * 0.75 + b.w * 0.25,
            });
            pts.push({
              x: a.x * 0.25 + b.x * 0.75,
              y: a.y * 0.25 + b.y * 0.75,
              w: a.w * 0.25 + b.w * 0.75,
            });
          }
          const left: { x: number; y: number }[] = [];
          const right: { x: number; y: number }[] = [];
          for (let i = 0; i < pts.length; i += 1) {
            const prev = pts[Math.max(0, i - 1)];
            const next = pts[Math.min(pts.length - 1, i + 1)];
            let dx = next.x - prev.x;
            let dy = next.y - prev.y;
            const len = Math.hypot(dx, dy) || 1;
            dx /= len;
            dy /= len;
            const half = pts[i].w * 0.5;
            left.push({ x: pts[i].x - dy * half, y: pts[i].y + dx * half });
            right.push({ x: pts[i].x + dy * half, y: pts[i].y - dx * half });
          }
          layer.beginPath();
          layer.moveTo(left[0].x, left[0].y);
          for (let i = 1; i < left.length; i += 1) layer.lineTo(left[i].x, left[i].y);
          for (let i = right.length - 1; i >= 0; i -= 1) {
            layer.lineTo(right[i].x, right[i].y);
          }
          layer.closePath();
          layer.fill();
          // rounded ends, so a fork looks like a branch and not a cut ribbon
          for (const end of [pts[0], pts[pts.length - 1]]) {
            layer.beginPath();
            layer.arc(end.x, end.y, end.w * 0.5, 0, TAU);
            layer.fill();
          }
        }
      };

      const paintArbor = (
        layer: CanvasRenderingContext2D,
        group: typeof drawn,
      ) => {
        layer.clearRect(0, 0, w, h);
        layer.lineJoin = 'round';
        layer.lineCap = 'round';
        strokeStrands(layer, group, 2.2, membraneStroke);
        // the filament replaces the middle of the membrane instead of being
        // laid over it, so the strands keep a halo without extra opacity
        layer.globalCompositeOperation = 'source-atop';
        strokeStrands(layer, group, 1, coreStroke);
        layer.globalCompositeOperation = 'source-over';
      };

      const rot3 = (v: [number, number, number]) => {
        const x1 = v[0] * cyaw - v[2] * syaw;
        const z1 = v[0] * syaw + v[2] * cyaw;
        const y1 = v[1] * cp - z1 * sp;
        const z2 = v[1] * sp + z1 * cp;
        return { x: x1, y: y1, z: z2 };
      };

      const drawSoma = () => {
        ctx.save();
        ctx.translate(somaPoint.x, somaPoint.y);
        ctx.scale(breathe, breathe);
        const R = somaR;

        // the silhouette carries the lobes: as the cell turns they slide around
        // the rim instead of sitting still like a flat badge
        ctx.beginPath();
        for (let i = 0; i <= 96; i += 1) {
          const a = (i / 96) * TAU;
          let wobble = 1 + 0.018 * Math.sin(2 * a + yaw.current);
          for (const bump of neuron.bumps) {
            const r3 = rot3(bump.dir);
            if (r3.z <= 0) continue;
            const ba = Math.atan2(r3.y, r3.x);
            const d = Math.abs(((a - ba + Math.PI * 4) % TAU) - Math.PI);
            wobble += 0.075 * bump.size * r3.z * Math.exp(-(d * d) / 0.12);
          }
          const x = Math.cos(a) * R * wobble;
          const y = Math.sin(a) * R * wobble;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();

        // lit sphere: light from the upper left, falling off to the limb
        const body = ctx.createRadialGradient(-R * 0.38, -R * 0.46, R * 0.04, 0, 0, R * 1.04);
        body.addColorStop(0, 'rgba(216, 255, 250, 0.98)');
        body.addColorStop(0.34, 'rgba(' + rgb + ', 0.98)');
        body.addColorStop(0.72, 'rgba(' + rgb + ', 0.9)');
        body.addColorStop(
          0.9,
          isDark ? 'rgba(16, 104, 98, 0.92)' : 'rgba(122, 214, 206, 0.94)',
        );
        body.addColorStop(
          1,
          isDark ? 'rgba(5, 50, 48, 0.95)' : 'rgba(72, 168, 160, 0.95)',
        );
        ctx.fillStyle = body;
        ctx.fill();

        // limb darkening pulls the edge away from the viewer
        const limb = ctx.createRadialGradient(
          -R * 0.3,
          -R * 0.36,
          R * 0.2,
          0,
          0,
          R * 1.02,
        );
        limb.addColorStop(0, 'rgba(0, 0, 0, 0)');
        limb.addColorStop(0.62, isDark ? 'rgba(0, 20, 20, 0.1)' : 'rgba(0, 40, 40, 0.05)');
        limb.addColorStop(1, isDark ? 'rgba(0, 8, 8, 0.6)' : 'rgba(0, 34, 34, 0.26)');
        ctx.fillStyle = limb;
        ctx.fill();

        // the surface lobes themselves: a lit crest and its shaded flank
        ctx.save();
        ctx.clip();
        for (const bump of neuron.bumps) {
          const r3 = rot3(bump.dir);
          if (r3.z <= 0.02) continue;
          const bx = r3.x * R * 0.9;
          const by = r3.y * R * 0.9;
          const br = R * 0.5 * bump.size * (0.5 + r3.z * 0.5);
          const shade = ctx.createRadialGradient(
            bx + R * 0.09,
            by + R * 0.1,
            br * 0.15,
            bx + R * 0.09,
            by + R * 0.1,
            br * 1.15,
          );
          shade.addColorStop(0, 'rgba(0, 14, 14, ' + (0.3 * r3.z).toFixed(3) + ')');
          shade.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = shade;
          ctx.beginPath();
          ctx.arc(bx + R * 0.09, by + R * 0.1, br * 1.15, 0, TAU);
          ctx.fill();
          const crest = ctx.createRadialGradient(bx, by, 0, bx, by, br);
          crest.addColorStop(0, 'rgba(255, 255, 255, ' + (0.22 * r3.z).toFixed(3) + ')');
          crest.addColorStop(0.55, 'rgba(' + rgb + ', ' + (0.14 * r3.z).toFixed(3) + ')');
          crest.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = crest;
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, TAU);
          ctx.fill();
        }
        ctx.restore();

        // nucleus: a body suspended inside the cell. Its edge fades into the
        // surrounding gel so the centre reads as depth rather than a pupil
        // painted on a disc.
        const nuc3 = rot3([0.22, -0.18, 0.75]);
        const nr = neuron.nucleus * unit * (0.82 + nuc3.z * 0.24);
        const nx = nuc3.x * R * 0.46;
        const ny = nuc3.y * R * 0.46;
        const nuc = ctx.createRadialGradient(nx - nr * 0.3, ny - nr * 0.34, nr * 0.05, nx, ny, nr * 1.2);
        nuc.addColorStop(0, isDark ? 'rgba(64, 156, 148, 0.9)' : 'rgba(255, 255, 255, 0.95)');
        nuc.addColorStop(0.5, isDark ? 'rgba(22, 88, 84, 0.82)' : 'rgba(232, 250, 248, 0.8)');
        nuc.addColorStop(0.8, isDark ? 'rgba(9, 48, 46, 0.6)' : 'rgba(186, 228, 224, 0.45)');
        nuc.addColorStop(1, isDark ? 'rgba(9, 48, 46, 0)' : 'rgba(186, 228, 224, 0)');
        ctx.beginPath();
        ctx.arc(nx, ny, nr * 1.2, 0, TAU);
        ctx.fillStyle = nuc;
        ctx.fill();

        ctx.strokeStyle = 'rgba(' + rgb + ', 0.55)';
        ctx.lineWidth = Math.max(0.7, unit * 0.02);
        ctx.stroke();

        // specular highlight on the lit shoulder, plus a cooler bounce on the
        // shadow side: together they read as a glossy volume, not a flat disc
        const spec = ctx.createRadialGradient(
          -R * 0.42,
          -R * 0.48,
          0,
          -R * 0.42,
          -R * 0.48,
          R * 0.46,
        );
        spec.addColorStop(0, isDark ? 'rgba(255, 255, 255, 0.52)' : 'rgba(255, 255, 255, 0.8)');
        spec.addColorStop(0.45, isDark ? 'rgba(226, 255, 251, 0.12)' : 'rgba(255, 255, 255, 0.2)');
        spec.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = spec;
        ctx.beginPath();
        ctx.arc(-R * 0.42, -R * 0.48, R * 0.46, 0, TAU);
        ctx.fill();
        const bounce = ctx.createRadialGradient(R * 0.44, R * 0.5, 0, R * 0.44, R * 0.5, R * 0.5);
        bounce.addColorStop(0, isDark ? 'rgba(' + rgb + ', 0.34)' : 'rgba(' + rgb + ', 0.2)');
        bounce.addColorStop(1, 'rgba(' + rgb + ', 0)');
        ctx.fillStyle = bounce;
        ctx.beginPath();
        ctx.arc(R * 0.44, R * 0.5, R * 0.5, 0, TAU);
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

      // the far half of the arbor, then the body, then the near half: the soma
      // cuts the cell in two and the layers keep each half flat
      const behind = drawn.filter((item) => item.z < 0);
      const front = drawn.filter((item) => item.z >= 0);
      // each half is laid down twice: a blurred pass for the glow of a living
      // membrane, then the crisp strand on top
      const layDown = (layer: HTMLCanvasElement, alpha: number) => {
        ctx.globalAlpha = alpha * 0.75;
        ctx.filter = 'blur(11px)';
        ctx.drawImage(layer, 0, 0, w, h);
        ctx.filter = 'none';
        ctx.globalAlpha = alpha;
        ctx.drawImage(layer, 0, 0, w, h);
        ctx.globalAlpha = 1;
      };
      if (farCtx) {
        paintArbor(farCtx, behind);
        layDown(farLayer, isDark ? 0.38 : 0.32);
      }
      if (nearCtx) {
        paintArbor(nearCtx, front);
        layDown(nearLayer, isDark ? 0.95 : 0.9);
      }
      // the body sits in front of its own processes: the arbor grows out from
      // behind it, so the shaded sphere stays readable as the centre
      drawSoma();
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
  }, [neuron, branches, anchors]);

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
