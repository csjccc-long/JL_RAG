import { makeRng } from './brain-model';

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

export interface Branch3D {
  /** flat x, y, z triples */
  pts: number[];
  /** stroke width at each point, in unit space */
  w: number[];
}

export interface Neuron3D {
  somaR: number;
  nucleus: number;
  lobes: number;
  lobePhase: number;
  branches: Branch3D[];
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
  detail: 'low' | 'high' = 'high',
): Neuron3D {
  const rng = makeRng(seed);
  const somaR = SOMA_R + (rng() - 0.5) * 0.05;
  const lobes = 3 + Math.floor(rng() * 3);
  const lobePhase = rng() * Math.PI * 2;

  const branches: Branch3D[] = [];
  const spines: number[] = [];
  const tips: Tip3D[] = [];
  let reach = somaR;

  const primaries = detail === 'high' ? 9 + Math.floor(rng() * 2) : 6;
  const maxDepth = detail === 'high' ? 2 : 1;

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
      ws.push(width * (1 - ((s + 1) / steps) * 0.38));
      reach = Math.max(reach, Math.hypot(p[0], p[1], p[2]));

      // dendritic spines: stubs off the shaft, so the surface reads as living
      const perp = perpendicular(dir, rng);
      const off = 0.03 + rng() * 0.028;
      spines.push(p[0] + perp[0] * off, p[1] + perp[1] * off, p[2] + perp[2] * off);
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
        grow(p, child, len * 0.62, width * 0.58, depth + 1, pts, ws);
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
      0.075 + rng() * 0.016,
      0,
    );
  }

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
    spines,
    tips,
    reach: Math.max(reach, 1),
  };
}
