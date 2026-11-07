import { makeRng } from './brain-model';

/**
 * A real neuron, not a dot: a lumpy soma with its nucleus, a fan of tapering
 * dendrites that fork twice and carry spines, and an axon that leaves the
 * soma, branches once and ends in boutons. Everything is generated in unit
 * space (soma radius ≈ 0.3) so the same shape can be painted at 3px inside the
 * brain or at 300px on the memory detail stage.
 */

export interface NeuronBranch {
  /** flat x, y pairs */
  pts: number[];
  /** stroke width at each point, in unit space */
  w: number[];
}

export interface NeuronShape {
  soma: number[];
  nucleus: number;
  dendrites: NeuronBranch[];
  axon: NeuronBranch[];
  /** flat x, y, r triples */
  boutons: number[];
  /** flat x, y pairs */
  spines: number[];
}

/** the soma radius the sprite scaling assumes */
export const NEURON_SOMA = 0.3;

export function buildNeuronShape(
  seed: number,
  detail: 'low' | 'high' = 'high',
): NeuronShape {
  const rng = makeRng(seed);
  const somaR = NEURON_SOMA + (rng() - 0.5) * 0.05;
  const lobes = 3 + Math.floor(rng() * 3);
  const lobePhase = rng() * Math.PI * 2;

  const soma: number[] = [];
  const SOMA_STEPS = 48;
  for (let i = 0; i < SOMA_STEPS; i += 1) {
    const a = (i / SOMA_STEPS) * Math.PI * 2;
    const wobble =
      1 +
      0.11 * Math.sin(lobes * a + lobePhase) +
      0.05 * Math.sin(2 * lobes * a - lobePhase);
    soma.push(Math.cos(a) * somaR * wobble, Math.sin(a) * somaR * wobble);
  }

  const dendrites: NeuronBranch[] = [];
  const spines: number[] = [];
  const primaries = detail === 'high' ? 6 + Math.floor(rng() * 3) : 5;
  const maxDepth = detail === 'high' ? 2 : 1;

  const grow = (
    x: number,
    y: number,
    angle: number,
    len: number,
    width: number,
    depth: number,
  ) => {
    const steps = 3;
    const pts = [x, y];
    const ws = [width];
    let px = x;
    let py = y;
    let a = angle;
    for (let s = 0; s < steps; s += 1) {
      a += (rng() - 0.5) * 0.5;
      px += Math.cos(a) * (len / steps);
      py += Math.sin(a) * (len / steps);
      pts.push(px, py);
      ws.push(width * (1 - ((s + 1) / steps) * 0.4));
      // dendritic spines: tiny stubs that make the shaft look alive
      const side = rng() < 0.5 ? 1 : -1;
      const off = 0.035 + rng() * 0.02;
      spines.push(
        px + Math.cos(a + (side * Math.PI) / 2) * off,
        py + Math.sin(a + (side * Math.PI) / 2) * off,
      );
    }
    dendrites.push({ pts, w: ws });
    if (depth < maxDepth) {
      const kids = depth === 0 && rng() < 0.4 ? 3 : 2;
      for (let k = 0; k < kids; k += 1) {
        const spread =
          (k - (kids - 1) / 2) * (0.45 + rng() * 0.35) + (rng() - 0.5) * 0.2;
        grow(px, py, a + spread, len * 0.62, width * 0.58, depth + 1);
      }
    }
  };

  for (let i = 0; i < primaries; i += 1) {
    const a = (i / primaries) * Math.PI * 2 + (rng() - 0.5) * 0.55;
    const start = somaR * 0.82;
    grow(
      Math.cos(a) * start,
      Math.sin(a) * start,
      a,
      0.6 + rng() * 0.22,
      0.05 + rng() * 0.012,
      0,
    );
  }

  // axon: one long process, a collateral and a spray of terminals
  const axon: NeuronBranch[] = [];
  const boutons: number[] = [];
  const axonAngle = Math.PI / 2 + (rng() - 0.5) * 0.8;
  let ax = Math.cos(axonAngle) * somaR * 0.85;
  let ay = Math.sin(axonAngle) * somaR * 0.85;
  const apts = [ax, ay];
  const aws = [0.042];
  let aa = axonAngle;
  for (let s = 0; s < 5; s += 1) {
    aa += (rng() - 0.5) * 0.22;
    ax += Math.cos(aa) * 0.28;
    ay += Math.sin(aa) * 0.28;
    apts.push(ax, ay);
    aws.push(0.042 * (1 - ((s + 1) / 5) * 0.55));
  }
  axon.push({ pts: apts, w: aws });
  boutons.push(ax, ay, 0.05);

  const collateralAt = apts.length - 6;
  let bx = apts[collateralAt];
  let by = apts[collateralAt + 1];
  let ba = aa + (rng() < 0.5 ? 1 : -1) * (0.7 + rng() * 0.5);
  const bpts = [bx, by];
  const bws = [0.022];
  for (let s = 0; s < 3; s += 1) {
    ba += (rng() - 0.5) * 0.2;
    bx += Math.cos(ba) * 0.24;
    by += Math.sin(ba) * 0.24;
    bpts.push(bx, by);
    bws.push(0.022 * (1 - ((s + 1) / 3) * 0.5));
  }
  axon.push({ pts: bpts, w: bws });
  boutons.push(bx, by, 0.045);

  // a couple of terminals hanging off the shaft
  for (let i = 0; i < 2; i += 1) {
    const at = 4 + i * 4;
    const x = apts[at];
    const y = apts[at + 1];
    const dir = (rng() < 0.5 ? 1 : -1) * (0.6 + rng() * 0.6);
    boutons.push(
      x + Math.cos(aa + dir) * 0.16,
      y + Math.sin(aa + dir) * 0.16,
      0.035,
    );
  }

  return {
    soma,
    nucleus: somaR * 0.42,
    dendrites,
    axon,
    boutons,
    spines,
  };
}

const SHAPES = new Map<number, NeuronShape>();
const SPRITES = new Map<string, HTMLCanvasElement>();

function shapeFor(seed: number): NeuronShape {
  const hit = SHAPES.get(seed);
  if (hit) return hit;
  const shape = buildNeuronShape(seed, 'high');
  if (SHAPES.size > 260) SHAPES.clear();
  SHAPES.set(seed, shape);
  return shape;
}

/**
 * Sprite cache: the brain holds up to 72 neurons, and painting their dendrites
 * every frame would be wasteful. One off-screen canvas per seed keeps the
 * detail and costs a drawImage.
 */
export function neuronSprite(
  seed: number,
  colour: string,
  dark: boolean,
): HTMLCanvasElement {
  const key = `${seed}|${colour}|${dark ? 'd' : 'l'}`;
  const hit = SPRITES.get(key);
  if (hit) return hit;
  const SIZE = 200;
  const UNIT = 22;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.translate(SIZE / 2, SIZE / 2);
  paintNeuron(ctx, shapeFor(seed), UNIT, colour, { dark });
  if (SPRITES.size > 260) SPRITES.clear();
  SPRITES.set(key, canvas);
  return canvas;
}

interface PaintOptions {
  dark?: boolean;
  alpha?: number;
  /** extra halo behind the soma, used by the detail stage */
  halo?: number;
}

export function paintNeuron(
  ctx: CanvasRenderingContext2D,
  shape: NeuronShape,
  unit: number,
  colour: string,
  options: PaintOptions = {},
) {
  const { dark = true, alpha = 1, halo = 0 } = options;
  const rgb = hexToRgb(colour);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const soma = shape.soma;
  let somaR = 0;
  for (let i = 0; i < soma.length; i += 2) {
    somaR = Math.max(somaR, Math.hypot(soma[i], soma[i + 1]));
  }

  if (halo > 0) {
    const glow = ctx.createRadialGradient(0, 0, somaR * unit, 0, 0, somaR * unit * halo);
    glow.addColorStop(0, `rgba(${rgb}, 0.22)`);
    glow.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, somaR * unit * halo, 0, Math.PI * 2);
    ctx.fill();
  }

  // dendrites + axon: a wide dim pass reads as membrane, the core pass as the
  // filament inside it
  const all = [...shape.dendrites, ...shape.axon];
  ctx.strokeStyle = `rgba(${rgb}, ${dark ? 0.16 : 0.12})`;
  for (const branch of all) {
    strokeBranch(ctx, branch, unit, 2.6);
  }
  ctx.strokeStyle = `rgba(${rgb}, ${dark ? 0.72 : 0.62})`;
  for (const branch of all) {
    strokeBranch(ctx, branch, unit, 1);
  }

  // spines
  ctx.fillStyle = `rgba(${rgb}, ${dark ? 0.3 : 0.22})`;
  const spineR = Math.max(0.55, unit * 0.012);
  for (let i = 0; i < shape.spines.length; i += 2) {
    ctx.beginPath();
    ctx.arc(shape.spines[i] * unit, shape.spines[i + 1] * unit, spineR, 0, Math.PI * 2);
    ctx.fill();
  }

  // boutons
  for (let i = 0; i < shape.boutons.length; i += 3) {
    const r = Math.max(0.9, shape.boutons[i + 2] * unit * 0.7);
    ctx.beginPath();
    ctx.arc(shape.boutons[i] * unit, shape.boutons[i + 1] * unit, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rgb}, 0.7)`;
    ctx.fill();
  }

  // soma
  ctx.beginPath();
  ctx.moveTo(soma[0] * unit, soma[1] * unit);
  for (let i = 2; i < soma.length; i += 2) {
    ctx.lineTo(soma[i] * unit, soma[i + 1] * unit);
  }
  ctx.closePath();
  const body = ctx.createRadialGradient(
    -somaR * unit * 0.3,
    -somaR * unit * 0.35,
    somaR * unit * 0.1,
    0,
    0,
    somaR * unit * 1.05,
  );
  body.addColorStop(0, `rgba(${rgb}, 1)`);
  body.addColorStop(1, `rgba(${rgb}, ${dark ? 0.55 : 0.45})`);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
  ctx.lineWidth = Math.max(0.6, unit * 0.03);
  ctx.stroke();

  // nucleus + nucleolus
  const nr = shape.nucleus * unit;
  ctx.beginPath();
  ctx.arc(-somaR * unit * 0.06, somaR * unit * 0.04, nr, 0, Math.PI * 2);
  ctx.fillStyle = dark ? 'rgba(6, 16, 18, 0.55)' : 'rgba(255, 255, 255, 0.5)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-somaR * unit * 0.16, -somaR * unit * 0.02, nr * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${rgb}, 0.95)`;
  ctx.fill();

  // specular speck
  ctx.beginPath();
  ctx.arc(-somaR * unit * 0.34, -somaR * unit * 0.42, somaR * unit * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fill();

  ctx.restore();
}

function strokeBranch(
  ctx: CanvasRenderingContext2D,
  branch: NeuronBranch,
  unit: number,
  weight: number,
) {
  const { pts, w } = branch;
  for (let i = 2; i < pts.length; i += 2) {
    const x0 = pts[i - 2] * unit;
    const y0 = pts[i - 1] * unit;
    const x1 = pts[i] * unit;
    const y1 = pts[i + 1] * unit;
    const width = ((w[i / 2 - 1] + w[i / 2]) / 2) * unit * weight;
    ctx.lineWidth = Math.max(0.35, width);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
}

export function hexToRgb(hex: string): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}
