import { formatPureDate } from '@/utils/date';
import { IMemory, MemoryType } from './interface';

/**
 * Geometry for the memory brain: a small procedural cortex (point cloud +
 * gyri curves) and the neuron layout derived from the memory list. Kept free
 * of React so the same model can be rendered in a preview harness.
 */

export type Vec3 = { x: number; y: number; z: number };

export const MEMORY_TYPES: MemoryType[] = [
  'semantic',
  'episodic',
  'procedural',
  'raw',
];

/** FNV-1a: stable seeds, so a memory keeps its neuron across reloads. */
export function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32: tiny deterministic PRNG. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* cortex                                                              */
/* ------------------------------------------------------------------ */

const CORTEX_R = { x: 1.02, y: 0.8, z: 0.94 };
const CEREBELLUM_R = { x: 0.26, y: 0.2, z: 0.24 };
const CEREBELLUM_C = { x: 0.24, y: -0.48, z: -0.5 };

function fibSphere(count: number): Vec3[] {
  const out: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    out.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius });
  }
  return out;
}

/**
 * Brain silhouette field: a bulge for the temporal lobes, a tapered frontal
 * pole and a rounder occipital lobe, plus low-frequency folds so the outline
 * reads as a brain rather than an egg.
 */
function cortexScale(d: Vec3): number {
  const temporal = Math.exp(
    -(
      Math.pow((Math.abs(d.x) - 0.84) / 0.36, 2) +
      Math.pow((d.y + 0.3) / 0.46, 2) +
      Math.pow((d.z - 0.1) / 0.62, 2)
    ),
  );
  const frontal = Math.max(0, d.z) ** 3;
  const occipital = Math.max(0, -d.z) ** 2;
  return (
    1 +
    0.11 * temporal -
    0.08 * frontal +
    0.035 * occipital +
    0.04 * Math.sin(5.4 * d.y + 2.1 * d.z) +
    0.028 * Math.sin(7.1 * d.x - 3.4 * d.z) +
    0.014 * Math.sin(9.3 * d.z + 2.6 * d.x + 1.4)
  );
}

function cortexPoint(d: Vec3, k: number): Vec3 {
  const raw = d.y * CORTEX_R.y * k;
  return {
    x: d.x * CORTEX_R.x * k,
    // flatten the underside so the brain sits in the skull instead of floating
    y: raw < -0.56 ? -0.56 - (raw + 0.56) * 0.32 : raw,
    z: d.z * CORTEX_R.z * k,
  };
}

export interface BrainGeometry {
  /** xyz triples */
  cortex: Float32Array;
  cortexDir: Float32Array;
  cerebellum: Float32Array;
  cerebellumDir: Float32Array;
  stem: Float32Array;
  stemDir: Float32Array;
  /** one flat xyz polyline per gyrus */
  gyri: Float32Array[];
  /** latitude / meridian polylines of the cortical surface */
  mesh: Float32Array[];
}

export function buildBrainGeometry(): BrainGeometry {
  const rng = makeRng(0x9e3779b9);

  const cortexPts: Vec3[] = [];
  const cortexDirs: Vec3[] = [];
  for (const d of fibSphere(3600)) {
    // interhemispheric fissure: a slit along x = 0 over the top half
    if (Math.abs(d.x) < 0.075 && d.y > -0.32) continue;
    // leave the underside open where the brain stem leaves the skull
    if (d.y < -0.72 && Math.abs(d.x) < 0.3 && d.z < 0.1) continue;
    cortexPts.push(cortexPoint(d, cortexScale(d)));
    cortexDirs.push(d);
  }

  const cblPts: Vec3[] = [];
  const cblDirs: Vec3[] = [];
  const cbl = fibSphere(760);
  for (const side of [-1, 1]) {
    for (const d of cbl) {
      // folia: thin folds across the cerebellum
      const fold = 1 + 0.06 * Math.sin(16 * d.x + 5 * d.z);
      cblPts.push({
        x: side * (CEREBELLUM_C.x + d.x * CEREBELLUM_R.x * fold),
        y: CEREBELLUM_C.y + d.y * CEREBELLUM_R.y * fold,
        z: CEREBELLUM_C.z + d.z * CEREBELLUM_R.z,
      });
      cblDirs.push({ x: side * d.x, y: d.y, z: d.z });
    }
  }

  const stemPts: Vec3[] = [];
  const stemDirs: Vec3[] = [];
  const stemCount = 170;
  for (let i = 0; i < stemCount; i += 1) {
    const t = i / (stemCount - 1);
    const angle = t * Math.PI * 2 * 6 + rng() * 0.4;
    const radius = 0.13 - t * 0.07;
    stemPts.push({
      x: Math.cos(angle) * radius,
      y: -0.44 - t * 0.16,
      z: -0.42 - t * 0.1 + Math.sin(angle) * radius,
    });
    stemDirs.push({ x: Math.cos(angle), y: 0, z: Math.sin(angle) });
  }

  // gyri: short arcs traced on the surface, for cortical folding
  const gyri: Float32Array[] = [];
  for (let g = 0; g < 170; g += 1) {
    const axis = randomUnit(rng);
    // rotate the ORIGINAL direction every step: advancing the running
    // direction compounds the angle and a "short fold" winds around the sphere
    const origin = randomUnit(rng, axis, 0.35 + rng() * 0.5);
    const sweep = 0.18 + rng() * 0.42;
    const steps = 12;
    const pts: number[] = [];
    for (let i = 0; i < steps; i += 1) {
      const angle = (i / (steps - 1) - 0.5) * sweep;
      const rotated = rotateAround(origin, axis, angle);
      const p = cortexPoint(rotated, cortexScale(rotated));
      pts.push(p.x, p.y, p.z);
    }
    gyri.push(new Float32Array(pts));
  }

  // mesh: latitudes and meridians of the same surface, so the brain reads as a
  // modelled 3D object instead of a dust cloud
  const mesh: Float32Array[] = [];
  const onSurface = (d: Vec3) =>
    !(Math.abs(d.x) < 0.075 && d.y > -0.32) &&
    !(d.y < -0.72 && Math.abs(d.x) < 0.3 && d.z < 0.1);

  for (let lat = -0.9; lat <= 0.92; lat += 0.145) {
    const ringY = Math.sin(lat);
    const ringR = Math.cos(lat);
    const pts: number[] = [];
    const steps = 72;
    for (let i = 0; i <= steps; i += 1) {
      const t = (i / steps) * Math.PI * 2;
      const d = { x: Math.cos(t) * ringR, y: ringY, z: Math.sin(t) * ringR };
      if (!onSurface(d)) {
        if (pts.length > 3) mesh.push(new Float32Array(pts));
        pts.length = 0;
        continue;
      }
      const p = cortexPoint(d, cortexScale(d));
      pts.push(p.x, p.y, p.z);
    }
    if (pts.length > 3) mesh.push(new Float32Array(pts));
  }

  for (let m = 0; m < 12; m += 1) {
    const theta = (m / 12) * Math.PI * 2;
    const pts: number[] = [];
    const steps = 44;
    for (let i = 0; i <= steps; i += 1) {
      const lat = (i / steps) * Math.PI - Math.PI / 2;
      const ringR = Math.cos(lat);
      const d = {
        x: Math.cos(theta) * ringR,
        y: Math.sin(lat),
        z: Math.sin(theta) * ringR,
      };
      if (!onSurface(d)) {
        if (pts.length > 3) mesh.push(new Float32Array(pts));
        pts.length = 0;
        continue;
      }
      const p = cortexPoint(d, cortexScale(d));
      pts.push(p.x, p.y, p.z);
    }
    if (pts.length > 3) mesh.push(new Float32Array(pts));
  }

  return {
    cortex: flatten(cortexPts),
    cortexDir: flatten(cortexDirs),
    cerebellum: flatten(cblPts),
    cerebellumDir: flatten(cblDirs),
    stem: flatten(stemPts),
    stemDir: flatten(stemDirs),
    gyri,
    mesh,
  };
}

function flatten(points: Vec3[]): Float32Array {
  const out = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  });
  return out;
}

function randomUnit(rng: () => number, notParallel?: Vec3, spread = 1): Vec3 {
  for (let i = 0; i < 40; i += 1) {
    const z = rng() * 2 - 1;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const v = { x: Math.cos(a) * r, y: z, z: Math.sin(a) * r };
    if (!notParallel) return v;
    const dot = v.x * notParallel.x + v.y * notParallel.y + v.z * notParallel.z;
    if (Math.abs(dot) < spread) return v;
  }
  return { x: 1, y: 0, z: 0 };
}

function rotateAround(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dot = v.x * axis.x + v.y * axis.y + v.z * axis.z;
  return {
    x: v.x * c + (axis.y * v.z - axis.z * v.y) * s + axis.x * dot * (1 - c),
    y: v.y * c + (axis.z * v.x - axis.x * v.z) * s + axis.y * dot * (1 - c),
    z: v.z * c + (axis.x * v.y - axis.y * v.x) * s + axis.z * dot * (1 - c),
  };
}

/* ------------------------------------------------------------------ */
/* neurons                                                             */
/* ------------------------------------------------------------------ */

export const TYPE_COLORS: Record<
  MemoryType,
  { dark: string; light: string }
> = {
  semantic: { dark: '#54e3d6', light: '#0a8f88' },
  episodic: { dark: '#ffb173', light: '#c96a1d' },
  procedural: { dark: '#b49bff', light: '#6f4cd2' },
  raw: { dark: '#9db4c9', light: '#546b80' },
};

interface Lobe {
  c: Vec3;
  r: Vec3;
}

const LOBES: Record<MemoryType, Lobe> = {
  semantic: {
    c: { x: -0.42, y: 0.2, z: 0.2 },
    r: { x: 0.3, y: 0.3, z: 0.34 },
  },
  episodic: {
    c: { x: 0.42, y: 0.18, z: 0.16 },
    r: { x: 0.3, y: 0.3, z: 0.34 },
  },
  procedural: {
    c: { x: 0, y: -0.26, z: -0.44 },
    r: { x: 0.44, y: 0.22, z: 0.26 },
  },
  raw: {
    c: { x: 0, y: 0.02, z: 0.5 },
    r: { x: 0.36, y: 0.4, z: 0.22 },
  },
};

export interface Neuron {
  id: string;
  name: string;
  date: string;
  type: MemoryType;
  pos: Vec3;
  seed: number;
  radius: number;
  /** dendrite arms, in screen-space units */
  arms: { dx: number; dy: number; len: number; wobble: number }[];
}

export interface Edge {
  a: number;
  b: number;
  phase: number;
  speed: number;
  bend: number;
}

export interface BrainLayout {
  neurons: Neuron[];
  edges: Edge[];
}

const MAX_NEURONS = 72;

export function buildLayout(memories: IMemory[]): BrainLayout {
  const picked = memories.slice(0, MAX_NEURONS);
  const mixed = new Set(picked.map((m) => pickType(m))).size > 1;
  const used: Vec3[] = [];

  const neurons: Neuron[] = picked.map((memory, index) => {
    const seed = hashSeed(String(memory.id ?? memory.name ?? index));
    const rng = makeRng(seed);
    const type = pickType(memory);
    // when every memory shares a type, spread them over the four lobes so the
    // picture still reads as a network instead of one dense knot
    const lobe = LOBES[mixed ? type : MEMORY_TYPES[seed % MEMORY_TYPES.length]];
    const pos = placeNeuron(rng, lobe, used);
    used.push(pos);
    const size = Number(memory.memory_size) || 0;
    // a young brain holds one or two memories: make them worth looking at
    const scale = picked.length <= 3 ? 1.7 : picked.length <= 8 ? 1.35 : 1;
    const radius = (2.1 + Math.min(1.6, Math.log10(size + 10) * 0.45)) * scale;
    const arms = Array.from({ length: 5 + Math.floor(rng() * 3) }, () => {
      const angle = rng() * Math.PI * 2;
      return {
        dx: Math.cos(angle),
        dy: Math.sin(angle),
        len: 7 + rng() * 7,
        wobble: 0.25 + rng() * 0.5,
      };
    });
    return {
      id: String(memory.id ?? index),
      name: memory.name ?? '',
      date: formatPureDate(memory.create_time),
      type,
      pos,
      seed,
      radius,
      arms,
    };
  });

  return { neurons, edges: connect(neurons) };
}

function pickType(memory: IMemory): MemoryType {
  const types = Array.isArray(memory.memory_type) ? memory.memory_type : [];
  const first = types.find((t) => MEMORY_TYPES.includes(t));
  return first ?? 'raw';
}

function insideLobe(p: Vec3, lobe: Lobe): boolean {
  const dx = (p.x - lobe.c.x) / lobe.r.x;
  const dy = (p.y - lobe.c.y) / lobe.r.y;
  const dz = (p.z - lobe.c.z) / lobe.r.z;
  return dx * dx + dy * dy + dz * dz <= 1;
}

function insideBrain(p: Vec3): boolean {
  const dx = p.x / (CORTEX_R.x * 0.82);
  const dy = p.y / (CORTEX_R.y * 0.82);
  const dz = p.z / (CORTEX_R.z * 0.82);
  return dx * dx + dy * dy + dz * dz <= 1 && p.y > -0.55;
}

function placeNeuron(rng: () => number, lobe: Lobe, used: Vec3[]): Vec3 {
  let fallback: Vec3 = lobe.c;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const p = {
      x: lobe.c.x + (rng() * 2 - 1) * lobe.r.x,
      y: lobe.c.y + (rng() * 2 - 1) * lobe.r.y,
      z: lobe.c.z + (rng() * 2 - 1) * lobe.r.z,
    };
    if (!insideLobe(p, lobe) || !insideBrain(p)) continue;
    fallback = p;
    if (used.every((u) => dist(u, p) > 0.17)) return p;
  }
  return fallback;
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Wires the neurons: two nearest neighbours of the same type plus the nearest
 * neuron of another type, so the graph has both clusters and bridges.
 */
function connect(neurons: Neuron[]): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const add = (a: number, b: number) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      a,
      b,
      phase: (hashSeed(key) % 1000) / 1000,
      speed: 0.16 + ((hashSeed(`${key}s`) % 100) / 100) * 0.16,
      bend: 0.1 + ((hashSeed(`${key}b`) % 100) / 100) * 0.12,
    });
  };

  neurons.forEach((neuron, i) => {
    neurons
      .map((other, j) => ({
        j,
        d: dist(neuron.pos, other.pos),
        same: other.type === neuron.type,
      }))
      .filter((x) => x.j !== i && x.same)
      .sort((x, y) => x.d - y.d)
      .slice(0, 1)
      .forEach((x) => {
        if (x.d < 0.42) add(i, x.j);
      });

    // one short bridge to another kind of memory: long links across the whole
    // brain read as noise, they have to be neighbours to mean "related"
    const bridge = neurons
      .map((o, j) => ({ j, d: dist(neuron.pos, o.pos), same: o.type === neuron.type }))
      .filter((x) => x.j !== i && !x.same)
      .sort((x, y) => x.d - y.d)[0];
    if (bridge && bridge.d < 0.5) add(i, bridge.j);
  });

  return edges;
}
