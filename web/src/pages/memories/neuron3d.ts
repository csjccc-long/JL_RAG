import { makeRng } from "./brain-model";

/**
 * A neuron in three dimensions. The flat shape in neuron-shape.ts drives the
 * tiny sprites inside the brain; this one is what the detail stage rotates: a
 * lumpy soma, dendrites that fork through space, and a list of terminal
 * synapses the messages hang off.
 */

export const SOMA_R = 0.38;

export interface Tip3D {
  x: number;
  y: number;
  z: number;
  /** outward direction of the terminal, used to hang the message on it */
  dx: number;
  dy: number;
  dz: number;
  w: number;
}

export interface MyelinSeg {
  /** the two ends of the sheath, in unit space */
  a: Vec3;
  b: Vec3;
  /** radius of the sheath, in unit space */
  r: number;
}

export interface Bouton {
  x: number;
  y: number;
  z: number;
  /** radius in unit space */
  r: number;
}

export interface Branch3D {
  /** flat x, y, z triples */
  pts: number[];
  /** stroke width at each point, in unit space */
  w: number[];
  kind?: "dendrite" | "axon";
  /** myelin sheaths wrapped round an axon, with the nodes of Ranvier between */
  myelin?: MyelinSeg[];
  /** terminal boutons at the end of an axonal twig */
  boutons?: Bouton[];
}

export interface Neuron3D {
  somaR: number;
  nucleus: number;
  lobes: number;
  lobePhase: number;
  branches: Branch3D[];
  /** the single long process that leaves the soma and ends in boutons */
  axon: Branch3D;
  /** flat x, y, z triples */
  spines: number[];
  tips: Tip3D[];
  /** surface bumps on the soma, so the body reads as a turning sphere */
  bumps: { dir: Vec3; size: number }[];
  reach: number;
}

type Vec3 = [number, number, number];

const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};

const perpendicular = (dir: Vec3, rng: () => number): Vec3 => {
  const seed: Vec3 = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
  const dot = dir[0] * seed[0] + dir[1] * seed[1] + dir[2] * seed[2];
  const perp: Vec3 = [
    seed[0] - dir[0] * dot,
    seed[1] - dir[1] * dot,
    seed[2] - dir[2] * dot,
  ];
  const len = Math.hypot(perp[0], perp[1], perp[2]);
  if (len < 1e-4) return perpendicular(dir, rng);
  return [perp[0] / len, perp[1] / len, perp[2] / len];
};

export function buildNeuron3D(
  seed: number,
  detail: "low" | "high" = "high",
): Neuron3D {
  const rng = makeRng(seed);
  const somaR = SOMA_R + (rng() - 0.5) * 0.05;
  const lobes = 3 + Math.floor(rng() * 3);
  const lobePhase = rng() * Math.PI * 2;

  const branches: Branch3D[] = [];
  const spines: number[] = [];
  const tips: Tip3D[] = [];
  let reach = somaR;

  const primaries = detail === "high" ? 9 + Math.floor(rng() * 2) : 6;
  const maxDepth = detail === "high" ? 2 : 1;

  // a strand keeps the path of its parent, so a primary dendrite is one
  // continuous curve with its forks rather than a chain of short sausages
  const grow = (
    start: Vec3,
    dir0: Vec3,
    len: number,
    width: number,
    depth: number,
    prefixPts: number[] = [],
    prefixW: number[] = [],
  ) => {
    const steps = 3;
    const pts: number[] = [...prefixPts, start[0], start[1], start[2]];
    const ws: number[] = [...prefixW, width];
    let p: Vec3 = [start[0], start[1], start[2]];
    let dir = dir0;
    for (let s = 0; s < steps; s += 1) {
      dir = normalize([
        dir[0] + (rng() - 0.5) * 0.36,
        dir[1] + (rng() - 0.5) * 0.36,
        dir[2] + (rng() - 0.5) * 0.36,
      ]);
      const step = len / steps;
      p = [p[0] + dir[0] * step, p[1] + dir[1] * step, p[2] + dir[2] * step];
      pts.push(p[0], p[1], p[2]);
      ws.push(width * (1 - ((s + 1) / steps) * 0.52));
      reach = Math.max(reach, Math.hypot(p[0], p[1], p[2]));

      // dendritic spines: stubs off the shaft, so the surface reads as living
      const perp = perpendicular(dir, rng);
      const off = 0.03 + rng() * 0.028;
      spines.push(
        p[0] + perp[0] * off,
        p[1] + perp[1] * off,
        p[2] + perp[2] * off,
      );
    }
    branches.push({ pts, w: ws });

    if (depth < maxDepth) {
      const kids = depth === 0 && rng() < 0.6 ? 3 : 2;
      for (let k = 0; k < kids; k += 1) {
        const perp = perpendicular(dir, rng);
        const side = (k / (kids - 1)) * 2 - 1;
        const spread = 0.55 + rng() * 0.42;
        const child = normalize([
          dir[0] + perp[0] * side * spread + (rng() - 0.5) * 0.16,
          dir[1] + perp[1] * side * spread + (rng() - 0.5) * 0.16,
          dir[2] + perp[2] * side * spread + (rng() - 0.5) * 0.16,
        ]);
        grow(p, child, len * 0.62, width * 0.46, depth + 1, pts, ws);
      }
      return;
    }

    // terminal: this is the synapse a message can hang off
    tips.push({
      x: p[0],
      y: p[1],
      z: p[2],
      dx: dir[0],
      dy: dir[1],
      dz: dir[2],
      w: ws[ws.length - 1],
    });
  };

  // primaries spread over a sphere, so the cell reads the same from any angle
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < primaries; i += 1) {
    const y = 1 - ((i + 0.5) / primaries) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * golden + (rng() - 0.5) * 0.5;
    const dir = normalize([Math.cos(a) * ring, y, Math.sin(a) * ring]);
    grow(
      [dir[0] * somaR * 0.86, dir[1] * somaR * 0.86, dir[2] * somaR * 0.86],
      dir,
      0.62 + rng() * 0.22,
      0.15 + rng() * 0.03,
      0,
    );
  }

  // the axon: one long, gently wandering process that leaves the soma low and
  // to the left, wrapped in myelin sheaths and finishing in a spray of boutons
  const axonDir = normalize([-0.74, 0.42, 0.5]);
  let ap: Vec3 = [
    axonDir[0] * somaR * 0.92,
    axonDir[1] * somaR * 0.92,
    axonDir[2] * somaR * 0.92,
  ];
  let adir = axonDir;
  const axonPts: number[] = [ap[0], ap[1], ap[2]];
  const axonW: number[] = [0.064];
  const AXON_STEPS = 10;
  const AXON_LEN = 1.3;
  for (let s = 1; s <= AXON_STEPS; s += 1) {
    const t = s / AXON_STEPS;
    adir = normalize([
      adir[0] + (rng() - 0.5) * 0.16 - 0.04,
      adir[1] + (rng() - 0.5) * 0.14 + 0.14 * Math.sin(t * 2.6),
      adir[2] + (rng() - 0.5) * 0.18,
    ]);
    const step = AXON_LEN / AXON_STEPS;
    ap = [
      ap[0] + adir[0] * step,
      ap[1] + adir[1] * step,
      ap[2] + adir[2] * step,
    ];
    axonPts.push(ap[0], ap[1], ap[2]);
    axonW.push(0.058 - 0.022 * t);
    reach = Math.max(reach, Math.hypot(ap[0], ap[1], ap[2]));
  }
  const lerp3 = (a: number[], b: number[], k: number): Vec3 => [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
  const myelin: MyelinSeg[] = [];
  for (let s = 1; s < AXON_STEPS - 1; s += 1) {
    const i = s * 3;
    const a = [axonPts[i - 3], axonPts[i - 2], axonPts[i - 1]];
    const b = [axonPts[i], axonPts[i + 1], axonPts[i + 2]];
    myelin.push({
      a: lerp3(a, b, 0.16),
      b: lerp3(a, b, 0.84),
      r: 0.036 - 0.006 * (s / AXON_STEPS) + rng() * 0.004,
    });
  }
  // the terminal arbor: short twigs, each ending in a synaptic bouton
  const boutons: Bouton[] = [];
  for (let k = 0; k < 3; k += 1) {
    const perp = perpendicular(adir, rng);
    const side = k - 1;
    const twig = normalize([
      adir[0] + perp[0] * side * 0.55,
      adir[1] + perp[1] * side * 0.55 + 0.18,
      adir[2] + perp[2] * side * 0.55,
    ]);
    const len = 0.18 + rng() * 0.06;
    const end: Vec3 = [
      ap[0] + twig[0] * len,
      ap[1] + twig[1] * len,
      ap[2] + twig[2] * len,
    ];
    branches.push({
      pts: [ap[0], ap[1], ap[2], end[0], end[1], end[2]],
      w: [0.03, 0.022],
      kind: "axon",
    });
    boutons.push({ x: end[0], y: end[1], z: end[2], r: 0.032 + rng() * 0.008 });
    reach = Math.max(reach, Math.hypot(end[0], end[1], end[2]));
  }
  const axon: Branch3D = {
    pts: axonPts,
    w: axonW,
    kind: "axon",
    myelin,
    boutons,
  };

  // a few lobes on the soma surface: they slide across the body as it turns,
  // which is what makes the middle read as a volume rather than a disc
  const bumps: { dir: Vec3; size: number }[] = [];
  for (let i = 0; i < 5; i += 1) {
    const y = 1 - ((i + 0.5) / 5) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * 2.399 + (rng() - 0.5) * 0.8;
    bumps.push({
      dir: normalize([Math.cos(a) * ring, y, Math.sin(a) * ring]),
      size: 0.55 + rng() * 0.5,
    });
  }

  return {
    somaR,
    bumps,
    nucleus: somaR * 0.34,
    lobes,
    lobePhase,
    branches,
    axon,
    spines,
    tips,
    reach: Math.max(reach, 1),
  };
}
