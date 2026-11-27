/*
 * Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as THREE from 'three';

/**
 * The flower this page grows is a six-petalled pinwheel bloom: every whorl has
 * petals that sweep sideways and curl at the tip, so the whole corolla turns
 * the same way the Flow RAG mark does. It is a real flower - petals, sepals,
 * stamen head, stem and leaves - not a traced logo.
 *
 * Petals are built as thin parametric surfaces rather than extruded slabs: a
 * petal is a sheet a fraction of a millimetre thick, and modelling it that way
 * is what keeps the edges from looking like cut plastic.
 */
export interface FlowerMaterials {
  outer: THREE.Material;
  inner: THREE.Material;
  core: THREE.Material;
  stamen: THREE.Material;
  stem: THREE.Material;
  leaf: THREE.Material;
}

export interface PetalShape {
  length: number;
  width: number;
  /** How much the petal curls across its own width. */
  cup: number;
  /** How far the tip lifts out of the petal plane. */
  tipLift: number;
  /** How far the tip sweeps sideways, which is what makes the bloom pinwheel. */
  sway: number;
  /** Total twist from base to tip. */
  twist: number;
  /** Extra curl right at the tip. */
  curl: number;
  /** How far the margin rolls back along the petal. */
  marginRoll: number;
  /** Amplitude of the ripple along the margin. */
  ruffle: number;
  /** Corrugation running across the blade, like the pleats of a real petal. */
  pleat: number;
  /** Waviness of the outer margin. */
  edgeWave: number;
  /** Thickness of the solid blade at its centre. */
  thickness: number;
  /** Phase offset so no two petals are the same shape. */
  seed: number;
}

const cache = new Map<string, THREE.BufferGeometry>();

const petalKey = (shape: PetalShape) =>
  [
    shape.length,
    shape.width,
    shape.cup,
    shape.tipLift,
    shape.sway,
    shape.twist,
    shape.curl,
    shape.marginRoll,
    shape.ruffle,
    shape.pleat,
    shape.edgeWave,
    shape.thickness,
    Math.round(shape.seed * 1000),
  ].join('|');

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

let petalTexture: THREE.Texture | null = null;
let petalBump: THREE.Texture | null = null;

/**
 * A painted petal: a deep claw, a pale margin, fine veins fanning out of the
 * base and a little mottling. It is grey on purpose - the material tints it -
 * so one texture serves petals, sepals and leaves under both themes.
 */
export const getPetalTexture = (): THREE.Texture => {
  if (petalTexture) return petalTexture;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const base = ctx.createLinearGradient(0, canvas.height, 0, 0);
  base.addColorStop(0, 'rgb(96,102,116)');
  base.addColorStop(0.18, 'rgb(150,155,166)');
  base.addColorStop(0.55, 'rgb(214,218,226)');
  base.addColorStop(0.85, 'rgb(248,250,253)');
  base.addColorStop(1, 'rgb(255,255,255)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Veins fanning out of the claw.
  ctx.lineCap = 'round';
  for (let k = -5; k <= 5; k += 1) {
    const spread = k / 5;
    ctx.beginPath();
    ctx.moveTo(128 + spread * 6, 500);
    ctx.bezierCurveTo(
      128 + spread * 40,
      360,
      128 + spread * 70,
      200,
      128 + spread * 96,
      18,
    );
    ctx.strokeStyle =
      k === 0 ? 'rgba(72,78,92,0.30)' : 'rgba(80,86,100,0.16)';
    ctx.lineWidth = k === 0 ? 2.4 : 1.2;
    ctx.stroke();
  }

  // Mottling so the surface is never a flat fill.
  for (let i = 0; i < 90; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = 8 + Math.random() * 42;
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() > 0.5;
    blob.addColorStop(0, dark ? 'rgba(90,96,110,0.05)' : 'rgba(255,255,255,0.06)');
    blob.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = blob;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Slightly deeper margins.
  const left = ctx.createLinearGradient(0, 0, 46, 0);
  left.addColorStop(0, 'rgba(64,70,86,0.22)');
  left.addColorStop(1, 'rgba(64,70,86,0)');
  ctx.fillStyle = left;
  ctx.fillRect(0, 0, 46, canvas.height);
  const right = ctx.createLinearGradient(canvas.width, 0, canvas.width - 46, 0);
  right.addColorStop(0, 'rgba(64,70,86,0.22)');
  right.addColorStop(1, 'rgba(64,70,86,0)');
  ctx.fillStyle = right;
  ctx.fillRect(canvas.width - 46, 0, 46, canvas.height);

  petalTexture = new THREE.CanvasTexture(canvas);
  petalTexture.colorSpace = THREE.SRGBColorSpace;
  petalTexture.anisotropy = 4;
  petalTexture.needsUpdate = true;
  return petalTexture;
};

/**
 * A bump map for the petals: the same veins and fine surface wrinkles, but in
 * greyscale so the shading engine reads it as relief rather than colour.
 */
export const getPetalBump = (): THREE.Texture => {
  if (petalBump) return petalBump;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Fine wrinkles running with the blade.
  for (let i = 0; i < 220; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const len = 40 + Math.random() * 160;
    const drift = (Math.random() - 0.5) * 60;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + drift * 0.5, y + len * 0.5, x + drift, y + len);
    const tone = Math.random() > 0.5 ? 150 : 104;
    ctx.strokeStyle = `rgba(${tone},${tone},${tone},0.16)`;
    ctx.lineWidth = 1 + Math.random() * 2.5;
    ctx.stroke();
  }

  // The midrib and the fan of secondary veins, pressed into the sheet.
  ctx.lineCap = 'round';
  for (let k = -7; k <= 7; k += 1) {
    const spread = k / 7;
    ctx.beginPath();
    ctx.moveTo(256 + spread * 12, 1010);
    ctx.bezierCurveTo(
      256 + spread * 76,
      760,
      256 + spread * 140,
      400,
      256 + spread * 200,
      30,
    );
    const tone = k === 0 ? 92 : 112;
    ctx.strokeStyle = `rgba(${tone},${tone},${tone},0.55)`;
    ctx.lineWidth = k === 0 ? 6 : 3;
    ctx.stroke();
  }

  petalBump = new THREE.CanvasTexture(canvas);
  petalBump.anisotropy = 4;
  petalBump.needsUpdate = true;
  return petalBump;
};

/**
 * A petal as a solid blade. The mid-surface is a parametric sheet - the spine
 * sweeps sideways, the blade cups across its width, the margin rolls back and
 * the whole blade twists as it leaves the claw - and the solid is built by
 * pushing that sheet out to either side, tapering to nothing at the margin, so
 * every petal has a real rounded edge instead of a cut-paper silhouette.
 */
export const createPetalGeometry = (shape: PetalShape): THREE.BufferGeometry => {
  const key = petalKey(shape);
  const cached = cache.get(key);
  if (cached) return cached;

  const U = 64;
  const V = 30;
  const cos = Math.cos;
  const sin = Math.sin;

  const sheet = (u: number, v: number): [number, number, number] => {
    // An obovate blade: narrow claw, widest a little past the middle, rounded
    // tip. `ratio` is the local half width normalised by the widest one, and
    // every depth term is scaled by it so the cup closes instead of pinching.
    const profile = Math.pow(Math.sin(Math.PI * u), 0.5);
    const shapeFactor = 0.3 + 0.7 * Math.pow(u, 0.7);
    const ratio = Math.min(1, profile * shapeFactor);
    const twist = shape.twist * Math.pow(u, 0.85);
    const ct = cos(twist);
    const st = sin(twist);
    // The trailing edge is a little narrower than the leading one.
    const half = shape.width * ratio * (v > 0 ? 1 : 0.86);
    const margin = Math.abs(v);

    const x0 = v * half;
    const y = u * shape.length;
    let z =
      shape.cup * v * v * ratio * (0.35 + 0.65 * u) +
      shape.tipLift * Math.pow(u, 1.6) +
      shape.curl * Math.pow(u, 3.2);
    // Rolled margin, eased in so it never creases the blade.
    z += shape.marginRoll * Math.pow(smoothstep(0.45, 1, margin), 2) * (0.2 + 0.8 * u);
    // Ruffle, strongest along the outer margin.
    z +=
      shape.ruffle *
      smoothstep(0.35, 0.95, u) *
      v * v *
      sin(u * 7 - v * 2.4 + shape.seed * 6.2832);
    // Gentle pleats fanning across the blade.
    z +=
      shape.pleat *
      Math.pow(u, 1.2) *
      sin(v * Math.PI * 2 + u * 1.4 + shape.seed * 3.1416);
    // The margin itself undulates rather than sitting on a clean curve.
    z +=
      shape.edgeWave *
      Math.pow(smoothstep(0.65, 1, margin), 2) *
      sin(u * 6.5 + v * 0.8 + shape.seed * 2.1) *
      u;
    // A breath of low-frequency waviness so the surface is never machine flat.
    z += 0.006 * Math.pow(u, 1.4) * sin(u * 5.5 + v * 3.1 + shape.seed * 9.4);

    const x = x0 * ct - z * st + shape.sway * Math.pow(u, 1.7);
    const zz = x0 * st + z * ct;
    return [x, y, zz];
  };

  const count = (U + 1) * (V + 1);
  const positions = new Float32Array(count * 6);
  const colors = new Float32Array(count * 6);
  const uvs = new Float32Array(count * 4);
  const eps = 1 / 256;
  const halfThickness = Math.max(shape.thickness, 0.001) * 0.5;

  for (let i = 0; i <= U; i += 1) {
    const u = i / U;
    for (let j = 0; j <= V; j += 1) {
      const v = -1 + (2 * j) / V;
      const p0 = sheet(u, v);
      const pU = sheet(Math.min(1, u + eps), v);
      const pD = sheet(Math.max(0, u - eps), v);
      const pV = sheet(u, Math.min(1, v + eps));
      const pW = sheet(u, Math.max(0, v - eps));

      const du = [pU[0] - pD[0], pU[1] - pD[1], pU[2] - pD[2]];
      const dv = [pV[0] - pW[0], pV[1] - pW[1], pV[2] - pW[2]];
      let nx = du[1] * dv[2] - du[2] * dv[1];
      let ny = du[2] * dv[0] - du[0] * dv[2];
      let nz = du[0] * dv[1] - du[1] * dv[0];
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      // Thickness fades to zero at the claw, the tip and both margins, which
      // is what makes the edge read as a rolled petal rim.
      const fade =
        smoothstep(0, 0.12, u) *
        smoothstep(0, 0.09, 1 - u) *
        smoothstep(0, 0.3, 1 - Math.abs(v));
      const d = halfThickness * fade;

      const slot = i * (V + 1) + j;
      const rim = Math.abs(v);
      const shade =
        (0.7 + 0.3 * Math.pow(u, 0.75)) * (1 + 0.14 * Math.pow(rim, 4));
      const c = Math.min(1.35, shade);

      for (let layer = 0; layer < 2; layer += 1) {
        const sign = layer === 0 ? 1 : -1;
        const base = (layer * count + slot) * 3;
        positions[base] = p0[0] + nx * d * sign;
        positions[base + 1] = p0[1] + ny * d * sign;
        positions[base + 2] = p0[2] + nz * d * sign;
        colors[base] = c;
        colors[base + 1] = c;
        colors[base + 2] = c;
        const uvBase = (layer * count + slot) * 2;
        uvs[uvBase] = (v + 1) / 2;
        uvs[uvBase + 1] = u;
      }
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < U; i += 1) {
    for (let j = 0; j < V; j += 1) {
      const a = i * (V + 1) + j;
      const b = a + 1;
      const cIdx = a + (V + 1);
      const d = cIdx + 1;
      // Outer skin.
      indices.push(a, cIdx, b, b, cIdx, d);
      // Inner skin, wound the other way so the solid is closed.
      indices.push(
        a + count,
        b + count,
        cIdx + count,
        b + count,
        d + count,
        cIdx + count,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  cache.set(key, geometry);
  return geometry;
};

const addMesh = (
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  rotation: [number, number, number],
  scale = 1,
) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.scale.setScalar(scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
};

const whorl = (
  parent: THREE.Object3D,
  shape: PetalShape,
  material: THREE.Material,
  options: {
    count: number;
    offset: number;
    radius: number;
    height: number;
    tilt: number;
    scale: number;
  },
) => {
  for (let i = 0; i < options.count; i += 1) {
    const arm = new THREE.Group();
    // A little deterministic irregularity: real whorls are never perfectly
    // spaced and never have every petal at exactly the same angle.
    const jitter = Math.sin((i + 1) * 12.9898) * 0.5 + Math.sin((i + 1) * 4.1414) * 0.5;
    arm.rotation.y =
      options.offset + (i * Math.PI * 2) / options.count + jitter * 0.035;
    parent.add(arm);
    // Each blade gets its own shape, so the corolla never repeats a silhouette.
    const geometry = createPetalGeometry({
      ...shape,
      seed: shape.seed + i * 0.37 + options.offset,
    });
    addMesh(
      arm,
      geometry,
      material,
      [0, options.height + jitter * 0.006, -options.radius],
      [-Math.PI / 2 + options.tilt + jitter * 0.05, jitter * 0.05, 0],
      options.scale * (1 + jitter * 0.03),
    );
  }
};

/** Builds one complete flower, standing on a stem, blossom at the origin. */
export const buildFlower = (materials: FlowerMaterials): THREE.Group => {
  const flower = new THREE.Group();

  // Every whorl is cupped: strong across the width, and swept sideways so the
  // corolla turns the way the mark turns.
  // Six separate blades: each one a clean, gently cupped leaf that lifts a
  // little at the tip, so a petal always reads as its own piece with its own
  // edge instead of melting into the petal beside it.
  const outerPetal: PetalShape = {
    length: 0.82,
    width: 0.44,
    cup: 0.13,
    tipLift: 0.05,
    sway: 0.06,
    twist: 0.1,
    curl: 0.02,
    marginRoll: 0.012,
    ruffle: 0.012,
    pleat: 0.004,
    edgeWave: 0.006,
    thickness: 0.014,
    seed: 0.11,
  };
  const midPetal: PetalShape = {
    length: 0.62,
    width: 0.38,
    cup: 0.12,
    tipLift: 0.06,
    sway: 0.05,
    twist: 0.09,
    curl: 0.03,
    marginRoll: 0.012,
    ruffle: 0.01,
    pleat: 0.004,
    edgeWave: 0.005,
    thickness: 0.012,
    seed: 0.47,
  };
  const innerPetal: PetalShape = {
    length: 0.36,
    width: 0.26,
    cup: 0.14,
    tipLift: 0.1,
    sway: 0.03,
    twist: 0.07,
    curl: 0.06,
    marginRoll: 0.014,
    ruffle: 0.008,
    pleat: 0.004,
    edgeWave: 0.004,
    thickness: 0.01,
    seed: 0.73,
  };
  const sepal: PetalShape = {
    length: 0.34,
    width: 0.1,
    cup: 0.02,
    tipLift: -0.04,
    sway: 0.02,
    twist: 0.1,
    curl: -0.03,
    marginRoll: 0.008,
    ruffle: 0,
    pleat: 0.004,
    edgeWave: 0.006,
    thickness: 0.009,
    seed: 0.29,
  };
  const leaf: PetalShape = {
    length: 0.55,
    width: 0.16,
    cup: 0.05,
    tipLift: -0.08,
    sway: 0.03,
    twist: 0.16,
    curl: -0.06,
    marginRoll: 0.014,
    ruffle: 0.008,
    pleat: 0.012,
    edgeWave: 0.012,
    thickness: 0.01,
    seed: 0.61,
  };

  // Outer whorl: six blades laid open, each one clear of its neighbours.
  whorl(flower, outerPetal, materials.outer, {
    count: 6,
    offset: 0,
    radius: 0.035,
    height: 0,
    tilt: 0.34,
    scale: 1,
  });
  // Second whorl, offset by half a petal, standing steeper.
  whorl(flower, midPetal, materials.inner, {
    count: 6,
    offset: Math.PI / 6,
    radius: 0.03,
    height: 0.02,
    tilt: 0.62,
    scale: 1,
  });
  // Inner whorl closes into a bud, so the middle of the flower is a bud
  // wrapped in petals instead of a knot of surfaces cutting through each other.
  whorl(flower, innerPetal, materials.inner, {
    count: 4,
    offset: Math.PI / 4,
    radius: 0.055,
    height: 0.05,
    tilt: 0.62,
    scale: 0.8,
  });
  // Sepals tucked back under the corolla.
  whorl(flower, sepal, materials.leaf, {
    count: 5,
    offset: 0.4,
    radius: 0.028,
    height: -0.04,
    tilt: -0.15,
    scale: 1,
  });

  const receptacle = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 32, 24),
    materials.core,
  );
  receptacle.position.y = 0.03;
  receptacle.scale.set(1, 0.62, 1);
  receptacle.castShadow = true;
  flower.add(receptacle);

  const stamenGeometry = new THREE.SphereGeometry(0.012, 16, 12);
  const stamens = new THREE.Group();
  for (let i = 0; i < 28; i += 1) {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const angle = i * golden;
    const radius = 0.085 * Math.sqrt((i + 0.5) / 28);
    const stamen = new THREE.Mesh(stamenGeometry, materials.stamen);
    stamen.position.set(
      Math.cos(angle) * radius,
      0.06 + 0.04 * Math.cos((radius / 0.085) * Math.PI * 0.5),
      Math.sin(angle) * radius,
    );
    stamen.castShadow = true;
    stamens.add(stamen);
  }
  flower.add(stamens);

  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.02, 0),
    new THREE.Vector3(0.04, -0.32, 0.02),
    new THREE.Vector3(-0.02, -0.66, -0.02),
    new THREE.Vector3(0.06, -1.0, 0.04),
  ]);
  const stem = new THREE.Mesh(
    new THREE.TubeGeometry(stemCurve, 96, 0.02, 14, false),
    materials.stem,
  );
  stem.castShadow = true;
  stem.receiveShadow = true;
  flower.add(stem);

  const leafHolders: [number, number, number][] = [
    [0.04, -0.36, 0.02],
    [-0.02, -0.7, -0.01],
  ];
  for (let i = 0; i < leafHolders.length; i += 1) {
    const [x, y, z] = leafHolders[i];
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.rotation.y = i === 0 ? -0.5 : 2.5;
    holder.rotation.z = i === 0 ? 0.5 : 0.62;
    holder.rotation.x = 0.16;
    flower.add(holder);
    addMesh(
      holder,
      createPetalGeometry({ ...leaf, seed: leaf.seed + i * 0.53 }),
      materials.leaf,
      [0, 0, 0.02],
      [-Math.PI / 2 + 0.18, 0, 0],
      0.9,
    );
  }

  flower.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return flower;
};

export const disposeFlower = (flower: THREE.Group) => {
  flower.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
};

export const disposePetalCache = () => {
  cache.forEach((geometry) => geometry.dispose());
  cache.clear();
};