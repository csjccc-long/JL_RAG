/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import * as THREE from 'three';

/**
 * The light theme's moons, built to the reference component: a textured sphere
 * lit by a single hard key light, a 60k-point ring that sweeps onto the surface,
 * and a belt of 75 dodecahedron asteroids orbiting outside it.
 *
 * Two things are deliberately different from the reference, because this lives on
 * a paper-white page instead of a black canvas:
 * - the dust ring uses normal blending and ink-dark colours; additive blending is
 *   invisible on white, so the palette is kept but pushed toward the ink.
 * - the belt rides on the same projection as the star field, so its asteroids land
 *   on the same pixels the rest of the constellation uses.
 */

export type MoonBody = {
  offset: number[];
  scale: number;
  alpha: number;
  progress: number;
  /** The module's four features, in moon radii from the centre: each one is a
   *  stone of the belt, so a label and the stone under it are one object. */
  marks?: number[][];
};

export type MoonRig = {
  render: (
    bodies: MoonBody[],
    proj: Float32Array,
    view: Float32Array,
    rot: Float32Array,
  ) => void;
  resize: (width: number, height: number, dpr: number) => void;
  dispose: () => void;
};

const MOON_RADIUS = 2.0;
const TEXTURE_URL = '/moon-map.jpg';

const PARTICLE_COUNT = 60000;
const ASTEROID_COUNT = 75;

// One dust ring, shared by every moon: the geometry never changes, only the
// per-moon uniform that sweeps the particles off the surface.
const ringGeometry = (() => {
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colours = new Float32Array(PARTICLE_COUNT * 3);
  const randoms = new Float32Array(PARTICLE_COUNT);

  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const rDist = Math.pow(Math.random(), 1.5);
    const radius = 2.2 + rDist * 2.2;
    const thickness = 0.4 - rDist * 0.2;
    const y = (Math.random() + Math.random() + Math.random() - 1.5) * thickness;

    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(angle) * radius;

    const intensity = 1 - rDist;
    const palette = Math.random();
    let baseR = 0.25;
    let baseG = 0.3;
    let baseB = 0.35;
    if (palette >= 0.8 && palette < 0.92) {
      baseR = 0;
      baseG = 0.6;
      baseB = 0.8;
    } else if (palette >= 0.92) {
      baseR = 0.6;
      baseG = 0.2;
      baseB = 0.8;
    }
    const jitter = () => (Math.random() - 0.5) * 0.1;
    baseR = Math.min(1, Math.max(0, baseR + jitter()));
    baseG = Math.min(1, Math.max(0, baseG + jitter()));
    baseB = Math.min(1, Math.max(0, baseB + jitter()));
    const sparkle = Math.random() > 0.95 ? 2.5 : 1;

    // Ink instead of light: the same hues, darkened so they read on paper.
    colours[i * 3] = (1 - baseR * 0.55) * intensity * sparkle;
    colours[i * 3 + 1] = (1 - baseG * 0.5) * intensity * sparkle;
    colours[i * 3 + 2] = (1 - baseB * 0.5) * intensity * sparkle;
    randoms[i] = Math.random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
  return geometry;
})();

type AsteroidSeed = {
  angle: number;
  baseRadius: number;
  radialAmplitude: number;
  radialSpeed: number;
  phase: number;
  zOffset: number;
  speed: number;
  rx: number;
  ry: number;
  rz: number;
  rsx: number;
  rsy: number;
  rsz: number;
  scale: number;
};

const generateAsteroids = (count: number): AsteroidSeed[] => {
  const list: AsteroidSeed[] = [];
  for (let i = 0; i < count; i += 1) {
    list.push({
      angle: Math.random() * Math.PI * 2,
      baseRadius: 2.8 + Math.random() * 2.0,
      radialAmplitude: 0.5 + Math.random() * 1.5,
      radialSpeed: 0.15 + Math.random() * 0.25,
      phase: Math.random() * Math.PI * 2,
      zOffset: (Math.random() - 0.5) * 0.8,
      speed: (0.04 + Math.random() * 0.08) * (Math.random() > 0.5 ? 1 : -1),
      rx: Math.random() * Math.PI,
      ry: Math.random() * Math.PI,
      rz: Math.random() * Math.PI,
      rsx: (Math.random() - 0.5) * 0.05,
      rsy: (Math.random() - 0.5) * 0.05,
      rsz: (Math.random() - 0.5) * 0.05,
      scale: 0.02 + Math.pow(Math.random(), 4) * 0.12,
    });
  }
  return list.sort((a, b) => b.scale - a.scale);
};

type MoonRuntime = {
  group: THREE.Group;
  body: THREE.Mesh;
  bodyMaterial: THREE.MeshStandardMaterial;
  innerMaterial: THREE.ShaderMaterial;
  wallMaterial: THREE.ShaderMaterial;
  shards: THREE.Mesh;
  wall: THREE.Mesh;
  shardUniforms: { uShard: { value: number }; uShardTime: { value: number } };
  ring: THREE.Points;
  ringMaterial: THREE.PointsMaterial;
  ringUniforms: {
    uProgress: { value: number };
    uAsteroids: { value: Float32Array };
    time: { value: number };
  };
  belt: THREE.InstancedMesh;
  marks: THREE.InstancedMesh;
  asteroids: AsteroidSeed[];
  beltScale: number;
};

/** Value noise, enough to lay out the cracks: no need for the GPU's fbm here. */
const hash2 = (x: number, y: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

const noise2 = (x: number, y: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};

// Integer avalanche instead of a sine: the crust evaluates this a few million
// times while it is being built, and Math.sin there costs the page a second of
// blocked main thread on the way into a module.
const hashCell = (x: number, y: number, z: number) => {
  let h = Math.imul(Math.floor(x), 0x27d4eb2d);
  h ^= Math.imul(Math.floor(y), 0x165667b1);
  h ^= Math.imul(Math.floor(z), 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** Trilinear value noise, used to bend the crack network out of true. */
const noise3 = (x: number, y: number, z: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const n000 = hashCell(ix, iy, iz);
  const n100 = hashCell(ix + 1, iy, iz);
  const n010 = hashCell(ix, iy + 1, iz);
  const n110 = hashCell(ix + 1, iy + 1, iz);
  const n001 = hashCell(ix, iy, iz + 1);
  const n101 = hashCell(ix + 1, iy, iz + 1);
  const n011 = hashCell(ix, iy + 1, iz + 1);
  const n111 = hashCell(ix + 1, iy + 1, iz + 1);
  const x00 = n000 + (n100 - n000) * sx;
  const x10 = n010 + (n110 - n010) * sx;
  const x01 = n001 + (n101 - n001) * sx;
  const x11 = n011 + (n111 - n011) * sx;
  const y0 = x00 + (x10 - x00) * sy;
  const y1 = x01 + (x11 - x01) * sy;
  return y0 + (y1 - y0) * sz;
};

/**
 * Distance to the nearest cell wall of a 3D Worley pattern, in cell units: zero
 * on a wall, growing toward a cell centre. This is what the cracks trace, and
 * because it lives on the sphere itself the walls arrive already curved instead
 * of drawn on.
 */
const cellEdge = (x: number, y: number, z: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  let f1 = 8;
  let f2 = 8;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const cx = ix + dx;
        const cy = iy + dy;
        const cz = iz + dz;
        const ox = hashCell(cx, cy, cz);
        const oy = hashCell(cy + 19.19, cz - 7.3, cx + 3.1);
        const oz = hashCell(cz + 43.37, cx + 11.7, cy - 5.9);
        const rx = dx + ox - fx;
        const ry = dy + oy - fy;
        const rz = dz + oz - fz;
        const d = rx * rx + ry * ry + rz * rz;
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
  }
  return Math.sqrt(f2) - Math.sqrt(f1);
};

/**
 * The moon with its damage carved in: the groove the dust ring breaks out of,
 * and a network of cracks running from that groove partway toward the poles.
 * Cracks are cut into the mesh, so they have depth and cast their own shading.
 */
/** The warp that bends the cell network, shared by the crust and its plates. */
const CELL_SCALE = 3.05;
const WARP_COARSE = 0.85;
const WARP_FINE = 0.2;
const MAX_PLATES = 24;

const warpedPoint = (x: number, y: number, z: number, out: number[]) => {
  const wx =
    (noise3(x * 1.6 + 11.7, y * 1.6 - 4.2, z * 1.6 + 7.9) - 0.5) * WARP_COARSE +
    (noise3(x * 5.3 - 3.1, y * 5.3 + 8.4, z * 5.3 - 6.2) - 0.5) * WARP_FINE;
  const wy =
    (noise3(x * 1.7 - 6.3, y * 1.7 + 1.8, z * 1.7 - 9.4) - 0.5) * WARP_COARSE +
    (noise3(x * 6.1 + 2.7, y * 6.1 - 7.6, z * 6.1 + 4.3) - 0.5) * WARP_FINE;
  const wz =
    (noise3(x * 1.5 + 3.4, y * 1.5 - 8.1, z * 1.5 + 2.5) - 0.5) * WARP_COARSE +
    (noise3(x * 4.7 - 9.2, y * 4.7 + 5.6, z * 4.7 - 1.3) - 0.5) * WARP_FINE;
  out[0] = x * CELL_SCALE + wx;
  out[1] = y * CELL_SCALE + wy;
  out[2] = z * CELL_SCALE + wz;
  return out;
};

type CellSite = { id: number; cx: number; cy: number; cz: number };

/**
 * The nearest cell of the warped Worley network, using exactly the same salts as
 * cellEdge so a plate's outline lands on the crack the crust already shows.
 */
const cellSiteAt = (x: number, y: number, z: number): CellSite => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let best = Infinity;
  const site: CellSite = { id: 0, cx: 0, cy: 0, cz: 0 };
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const cx = ix + dx;
        const cy = iy + dy;
        const cz = iz + dz;
        const px = cx + hashCell(cx, cy, cz);
        const py = cy + hashCell(cy + 19.19, cz - 7.3, cx + 3.1);
        const pz = cz + hashCell(cz + 43.37, cx + 11.7, cy - 5.9);
        const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
        if (d < best) {
          best = d;
          site.id = (cx & 1023) * 1048576 + (cy & 1023) * 1024 + (cz & 1023);
          site.cx = px;
          site.cy = py;
          site.cz = pz;
        }
      }
    }
  }
  return site;
};

const siteAtUnit = (x: number, y: number, z: number, scratch: number[]) => {
  warpedPoint(x, y, z, scratch);
  return cellSiteAt(scratch[0], scratch[1], scratch[2]);
};

/**
 * A plate is the polygon the cracks enclose: its centre, the cell it belongs to
 * and the outline traced on that cell's own wall (so the piece and the hole it
 * leaves are the same shape, and the edge is as smooth as the crack under it).
 */
export type PlateCut = {
  id: number;
  dir: [number, number, number];
  ring: [number, number, number][];
};

const PLATE_RINGS = 56;
const PLATE_REACH = 0.42;
const PLATE_BAND = 0.2;
const PLATE_THICK = 0.075;

const buildPlates = (surface: THREE.BufferGeometry) => {
  const pos = surface.attributes.position as THREE.BufferAttribute;
  const R = MOON_RADIUS;

  const scratch: number[] = [0, 0, 0];
  const dir = new THREE.Vector3();
  const sites = new Map<number, CellSite>();

  for (let i = 0; i < pos.count; i += 1) {
    dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    if (Math.abs(dir.y) > PLATE_BAND) continue;
    const site = siteAtUnit(dir.x, dir.y, dir.z, scratch);
    if (!sites.has(site.id)) sites.set(site.id, site);
  }

  type Piece = {
    id: number;
    centre: THREE.Vector3;
    ring: THREE.Vector3[];
    seed: number;
    gate: number;
    hero: number;
  };
  const pieces: Piece[] = [];
  const ax = new THREE.Vector3();
  const ay = new THREE.Vector3();
  const up = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const probe = new THREE.Vector3();

  sites.forEach((site) => {
    if (pieces.length >= MAX_PLATES) return;
    const centre = new THREE.Vector3(site.cx, site.cy, site.cz).normalize();
    up.set(0, 1, 0);
    if (Math.abs(centre.y) > 0.9) up.set(1, 0, 0);
    ax.crossVectors(up, centre).normalize();
    ay.crossVectors(centre, ax).normalize();

    const own = site.id;
    const inside = (t: number) => {
      probe.copy(centre).addScaledVector(tangent, t).normalize();
      return siteAtUnit(probe.x, probe.y, probe.z, scratch).id === own;
    };

    const ring: THREE.Vector3[] = [];
    for (let k = 0; k < PLATE_RINGS; k += 1) {
      const a = (k / PLATE_RINGS) * Math.PI * 2;
      tangent.copy(ax).multiplyScalar(Math.cos(a)).addScaledVector(ay, Math.sin(a));
      let prev = 0.02;
      let hit = PLATE_REACH;
      let found = false;
      for (let t = 0.04; t <= PLATE_REACH; t += 0.03) {
        if (!inside(t)) {
          hit = t;
          found = true;
          break;
        }
        prev = t;
      }
      if (found) {
        for (let step = 0; step < 9; step += 1) {
          const mid = (prev + hit) / 2;
          if (inside(mid)) prev = mid;
          else hit = mid;
        }
      } else {
        prev = PLATE_REACH;
      }
      probe.copy(centre).addScaledVector(tangent, prev).normalize().multiplyScalar(R - 0.004);
      ring.push(probe.clone());
    }

    pieces.push({
      id: own,
      centre,
      ring,
      seed: hashCell(centre.x * 37.1, centre.y * 37.1, centre.z * 37.1),
      gate: 1 - Math.abs(Math.atan2(centre.z, centre.x)) / Math.PI,
      hero: 0,
    });
  });

  // Only a handful really break away; the rest just lift off their seat. Eight
  // of them, spread along the order the dust sweeps in, so the burst reads as
  // pieces popping off one after another instead of the whole belt exploding.
  const byGate = pieces.map((_, i) => i).sort((a, b) => pieces[a].gate - pieces[b].gate);
  const heroEvery = Math.max(1, Math.round(byGate.length / 8));
  byGate.forEach((idx, k) => {
    if (k % heroEvery === 0) pieces[idx].hero = 1;
  });

  const outPosition: number[] = [];
  const outNormal: number[] = [];
  const outUv: number[] = [];
  const outCentre: number[] = [];
  const outSeed: number[] = [];
  const outGate: number[] = [];
  const outHero: number[] = [];
  const cuts: PlateCut[] = [];

  const uvOf = (v: THREE.Vector3) =>
    [Math.atan2(v.z, v.x) / (Math.PI * 2) + 0.5, 1 - Math.acos(Math.max(-1, Math.min(1, v.y))) / Math.PI];

  const pushVertex = (
    point: THREE.Vector3,
    normal: THREE.Vector3,
    centre: THREE.Vector3,
    seed: number,
    gate: number,
    hero: number,
    uvOverride?: [number, number],
  ) => {
    outPosition.push(point.x, point.y, point.z);
    outNormal.push(normal.x, normal.y, normal.z);
    const uv = uvOverride ?? uvOf(point);
    outUv.push(uv[0], uv[1]);
    outCentre.push(centre.x, centre.y, centre.z);
    outSeed.push(seed);
    outGate.push(gate);
    outHero.push(hero);
  };

  pieces.forEach((piece) => {
    const { centre, ring, seed, gate, hero } = piece;
    const capCentre = centre.clone().multiplyScalar(R - 0.004);
    const backCentre = centre.clone().multiplyScalar(R - 0.004 - PLATE_THICK);
    const capNormal = centre.clone();
    const backNormal = centre.clone().negate();

    for (let k = 0; k < PLATE_RINGS; k += 1) {
      const a = ring[k];
      const b = ring[(k + 1) % PLATE_RINGS];
      pushVertex(capCentre, capNormal, centre, seed, gate, hero);
      pushVertex(a, a.clone().normalize(), centre, seed, gate, hero);
      pushVertex(b, b.clone().normalize(), centre, seed, gate, hero);
    }
    for (let k = 0; k < PLATE_RINGS; k += 1) {
      const a = ring[k].clone().addScaledVector(centre, -PLATE_THICK);
      const b = ring[(k + 1) % PLATE_RINGS].clone().addScaledVector(centre, -PLATE_THICK);
      pushVertex(backCentre, backNormal, centre, seed, gate, hero);
      pushVertex(b, backNormal, centre, seed, gate, hero);
      pushVertex(a, backNormal, centre, seed, gate, hero);
    }
    for (let k = 0; k < PLATE_RINGS; k += 1) {
      const a = ring[k];
      const b = ring[(k + 1) % PLATE_RINGS];
      const aIn = a.clone().addScaledVector(centre, -PLATE_THICK);
      const bIn = b.clone().addScaledVector(centre, -PLATE_THICK);
      const wall = a.clone().add(b).normalize().multiplyScalar(0.4).addScaledVector(centre, 0.5).normalize();
      // The edge is mapped along its own length, not by spherical projection:
      // projecting a radial wall stretches the texture into combed stripes.
      const u0 = k / PLATE_RINGS;
      const u1 = (k + 1) / PLATE_RINGS;
      pushVertex(a, wall, centre, seed, gate, hero, [u0, 0.32]);
      pushVertex(b, wall, centre, seed, gate, hero, [u1, 0.32]);
      pushVertex(bIn, wall, centre, seed, gate, hero, [u1, 0.62]);
      pushVertex(a, wall, centre, seed, gate, hero, [u0, 0.32]);
      pushVertex(bIn, wall, centre, seed, gate, hero, [u1, 0.62]);
      pushVertex(aIn, wall, centre, seed, gate, hero, [u0, 0.62]);
    }

    cuts.push({
      id: piece.id,
      dir: [centre.x, centre.y, centre.z],
      ring: ring.map((p) => [p.x, p.y, p.z] as [number, number, number]),
    });
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(outPosition, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(outNormal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(outUv, 2));
  geometry.setAttribute('aCentre', new THREE.Float32BufferAttribute(outCentre, 3));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(outSeed, 1));
  geometry.setAttribute('aGate', new THREE.Float32BufferAttribute(outGate, 1));
  geometry.setAttribute('aHero', new THREE.Float32BufferAttribute(outHero, 1));
  return { geometry, cuts };
};

/**
 * The crust. The plates' footprints are cut out of the mesh itself, so a piece
 * leaves a real hole with a wall of its own thickness behind it, not a mask that
 * switches the surface off. Cracks are displaced into the vertices and shaded.
 */
const buildCrust = (cuts: PlateCut[]) => {
  // 256 keeps the crater rims smooth once their vertices are snapped onto the
  // plate outlines, and halves the triangles the page has to chew through on
  // the way into a module.
  const SEGMENTS = 256;
  const geometry = new THREE.SphereGeometry(MOON_RADIUS, SEGMENTS, SEGMENTS);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const unit = new THREE.Vector3();
  const grooveMask = new Float32Array(position.count);
  const seamMask = new Float32Array(position.count);
  const tailMask = new Float32Array(position.count);
  const radius = MOON_RADIUS;

  const GROOVE_EDGE = 0.17;
  const SEAM_WIDTH = 0.028;

  for (let i = 0; i < position.count; i += 1) {
    unit.set(position.getX(i), position.getY(i), position.getZ(i)).normalize();
    const { x, y, z } = unit;
    const angle = Math.atan2(z, x);
    const absLat = Math.abs(y);

    const rim =
      THREE.MathUtils.smoothstep(absLat, GROOVE_EDGE * 0.9, GROOVE_EDGE * 1.25) *
      (1 - THREE.MathUtils.smoothstep(absLat, GROOVE_EDGE * 1.25, GROOVE_EDGE * 1.65));
    const grit = absLat < 0.3 ? Math.max(0, noise2(angle * 40.0, y * 60.0) - 0.72) * 0.8 : 0;

    const warp: number[] = [0, 0, 0];
    warpedPoint(x, y, z, warp);
    const edge = cellEdge(warp[0], warp[1], warp[2]) / CELL_SCALE;
    const reach = 1 - THREE.MathUtils.smoothstep(absLat, 0.16, 0.56);
    const tailReach = 1 - THREE.MathUtils.smoothstep(absLat, 0.34, 0.97);
    const wall = 1 - THREE.MathUtils.smoothstep(edge, SEAM_WIDTH * 0.10, SEAM_WIDTH * 1.05);
    const seam = wall * reach;
    const tail = wall * tailReach;
    const shoulder =
      THREE.MathUtils.smoothstep(edge, SEAM_WIDTH, SEAM_WIDTH * 1.7) *
      (1 - THREE.MathUtils.smoothstep(edge, SEAM_WIDTH * 1.7, SEAM_WIDTH * 2.5)) *
      reach;

    const dent = seam * 0.075 + tail * 0.020 + grit * 0.006 - (rim * 0.006 + shoulder * 0.010);
    const scale = (radius - dent) / radius;
    position.setXYZ(i, x * scale * radius, y * scale * radius, z * scale * radius);
    grooveMask[i] = 0;
    seamMask[i] = seam;
    tailMask[i] = tail;
  }

  position.needsUpdate = true;
  geometry.setAttribute('aGroove', new THREE.BufferAttribute(grooveMask, 1));
  geometry.setAttribute('aSeam', new THREE.BufferAttribute(seamMask, 1));
  geometry.setAttribute('aTail', new THREE.BufferAttribute(tailMask, 1));
  geometry.computeVertexNormals();

  // The holes: for each plate, its traced outline in that plate's tangent frame.
  type Hole = {
    id: number;
    centre: THREE.Vector3;
    ax: THREE.Vector3;
    ay: THREE.Vector3;
    radii: number[];
  };
  const holes: Hole[] = cuts.map((cut) => {
    const centre = new THREE.Vector3(cut.dir[0], cut.dir[1], cut.dir[2]).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(centre.y) > 0.9) up.set(1, 0, 0);
    const ax = new THREE.Vector3().crossVectors(up, centre).normalize();
    const ay = new THREE.Vector3().crossVectors(centre, ax).normalize();
    const radii = cut.ring.map((p) => {
      const v = new THREE.Vector3(p[0], p[1], p[2]);
      const t = v.clone().addScaledVector(centre, -v.dot(centre));
      return Math.hypot(t.dot(ax), t.dot(ay));
    });
    return { id: cut.id, centre, ax, ay, radii };
  });
  const holeByCell = new Map<number, Hole>();
  holes.forEach((hole) => holeByCell.set(hole.id, hole));

  const probe = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const scratch: number[] = [0, 0, 0];
  const radiusAt = (hole: Hole, a: number) => {
    const n = hole.radii.length;
    const f = ((a / (Math.PI * 2)) * n + n) % n;
    const i0 = Math.floor(f) % n;
    const frac = f - Math.floor(f);
    return hole.radii[i0] * (1 - frac) + hole.radii[(i0 + 1) % n] * frac;
  };
  const holeAt = (point: THREE.Vector3): Hole | null => {
    const site = siteAtUnit(point.x, point.y, point.z, scratch);
    const hole = holeByCell.get(site.id);
    if (!hole) return null;
    tangent.copy(point).addScaledVector(hole.centre, -point.dot(hole.centre));
    const r = tangent.length();
    const a = Math.atan2(tangent.dot(hole.ay), tangent.dot(hole.ax));
    // Leave a rim of crust beyond the plate's footprint: that rim, the gap under
    // the hovering plate and the wall behind it are the glowing crack.
    return r < radiusAt(hole, a) * 0.93 ? hole : null;
  };

  const index = geometry.getIndex();
  if (!index) return { geometry, wallGeometry: new THREE.BufferGeometry() };
  const triCount = index.count / 3;
  const removed = new Uint8Array(triCount);
  const vertices: number[][] = [];
  for (let t = 0; t < triCount; t += 1) {
    const ia = index.getX(t * 3);
    const ib = index.getX(t * 3 + 1);
    const ic = index.getX(t * 3 + 2);
    probe.set(0, 0, 0);
    for (const v of [ia, ib, ic]) {
      probe.x += position.getX(v);
      probe.y += position.getY(v);
      probe.z += position.getZ(v);
    }
    probe.normalize();
    removed[t] = holeAt(probe) ? 1 : 0;
    vertices.push([ia, ib, ic]);
  }

  // Keep every triangle that is not inside a plate; the rest becomes the crater.
  const kept: number[] = [];
  for (let t = 0; t < triCount; t += 1) {
    if (removed[t]) continue;
    kept.push(vertices[t][0], vertices[t][1], vertices[t][2]);
  }
  geometry.setIndex(kept.length ? new THREE.Uint32BufferAttribute(kept, 1) : null);

  // The crater wall: every edge between a removed triangle and a kept one gets a
  // skirt dropped inward, so the hole has depth and its own lit lip.
  const N = position.count;
  const edgeTris = new Map<number, number[]>();
  const keyOf = (a: number, b: number) => (a < b ? a * N + b : b * N + a);
  for (let t = 0; t < triCount; t += 1) {
    const [a, b, c] = vertices[t];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = keyOf(u, v);
      const list = edgeTris.get(key);
      if (list) list.push(t);
      else edgeTris.set(key, [t]);
    }
  }

  const wallPosition: number[] = [];
  const wallNormal: number[] = [];
  // The rim of a triangle-cut hole is a staircase. Pull every rim vertex onto the
  // plate's own outline, so the hole the piece leaves is the shape of the piece.
  const rimVertex = new Map<number, { hole: Hole; angle: number }>();
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let t = 0; t < triCount; t += 1) {
    if (!removed[t]) continue;
    const [a, b, c] = vertices[t];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const list = edgeTris.get(keyOf(u, v));
      if (!list) continue;
      const other = list.find((id) => id !== t);
      if (other !== undefined && removed[other]) continue;
      pa.set(position.getX(u), position.getY(u), position.getZ(u));
      pb.set(position.getX(v), position.getY(v), position.getZ(v));
      probe.copy(pa).add(pb).normalize();
      const hole = holeAt(probe);
      if (!hole) continue;
      const aIn = pa.clone().multiplyScalar(0.9);
      const bIn = pb.clone().multiplyScalar(0.9);
      for (const [vi, vp] of [[u, pa], [v, pb]] as const) {
        if (rimVertex.has(vi)) continue;
        const t = vp.clone().addScaledVector(hole.centre, -vp.dot(hole.centre));
        rimVertex.set(vi, { hole, angle: Math.atan2(t.dot(hole.ay), t.dot(hole.ax)) });
      }
      nrm.crossVectors(pb.clone().sub(pa), aIn.clone().sub(pa)).normalize();
      if (nrm.dot(hole.centre.clone().sub(pa)) < 0) nrm.negate();
      wallPosition.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, bIn.x, bIn.y, bIn.z);
      wallPosition.push(pa.x, pa.y, pa.z, bIn.x, bIn.y, bIn.z, aIn.x, aIn.y, aIn.z);
      for (let k = 0; k < 6; k += 1) wallNormal.push(nrm.x, nrm.y, nrm.z);
    }
  }
  rimVertex.forEach(({ hole, angle }, vi) => {
    const r = radiusAt(hole, angle) * 0.928;
    const dir = hole.centre
      .clone()
      .multiplyScalar(Math.sqrt(Math.max(0, 1 - r * r)))
      .addScaledVector(hole.ax, Math.cos(angle) * r)
      .addScaledVector(hole.ay, Math.sin(angle) * r)
      .normalize();
    position.setXYZ(vi, dir.x * MOON_RADIUS, dir.y * MOON_RADIUS, dir.z * MOON_RADIUS);
  });
  position.needsUpdate = true;
  geometry.computeVertexNormals();

  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wallPosition, 3));
  wallGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(wallNormal, 3));

  return { geometry, wallGeometry };
};

export const createMoonRig = (canvas: HTMLCanvasElement): MoonRig | null => {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
  });
  renderer.setClearColor(0x000000, 0);
  // The reference runs in a dark room; on white paper ACES crushes the mid greys of
  // the moon into mud, so the tone curve stays linear and a fill light stands in
  // for the missing environment.
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;

  // The reference's lighting: almost no ambient, one hard white key, a faint blue
  // counter light. A soft hemisphere stands in for drei's <Environment>.
  scene.add(new THREE.AmbientLight(0xffffff, 0.02));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(8, 5, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(0, 0, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x4a90e2, 0.15);
  rim.position.set(-5, -3, -5);
  scene.add(rim);
  // Stands in for the reference's <Environment preset="city" />: the sky fill that
  // keeps the unlit side of the moon from going black.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 0.95));

  const loader = new THREE.TextureLoader();
  const texture = loader.load(TEXTURE_URL, (loaded) => {
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.anisotropy = 4;
    moons.forEach((moon) => {
      moon.bodyMaterial.map = loaded;
      moon.bodyMaterial.needsUpdate = true;
      moon.belt.material = beltMaterialFor(loaded);
    });
  });
  texture.colorSpace = THREE.SRGBColorSpace;

  const beltMaterialFor = (map: THREE.Texture) =>
    new THREE.MeshStandardMaterial({
      map,
      bumpMap: map,
      bumpScale: 0.08,
      color: 0xffffff,
      roughness: 0.7,
      metalness: 0.1,
    });

  // The moon is dented where the dust ring leaves it: a groove along the equator
  // and cracks running from that groove partway toward the poles, shallower the
  // further they get. Built once, then lit like any other sphere.
  // The plates are traced on a coarse sphere (only their cells matter), then the
  // crust is built with those same footprints cut out of it.
  const siteSphere = new THREE.SphereGeometry(MOON_RADIUS, 96, 96);
  const { geometry: shardGeometry, cuts: plateCuts } = buildPlates(siteSphere);
  siteSphere.dispose();
  const { geometry: sphereGeometry, wallGeometry } = buildCrust(plateCuts);
  // The crater wall is the broken cross-section of the shell. It is lit by the
  // lava directly below it, so it runs white-hot where it meets the core and
  // cools to dark stone at the top lip: a gradient, not a flat colour.
  const wallMaterial = new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 1 } },
    transparent: true,
    side: THREE.DoubleSide,
    vertexShader: [
      'varying float vDepth;',
      'void main() {',
      '  vDepth = clamp((length(position) - 1.80) / 0.20, 0.0, 1.0);',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uAlpha;',
      'varying float vDepth;',
      'void main() {',
      '  vec3 hot = vec3(1.0, 0.58, 0.20);',
      '  vec3 cold = vec3(0.10, 0.06, 0.045);',
      '  vec3 col = mix(hot, cold, smoothstep(0.0, 0.72, vDepth));',
      '  gl_FragColor = vec4(col, uAlpha);',
      '}',
    ].join('\n'),
  });
  // Under the crust sits the molten core the cracks glow with: when a plate
  // lifts away it uncovers this instead of the paper behind the moon. Its lava
  // is drawn, not baked: slow drifting noise, so the glow under the belt moves,
  // and the mouths where the cracks meet it burn brightest.
  const innerGeometry = new THREE.SphereGeometry(MOON_RADIUS * 0.93, 96, 96);
  const coreTime = { value: 0 };
  const makeInnerMaterial = () =>
    new THREE.ShaderMaterial({
      uniforms: { uTime: coreTime, uAlpha: { value: 1 } },
      transparent: true,
      vertexShader: [
        'varying vec3 vPos;',
        'void main() {',
        '  vPos = position;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform float uTime;',
        'uniform float uAlpha;',
        'varying vec3 vPos;',
        'float chash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }\nfloat cnoise(vec3 p) {\n  vec3 i = floor(p);\n  vec3 f = fract(p);\n  f = f * f * (3.0 - 2.0 * f);\n  float n000 = chash(i);\n  float n100 = chash(i + vec3(1.0, 0.0, 0.0));\n  float n010 = chash(i + vec3(0.0, 1.0, 0.0));\n  float n110 = chash(i + vec3(1.0, 1.0, 0.0));\n  float n001 = chash(i + vec3(0.0, 0.0, 1.0));\n  float n101 = chash(i + vec3(1.0, 0.0, 1.0));\n  float n011 = chash(i + vec3(0.0, 1.0, 1.0));\n  float n111 = chash(i + vec3(1.0, 1.0, 1.0));\n  float nx00 = mix(n000, n100, f.x);\n  float nx10 = mix(n010, n110, f.x);\n  float nx01 = mix(n001, n101, f.x);\n  float nx11 = mix(n011, n111, f.x);\n  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);\n}\nfloat fbm(vec3 p) {\n  float sum = 0.0;\n  float amp = 0.5;\n  for (int k = 0; k < 4; k++) {\n    sum += amp * cnoise(p);\n    p *= 2.03;\n    amp *= 0.5;\n  }\n  return sum;\n}',
        'void main() {\n  vec3 dir = normalize(vPos);\n  float lat = abs(dir.y);\n  vec3 q = dir * 3.4 + vec3(0.0, uTime * 0.08, 0.0);\n  float flow = fbm(q) * 0.65 + fbm(q * 2.1 - vec3(uTime * 0.05)) * 0.35;\n  float band = 1.0 - smoothstep(0.12, 0.42, lat);\n  float mouth = smoothstep(0.02, 0.10, lat) * (1.0 - smoothstep(0.12, 0.26, lat));\n  vec3 rock = vec3(0.20, 0.09, 0.05);\n  vec3 lava = mix(vec3(1.0, 0.28, 0.02), vec3(1.0, 0.80, 0.38), smoothstep(0.30, 0.80, flow));\n  vec3 col = rock;\n  col = mix(col, lava, band * clamp(flow * 1.25, 0.0, 1.0));\n  float white = mouth * (0.55 + 0.45 * flow) + pow(flow, 3.0) * 0.55 * band;\n  col = mix(col, vec3(1.0, 0.97, 0.90), clamp(white, 0.0, 1.0));\n  gl_FragColor = vec4(col, uAlpha);\n}',
      ].join('\n'),
    });
  const asteroidGeometry = new THREE.DodecahedronGeometry(1, 0);

  const moons: MoonRuntime[] = [];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  const ringMatrix = new THREE.Matrix4();
  const asteroidLocal = new THREE.Vector3();

  const buildMoon = (): MoonRuntime => {
    const group = new THREE.Group();
    // The reference tilts the whole system by PI/8.
    group.rotation.x = Math.PI / 8;

    const bodyMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      bumpMap: texture,
      bumpScale: 0.02,
      roughness: 0.8,
      metalness: 0.1,
      transparent: true,
    });
    // The dents are shaded, not just modelled: the grooves and the cracks go
    // dark, and the bottom of the cut glows like the inside of a broken stone.
    bodyMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = [
        'attribute float aGroove;',
        'attribute float aSeam;',
        'attribute float aTail;',
        'varying float vGroove;',
        'varying float vSeam;',
        'varying float vTail;',
        'varying vec3 vObjPos;',
        shader.vertexShader,
      ].join('\n');
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vGroove = aGroove;\n  vSeam = aSeam;\n  vTail = aTail;\n  vObjPos = position;',
      );
      shader.fragmentShader = [
        'varying float vGroove;',
        'varying float vSeam;',
        'varying float vTail;',
        'varying vec3 vObjPos;',
        shader.fragmentShader,
      ].join('\n');
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          '  vec3 dir = normalize(vObjPos);',
          '  float lat = abs(dir.y);',
          // The cracks only belong to the belt: they start at the groove and fade
          // out well before the caps, so the poles stay whole.
          '  float heat = 1.0 - smoothstep(0.18, 0.55, lat);',
          // The seam is a per-vertex mask, so at high zoom its edge steps from
          // vertex to vertex. Widen the transition by the shared derivative and
          // the staircases turn into soft edges.
          '  float seamAA = fwidth(vSeam) * 1.3 + 0.02;',
          '  float seam = smoothstep(0.35 - seamAA, 0.75 + seamAA, vSeam);',
          '  float tailAA = fwidth(vTail) * 1.3 + 0.02;',
          '  float tail = smoothstep(0.30 - tailAA, 0.70 + tailAA, vTail);',
          // The seam itself is model geometry now, so it only needs occlusion:
          // the groove swallows light, and the walls of it are lit by the core.
          '  float cut = max(seam * 0.55, smoothstep(0.15, 0.95, vGroove) * 0.85);',
          '  diffuseColor.rgb *= mix(1.0, 0.42, cut);',
          // Only the hairline spurs that run up past the lit seam are painted:
          // they are a dying crack, a line of shadow that fades into the stone.
          '  diffuseColor.rgb *= mix(1.0, 0.30, tail * (0.35 + 0.65 * heat));',
        ].join('\n'),
      );
      // The seam is a narrow channel, not a painted band: only its deepest line
      // carries light, and that light is the core's own white-hot ramp. What sits
      // around it is shaded by the interior lamps, not by this term.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '  float hotA = smoothstep(0.88, 0.995, dot(normalize(vObjPos), normalize(vec3(0.55, 0.38, 0.74))));',
          '  float hotB = smoothstep(0.95, 0.999, dot(normalize(vObjPos), normalize(vec3(-0.62, 0.26, 0.74))));',
          '  float hotspot = clamp(hotA + hotB * 0.5, 0.0, 1.0);',
          '  float coreGlow = pow(seam, 1.4) * (1.5 + 2.4 * hotspot) * heat;',
          '  vec3 spill = mix(vec3(1.0, 0.55, 0.16), vec3(1.0, 0.93, 0.75), smoothstep(0.60, 1.0, seam + hotspot));',
          '  totalEmissiveRadiance += spill * coreGlow;',
        ].join('\n'),
      );
    };

    const body = new THREE.Mesh(sphereGeometry, bodyMaterial);
    group.add(body);
    const innerMaterial = makeInnerMaterial();
    const core = new THREE.Mesh(innerGeometry, innerMaterial);
    core.frustumCulled = false;
    body.add(core);
    // The crater's own inner wall: the crust geometry has the footprint removed,
    // and this skirt gives the hole a thickness so it reads as broken stone rather
    // than a painted patch. It turns with the body, like the crust it belongs to.
    const wallMaterialForMoon = wallMaterial.clone();
    const wall = new THREE.Mesh(wallGeometry, wallMaterialForMoon);
    wall.frustumCulled = false;
    body.add(wall);
    // A warm lamp inside the moon: the plates' undersides and edges catch the core
    // light, so the glow they leave behind and the light on them agree.
    // The moon is lit from the inside: this lamp is the lava, and the reason the
    // plates' undersides and the crater walls read as lit rather than painted.
    const coreLight = new THREE.PointLight(0xff7a28, 0.95, 3.2, 2);
    coreLight.position.set(0, 0, 0);
    group.add(coreLight);
    const hotLight = new THREE.PointLight(0xffcf9c, 0.7, 2.2, 2);
    hotLight.position.set(0, 0, 0);
    group.add(hotLight);

    // The shards are children of the body, so they keep the crack pattern's place
    // while the moon spins. They leave in the dust's own angular order (aGate),
    // then settle into a slow bob instead of drifting off.
    const shardUniforms = { uShard: { value: 0 }, uShardTime: { value: 0 } };
    const shardMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      bumpMap: texture,
      bumpScale: 0.02,
      roughness: 0.86,
      metalness: 0.04,
      transparent: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    shardMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uShard = shardUniforms.uShard;
      shader.uniforms.uShardTime = shardUniforms.uShardTime;
      shader.vertexShader = [
        'attribute vec3 aCentre;',
        'attribute float aSeed;',
        'attribute float aGate;',
        'attribute float aHero;',
        'uniform float uShard;',
        'uniform float uShardTime;',
        shader.vertexShader,
      ].join('\n');
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'float gate = aGate;',
          'float lift = smoothstep(gate, gate + 0.35, uShard * 1.4);',
          'vec3 outward = normalize(aCentre);',
          // Only a few pieces break off and tumble away; the rest just shrug up off
          // their seat, so the moon keeps its shape instead of exploding.
          'float away = mix(0.035 + 0.03 * aSeed, 0.42 + 0.14 * aSeed, aHero);',
          'transformed += outward * lift * away;',
          'transformed.y += sin(uShardTime * 1.4 + aSeed * 6.2832) * mix(0.02, 0.09, aHero) * lift;',
        ].join('\n'),
      );
    };
    const shards = new THREE.Mesh(shardGeometry, shardMaterial);
    shards.frustumCulled = false;
    body.add(shards);

    const ringUniforms = {
      uProgress: { value: 0 },
      uAsteroids: { value: new Float32Array(ASTEROID_COUNT * 4) },
      time: { value: 0 },
    };
    const ringMaterial = new THREE.PointsMaterial({
      size: 0.008,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      depthWrite: false,
    });
    ringMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uProgress = ringUniforms.uProgress;
      shader.uniforms.uAsteroids = ringUniforms.uAsteroids;
      shader.uniforms.time = ringUniforms.time;
      shader.vertexShader = [
        'uniform float uProgress;',
        'uniform vec4 uAsteroids[75];',
        'uniform float time;',
        'attribute float aRandom;',
        'varying float vProgress;',
        shader.vertexShader,
      ].join('\n');
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          'vec3 transformed = vec3(position);',
          'float angle = atan(transformed.x, transformed.z);',
          'float normalizedAngle = abs(angle) / 3.14159265359;',
          'float spawnThreshold = 1.0 - normalizedAngle;',
          'float progressValue = (uProgress * 1.4) - spawnThreshold;',
          'float particleProgress = smoothstep(0.0, 0.4, progressValue);',
          'vProgress = particleProgress;',
          'transformed.y += sin(angle * 10.0 + time) * 0.05 * aRandom;',
          'if (uProgress > 0.5) {',
          '  for (int i = 0; i < 75; i++) {',
          '    vec4 astData = uAsteroids[i];',
          '    vec3 delta = transformed - astData.xyz;',
          '    float dist = length(delta);',
          '    float rad = astData.w * 2.0 + 0.15;',
          '    if (dist < rad) {',
          '      float force = pow((rad - dist) / rad, 2.0);',
          '      transformed += normalize(delta) * force * 0.4;',
          '      transformed.y += force * 0.20 * (aRandom - 0.5);',
          '    }',
          '  }',
          '}',
          'float swirl = (1.0 - particleProgress) * 4.0;',
          'float s = sin(swirl);',
          'float c = cos(swirl);',
          'transformed.xz = mat2(c, -s, s, c) * transformed.xz;',
          'transformed.y += (1.0 - particleProgress) * (transformed.y >= 0.0 ? 1.0 : -1.0);',
          'vec3 moonSurface = normalize(transformed) * 2.03;',
          'transformed = mix(moonSurface, transformed, particleProgress);',
        ].join('\n'),
      );
      shader.fragmentShader = ['varying float vProgress;', shader.fragmentShader].join('\n');
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        ['#include <color_fragment>', 'diffuseColor.a *= vProgress;'].join('\n'),
      );
    };

    const ring = new THREE.Points(ringGeometry, ringMaterial);
    // The dust geometry is already laid out in the XZ plane, which is the plane of
    // the groove (the sphere's equator): no extra tilt, or the sheet would stand
    // up perpendicular to the crack that it crawls out of.
    ring.frustumCulled = false;
    group.add(ring);

    const belt = new THREE.InstancedMesh(asteroidGeometry, beltMaterialFor(texture), ASTEROID_COUNT);
    belt.frustumCulled = false;
    group.add(belt);

    // The four stones that carry the module's operations live outside the random
    // belt: they are placed from the label positions every frame.
    const marks = new THREE.InstancedMesh(asteroidGeometry, belt.material, 4);
    marks.frustumCulled = false;
    group.add(marks);

    scene.add(group);
    return {
      group,
      body,
      bodyMaterial,
      innerMaterial,
      wall,
      wallMaterial: wallMaterialForMoon,
      shards,
      shardUniforms,
      ring,
      ringMaterial,
      ringUniforms,
      belt,
      marks,
      asteroids: generateAsteroids(ASTEROID_COUNT),
      beltScale: 0,
    };
  };

  const render = (
    bodies: MoonBody[],
    proj: Float32Array,
    view: Float32Array,
    rot: Float32Array,
  ) => {
    while (moons.length < bodies.length) moons.push(buildMoon());

    camera.projectionMatrix.fromArray(proj);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.matrixWorldInverse.fromArray(view);
    camera.matrixWorld.copy(camera.matrixWorldInverse).invert();

    matrix.set(
      rot[0], rot[3], rot[6], 0,
      rot[1], rot[4], rot[7], 0,
      rot[2], rot[5], rot[8], 0,
      0, 0, 0, 1,
    );
    quaternion.setFromRotationMatrix(matrix);

    const delta = 1 / 60;
    // The core's lava drifts on its own clock; every moon reads the same one, so
    // the seams and the glow behind them stay in step.
    coreTime.value = (coreTime.value + delta) % 600;

    moons.forEach((moon, index) => {
      const body = bodies[index];
      const visible = Boolean(body) && body.alpha > 0.01;
      moon.group.visible = visible;
      if (!body || !visible) return;

      position.set(body.offset[0], body.offset[1], body.offset[2]).applyMatrix4(matrix);
      moon.group.position.copy(position);
      moon.group.quaternion.copy(quaternion);
      // The star field draws its stars on a half-unit radius; the reference sphere
      // is two units, so the whole assembly shrinks to fit that star.
      const unit = (0.5 * body.scale) / MOON_RADIUS;
      moon.group.scale.setScalar(unit);

      const fade = Math.min(1, body.alpha);
      moon.bodyMaterial.opacity = fade;
      moon.innerMaterial.uniforms.uAlpha.value = fade;
      moon.wallMaterial.uniforms.uAlpha.value = fade;
      moon.ringMaterial.opacity = 0.3 * fade;
      // Point sizes are world units in three's point shader, and the grains have to
      // shrink with the body: this keeps them about a pixel wide at the reference's
      // dust-to-moon ratio.
      moon.ringMaterial.size = 0.02 * unit;

      moon.body.rotation.y += delta * 0.05;
      moon.ring.rotation.y -= delta * 0.02;

      // The flight already ramps a progress value; the reference sweeps the whole
      // ring in at 1.4x that, so it is scaled up to land at one.
      // Dev-only: a test can pin the sweep to inspect any instant of the burst.
      const forced = import.meta.env.DEV
        ? (window as unknown as { __moonForceProgress?: number }).__moonForceProgress
        : undefined;
      const progress = typeof forced === 'number'
        ? Math.max(0, Math.min(1, forced))
        : Math.max(0, Math.min(1, body.progress * 1.8));
      moon.ringUniforms.uProgress.value = progress;
      moon.shardUniforms.uShard.value = progress;
      moon.shardUniforms.uShardTime.value += delta;
      moon.shards.visible = body.alpha > 0.02;
      (moon.shards.material as THREE.MeshStandardMaterial).opacity = Math.min(1, body.alpha);
      moon.ringUniforms.time.value += delta;

      // Asteroid belt: orbits, bounces off the ring's inner edge and fades in with
      // the dust. The seeds live in the moon's own frame, so the ring can shift
      // them locally the way the reference shader expects.
      moon.ring.updateMatrix();
      ringMatrix.copy(moon.ring.matrix).invert();
      const target = progress > 0.05 ? 1 : 0;
      moon.beltScale = THREE.MathUtils.lerp(moon.beltScale, target, delta * (target > 0 ? 2 : 5));
      moon.belt.visible = moon.beltScale > 0.01;

      moon.asteroids.forEach((asteroid, i) => {
        asteroid.angle += asteroid.speed * delta;
        asteroid.phase += asteroid.radialSpeed * delta;
        let currentRadius = asteroid.baseRadius + Math.sin(asteroid.phase) * asteroid.radialAmplitude;
        if (currentRadius < 2.15) {
          currentRadius = 2.15 + (2.15 - currentRadius) * 0.85;
        }
        // Same plane as the dust and the groove: XZ, with zOffset as the only
        // lift off it. (The reference orbited in XY and rotated its ring to lay it
        // down; ours is authored already flat, so the axes are swapped here.)
        const x = Math.cos(asteroid.angle) * currentRadius;
        const z = Math.sin(asteroid.angle) * currentRadius;

        asteroidLocal.set(x, asteroid.zOffset, z).applyMatrix4(ringMatrix);
        moon.ringUniforms.uAsteroids.value[i * 4] = asteroidLocal.x;
        moon.ringUniforms.uAsteroids.value[i * 4 + 1] = asteroidLocal.y;
        moon.ringUniforms.uAsteroids.value[i * 4 + 2] = asteroidLocal.z;
        moon.ringUniforms.uAsteroids.value[i * 4 + 3] = asteroid.scale;

        asteroid.rx += asteroid.rsx;
        asteroid.ry += asteroid.rsy;
        asteroid.rz += asteroid.rsz;

        dummy.position.set(x, asteroid.zOffset, z);
        dummy.rotation.set(asteroid.rx, asteroid.ry, asteroid.rz);
        dummy.scale.setScalar(asteroid.scale * moon.beltScale);
        dummy.updateMatrix();
        moon.belt.setMatrixAt(i, dummy.matrix);
      });
      moon.belt.instanceMatrix.needsUpdate = true;

      // The operations ride their own four stones, parked where their labels are.
      moon.marks.visible = moon.beltScale > 0.01;
      for (let i = 0; i < 4; i += 1) {
        const mark = body.marks?.[i];
        if (!mark) {
          dummy.position.set(0, 0, 0);
          dummy.scale.setScalar(0);
        } else {
          // index.tsx measures these in star radii of the constellation; the rig's
          // sphere is two units wide, so one star radius is two rig units.
          dummy.position.set(mark[0] * 2, mark[1] * 2, mark[2] * 2);
          dummy.scale.setScalar(0.26 * moon.beltScale);
        }
        dummy.rotation.set(0.4 * i, 0.7 * i, 0.2 * i);
        dummy.updateMatrix();
        moon.marks.setMatrixAt(i, dummy.matrix);
      }
      moon.marks.instanceMatrix.needsUpdate = true;
    });

    if (import.meta.env.DEV) {
      (window as unknown as { __moonDebug?: unknown }).__moonDebug = moons.map((moon) => ({
        progress: moon.ringUniforms.uProgress.value,
        ringAlpha: moon.ringMaterial.opacity,
        ringSize: moon.ringMaterial.size,
        ringVisible: moon.ring.visible,
        belt: moon.beltScale,
        shard: moon.shardUniforms.uShard.value,
        scale: moon.group.scale.x,
      }));
    }

    renderer.render(scene, camera);
  };

  return {
    render,
    resize: (width, height, dpr) => {
      renderer.setPixelRatio(Math.min(dpr, 2));
      renderer.setSize(width, height, false);
    },
    dispose: () => {
      moons.forEach((moon) => scene.remove(moon.group));
      sphereGeometry.dispose();
      wallGeometry.dispose();
      shardGeometry.dispose();
      innerGeometry.dispose();
      asteroidGeometry.dispose();
      ringGeometry.dispose();
      texture.dispose();
      renderer.dispose();
    },
  };
};
