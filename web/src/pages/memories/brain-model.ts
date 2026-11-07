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

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
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

/** evenly spaced directions on the unit sphere (golden angle spiral) */
function fibSphere(count: number): Vec3[] {
  const out: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = golden * i;
    out.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* cortex                                                              */
/* ------------------------------------------------------------------ */

/**
 * The lateral silhouette is authored by hand and the body is swept from it, so
 * the profile the visitor sees is always a brain profile: frontal pole, the
 * temporal lobe with the Sylvian notch above it, the cerebellum tucked under
 * the occipital pole. Cross sections shrink towards the midline, which keeps
 * the top and front views rounded instead of a flat cut-out.
 */
const SILHOUETTE: [number, number][] = [
  [0.94, 0.04],
  [0.88, 0.30],
  [0.74, 0.52],
  [0.52, 0.70],
  [0.26, 0.80],
  [-0.02, 0.82],
  [-0.30, 0.76],
  [-0.58, 0.62],
  [-0.80, 0.42],
  [-0.94, 0.16],
  [-0.97, -0.06],
  [-0.90, -0.26],
  [-0.74, -0.38],
  [-0.70, -0.56],
  [-0.54, -0.68],
  [-0.34, -0.70],
  [-0.18, -0.62],
  [-0.04, -0.55],
  [0.14, -0.56],
  [0.34, -0.52],
  [0.48, -0.42],
  [0.56, -0.32],
  [0.60, -0.22],
  [0.68, -0.24],
  [0.80, -0.19],
  [0.90, -0.08],
];

/** how far the body reaches to either side of the midline */
const X_MAX = 0.62;
const RIM = 220;

function pointInSilhouette(z: number, y: number): boolean {
  let inside = false;
  const n = SILHOUETTE.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const [zi, yi] = SILHOUETTE[i];
    const [zj, yj] = SILHOUETTE[j];
    if (yi > y !== yj > y && z < ((zj - zi) * (y - yi)) / (yj - yi) + zi) {
      inside = !inside;
    }
  }
  return inside;
}

/** polar radius of the hand drawn profile */
function profileRadius(psi: number): number {
  const dz = Math.cos(psi);
  const dy = Math.sin(psi);
  let radius = 0;
  for (let step = 1; step <= 500; step += 1) {
    const t = (step / 500) * 1.15;
    if (!pointInSilhouette(dz * t, dy * t)) break;
    radius = t;
  }
  return radius;
}

const RADII = (() => {
  const table = new Float32Array(RIM);
  for (let i = 0; i < RIM; i += 1) {
    table[i] = profileRadius((i / RIM) * Math.PI * 2);
  }
  // two passes of neighbour averaging, enough to take the facets off the
  // polygon without softening the Sylvian notch and the temporal pole
  for (let pass = 0; pass < 2; pass += 1) {
    const copy = table.slice();
    for (let i = 0; i < RIM; i += 1) {
      table[i] =
        (copy[(i - 1 + RIM) % RIM] + copy[i] * 2 + copy[(i + 1) % RIM]) / 4;
    }
  }
  return table;
})();

function radiusAt(psi: number): number {
  const raw = (((psi / (Math.PI * 2)) % 1) + 1) % 1;
  const f = raw * RIM;
  const i = Math.floor(f) % RIM;
  const mix = f - Math.floor(f);
  return RADII[i] * (1 - mix) + RADII[(i + 1) % RIM] * mix;
}

/** cross sections close off towards the midline with a rounded, not flat, edge */
function taper(t: number): number {
  const a = Math.min(1, Math.abs(t));
  // circular fall-off: the flanks roll away gradually instead of turning on a
  // hard edge, which is what keeps the profile from reading as a bowl
  return Math.sqrt(Math.max(0, 1 - a * a));
}

function surfacePoint(t: number, psi: number): Vec3 {
  const r = radiusAt(psi) * taper(t);
  return { x: t * X_MAX, y: r * Math.sin(psi), z: r * Math.cos(psi) };
}

function surfaceNormal(t: number, psi: number): Vec3 {
  const e = 0.0035;
  const a = surfacePoint(t + e, psi);
  const b = surfacePoint(t - e, psi);
  const c = surfacePoint(t, psi + e);
  const d = surfacePoint(t, psi - e);
  const n = cross(
    { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z },
    { x: c.x - d.x, y: c.y - d.y, z: c.z - d.z },
  );
  const p = surfacePoint(t, psi);
  const out = n.x * p.x + n.y * p.y + n.z * p.z;
  const len = Math.hypot(n.x, n.y, n.z) || 1;
  const sign = out < 0 ? -1 : 1;
  return {
    x: (n.x / len) * sign,
    y: (n.y / len) * sign,
    z: (n.z / len) * sign,
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
  /** sulci traced as wandering walks over the cortex */
  folds: Float32Array[];
  /** the crest that rides just above each sulcus */
  crests: Float32Array[];
  /** meridian polylines of the cortical surface */
  mesh: Float32Array[];
}

export function buildBrainGeometry(): BrainGeometry {
  const rng = makeRng(0x9e3779b9);

  const cortexPts: Vec3[] = [];
  const cortexDirs: Vec3[] = [];
  for (const d of fibSphere(3400)) {
    const psi = Math.atan2(d.y, d.z);
    const t = Math.max(-0.92, Math.min(0.92, d.x));
    // the shell stops just short of the midline: points that sit exactly on the
    // silhouette pile up into a bright lip
    cortexPts.push(surfacePoint(t, psi));
    cortexDirs.push(surfaceNormal(t, psi));
  }

  // a sulcus wanders across the surface in (t, psi) space and is then mapped
  // back onto the body, so it can never leave the cortex. The crest rides a
  // little above it and catches the light like a gyrus.
  const folds: Float32Array[] = [];
  const crests: Float32Array[] = [];
  for (let g = 0; g < 880; g += 1) {
    let t = rng() * 1.4 - 0.7;
    let psi = rng() * Math.PI * 2;
    let heading = rng() * Math.PI * 2;
    const long = g % 5 === 0;
    const steps = long ? 9 + Math.floor(rng() * 4) : 3 + Math.floor(rng() * 3);
    const step = 0.045 + rng() * 0.04;
    const turn = 0.7 + rng() * 0.9;
    const pts: number[] = [];
    const crestPts: number[] = [];
    for (let i = 0; i < steps; i += 1) {
      heading += (rng() - 0.5) * turn;
      t += Math.cos(heading) * step;
      psi += Math.sin(heading) * step * 1.5;
      if (t > 0.74 || t < -0.74) {
        t = Math.max(-0.74, Math.min(0.74, t));
        heading = Math.PI - heading;
      }
      const p = surfacePoint(t, psi);
      const n = surfaceNormal(t, psi);
      pts.push(p.x, p.y, p.z);
      crestPts.push(p.x + n.x * 0.013, p.y + n.y * 0.013, p.z + n.z * 0.013);
    }
    folds.push(new Float32Array(pts));
    crests.push(new Float32Array(crestPts));
  }

  return {
    cortex: flatten(cortexPts),
    cortexDir: flatten(cortexDirs),
    cerebellum: new Float32Array(0),
    cerebellumDir: new Float32Array(0),
    stem: new Float32Array(0),
    stemDir: new Float32Array(0),
    gyri: [],
    folds,
    crests,
    mesh: [],
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
  // a little inside the swept surface, so a neuron never floats outside it
  const t = p.x / X_MAX;
  if (Math.abs(t) > 0.97) return false;
  const psi = Math.atan2(p.y, p.z);
  const r = Math.hypot(p.y, p.z);
  return r < radiusAt(psi) * taper(t) * 0.9;
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
