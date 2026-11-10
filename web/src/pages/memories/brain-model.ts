import { formatPureDate } from "@/utils/date";
import { IMemory, MemoryType } from "./interface";

/**
 * Geometry for the memory brain: a small procedural cortex (point cloud +
 * gyri curves) and the neuron layout derived from the memory list. Kept free
 * of React so the same model can be rendered in a preview harness.
 */

export type Vec3 = { x: number; y: number; z: number };

export const MEMORY_TYPES: MemoryType[] = [
  "semantic",
  "episodic",
  "procedural",
  "raw",
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
  [0.95, 0.06],
  [0.9, 0.32],
  [0.76, 0.54],
  [0.52, 0.72],
  [0.24, 0.84],
  [-0.04, 0.86],
  [-0.32, 0.8],
  [-0.6, 0.66],
  [-0.82, 0.46],
  [-0.96, 0.18],
  [-0.99, -0.06],
  [-0.92, -0.28],
  [-0.78, -0.42],
  [-0.7, -0.56],
  [-0.58, -0.68],
  // cerebellum, tucked under the occipital pole
  [-0.42, -0.74],
  [-0.26, -0.7],
  [-0.12, -0.62],
  [-0.02, -0.66],
  [0.06, -0.76],
  [0.14, -0.78],
  [0.2, -0.7],
  [0.26, -0.62],
  // temporal pole, then the orbital surface towards the frontal pole
  [0.36, -0.54],
  [0.5, -0.48],
  [0.6, -0.36],
  [0.64, -0.26],
  [0.72, -0.26],
  [0.82, -0.2],
  [0.92, -0.08],
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
  for (let pass = 0; pass < 5; pass += 1) {
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
  /** the few deep fissures (lateral, central) that break the cortex into lobes */
  deepFolds: Float32Array[];
  deepCrests: Float32Array[];
  /** meridian polylines of the cortical surface */
  mesh: Float32Array[];
  /** the lateral profile itself, so the drawn outline keeps its notches */
  outline: Float32Array;
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
    const swell = 1 + 0.016 * Math.sin(psi * 5.4 + Math.sin(t * 6.2) * 1.1);
    const p0 = surfacePoint(t, psi);
    cortexPts.push({ x: p0.x * swell, y: p0.y * swell, z: p0.z * swell });
    cortexDirs.push(surfaceNormal(t, psi));
  }

  // ---- gyri -----------------------------------------------------------
  // The folds are long, coherent ribbons rather than random scratches: one
  // ribbon per angular band, meandering front-to-back with three octaves of
  // smooth noise so neighbouring gyri stay roughly parallel while never
  // running dead straight. A sulcus (dark trough) and its crest (bright ridge)
  // are traced from the same walk, which is what makes the surface read as
  // folded cortex instead of a hatched sphere.
  const folds: Float32Array[] = [];
  const crests: Float32Array[] = [];
  const deepFolds: Float32Array[] = [];
  const deepCrests: Float32Array[] = [];

  const traceRibbon = (
    sulci: Float32Array[],
    ridges: Float32Array[],
    psiAt: (u: number) => number,
    tAt: (u: number) => number,
    steps: number,
    lift: number,
    sink: number,
  ) => {
    const trough: number[] = [];
    const ridge: number[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const u = i / steps;
      const t = tAt(u);
      const psi = psiAt(u);
      const p = surfacePoint(t, psi);
      const n = surfaceNormal(t, psi);
      trough.push(p.x - n.x * sink, p.y - n.y * sink, p.z - n.z * sink);
      ridge.push(p.x + n.x * lift, p.y + n.y * lift, p.z + n.z * lift);
    }
    sulci.push(new Float32Array(trough));
    ridges.push(new Float32Array(ridge));
  };

  // Sulci as level sets of a warped gyral field: bands stay nested and can
  // never cross, while the warp bends them into the S-curves a lateral cortex
  // shows. Each band is broken into segments so the trough shows between them.
  const liftToSurface = (z: number, y: number): number | null => {
    const rho = Math.hypot(z, y);
    const psi = Math.atan2(y, z);
    const prof = radiusAt(psi) || 1e-6;
    if (rho >= prof * 0.94) return null;
    const ratio = rho / prof;
    return Math.sqrt(Math.max(0, 1 - ratio * ratio));
  };

  const pushGyrus = (walk: [number, number][], gain: number) => {
    if (walk.length < 4) return;
    for (const side of [1, -1]) {
      const trough: number[] = [];
      const ridge: number[] = [];
      for (const [pz, py] of walk) {
        const lift = liftToSurface(pz, py);
        if (lift === null) continue;
        const psi = Math.atan2(py, pz);
        const p = surfacePoint(side * lift, psi);
        const n = surfaceNormal(side * lift, psi);
        trough.push(p.x - n.x * 0.011, p.y - n.y * 0.011, p.z - n.z * 0.011);
        ridge.push(
          p.x + n.x * 0.012 * gain,
          p.y + n.y * 0.012 * gain,
          p.z + n.z * 0.012 * gain,
        );
      }
      if (trough.length < 12) continue;
      folds.push(new Float32Array(trough));
      crests.push(new Float32Array(ridge));
    }
  };

  // gyri wrap around sulcal pits: nested, slightly eccentric rings traced on the
  // visible face, so bands turn back on themselves instead of running straight
  const GYRAL_CENTRES: [number, number][] = [
    [0.52, 0.34],
    [0.46, -0.06],
    [0.3, -0.4],
    [0.06, 0.54],
    [-0.1, 0.2],
    [-0.22, -0.2],
    [-0.44, 0.34],
    [-0.62, -0.06],
    [-0.5, -0.44],
  ];
  GYRAL_CENTRES.forEach(([cx, cy], ci) => {
    const rings = 5;
    for (let k = 0; k < rings; k += 1) {
      const radius = 0.045 + k * 0.046 + rng() * 0.008;
      const squash = 0.62 + rng() * 0.26;
      const phase = rng() * Math.PI * 2;
      let walk: [number, number][] = [];
      const steps = 96;
      for (let s = 0; s <= steps; s += 1) {
        const a = (s / steps) * Math.PI * 2;
        const r =
          radius *
          (1 +
            0.12 * Math.sin(3 * a + phase) +
            0.07 * Math.sin(5 * a + ci * 1.7));
        const z = cx + Math.cos(a) * r * 1.05;
        const y = cy + Math.sin(a) * r * squash;
        if (liftToSurface(z, y) === null) {
          if (walk.length > 5) pushGyrus(walk, 0.9 + rng() * 0.3);
          walk = [];
          continue;
        }
        walk.push([z, y]);
      }
      if (walk.length > 5) pushGyrus(walk, 0.9 + rng() * 0.3);
    }
  });

  // cerebellar folia: tight horizontal lamellae packed into the lower lobe
  for (let i = 0; i < 26; i += 1) {
    const y = -0.78 + (i / 25) * 0.26;
    const walk: [number, number][] = [];
    for (let z = 0.0; z <= 0.4; z += 0.012) {
      const yy = y + 0.012 * Math.sin(z * 26 + i);
      if (liftToSurface(z, yy) === null) {
        if (walk.length > 4) pushGyrus(walk, 0.8);
        walk.length = 0;
        continue;
      }
      walk.push([z, yy]);
    }
    if (walk.length > 4) pushGyrus(walk, 0.8);
  }

  // ---- the deep fissures ---------------------------------------------
  // lateral (Sylvian) fissure: sweeps back and up above the temporal lobe
  traceRibbon(
    deepFolds,
    deepCrests,
    (u) => -0.66 + u * 0.58 + Math.sin(u * Math.PI) * 0.1,
    (u) => -0.7 + u * 1.46,
    28,
    0.028,
    0.02,
  );
  // central sulcus: a coronal cleft running over the vault
  traceRibbon(
    deepFolds,
    deepCrests,
    (u) => 0.34 + Math.cos(u * Math.PI) * 0.42,
    (u) => -0.72 + u * 1.44,
    26,
    0.026,
    0.02,
  );
  // one more across the occipital pole so the back does not look smooth
  traceRibbon(
    deepFolds,
    deepCrests,
    (u) => -1.36 + Math.sin(u * Math.PI) * 0.26,
    (u) => -0.66 + u * 1.32,
    22,
    0.024,
    0.018,
  );

  // the shell itself ripples: a gentle radial swell along the folds, so the
  // silhouette and the point cloud both read as folded rather than moulded
  return {
    cortex: flatten(cortexPts),
    cortexDir: flatten(cortexDirs),
    cerebellum: new Float32Array(0),
    cerebellumDir: new Float32Array(0),
    stem: new Float32Array(0),
    stemDir: new Float32Array(0),
    gyri: [],
    outline: flatten(
      Array.from({ length: 240 }, (_, i) => {
        const psi = (i / 240) * Math.PI * 2;
        const r = radiusAt(psi);
        return { x: 0, y: r * Math.sin(psi), z: r * Math.cos(psi) };
      }),
    ),
    folds,
    crests,
    deepFolds,
    deepCrests,
    mesh: [],
  };
}

/* ------------------------------------------------------------------ */
/* neurons                                                             */
/* ------------------------------------------------------------------ */

export const TYPE_COLORS: Record<MemoryType, { dark: string; light: string }> =
  {
    semantic: { dark: "#54e3d6", light: "#0a8f88" },
    episodic: { dark: "#ffb173", light: "#c96a1d" },
    procedural: { dark: "#b49bff", light: "#6f4cd2" },
    raw: { dark: "#9db4c9", light: "#546b80" },
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
      name: memory.name ?? "",
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
  return first ?? "raw";
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
      .map((o, j) => ({
        j,
        d: dist(neuron.pos, o.pos),
        same: o.type === neuron.type,
      }))
      .filter((x) => x.j !== i && !x.same)
      .sort((x, y) => x.d - y.d)[0];
    if (bridge && bridge.d < 0.5) add(i, bridge.j);
  });

  return edges;
}
