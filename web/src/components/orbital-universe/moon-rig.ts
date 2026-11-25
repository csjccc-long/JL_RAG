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

/**
 * A sphere with the shatter already carved into it: one groove around the
 * equator, where the ring of dust breaks out, and cracks climbing from that
 * groove toward both poles. They fade out well before the poles, so the caps
 * stay whole.
 */
const buildCrackedSphere = () => {
  const geometry = new THREE.SphereGeometry(MOON_RADIUS, 160, 160);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const unit = new THREE.Vector3();
  const cracks = new Float32Array(position.count);
  const radius = MOON_RADIUS;

  for (let i = 0; i < position.count; i += 1) {
    unit.set(position.getX(i), position.getY(i), position.getZ(i)).normalize();
    const lat = unit.y;
    const angle = Math.atan2(unit.z, unit.x);
    const absLat = Math.abs(lat);

    // The groove the dust ring sits in: a band either side of the equator.
    const groove = 1 - THREE.MathUtils.smoothstep(absLat, 0.01, 0.17);
    // How far up from the groove the cracks are allowed to reach: a short way,
    // never to the pole.
    const reach = 1 - THREE.MathUtils.smoothstep(absLat, 0.12, 0.62);

    // Cracks run up the meridians, wandering a little with latitude.
    const wander = noise2(angle * 1.7, lat * 3.1) * 0.9;
    const ridge = 1 - Math.abs(2 * noise2(angle * 11.0 + wander, lat * 9.0) - 1);
    const fine = 1 - Math.abs(2 * noise2(angle * 23.0, lat * 17.0) - 1);
    const crack =
      Math.max(
        THREE.MathUtils.smoothstep(ridge, 0.86, 0.99),
        THREE.MathUtils.smoothstep(fine, 0.94, 1.0) * 0.6,
      ) * reach;

    const dent = groove * 0.085 + crack * 0.055;
    const scale = (radius - dent) / radius;
    position.setXYZ(i, unit.x * scale * radius, unit.y * scale * radius, unit.z * scale * radius);
    cracks[i] = Math.max(groove, crack);
  }

  position.needsUpdate = true;
  geometry.setAttribute('aCrack', new THREE.BufferAttribute(cracks, 1));
  geometry.computeVertexNormals();
  return geometry;
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
  const sphereGeometry = buildCrackedSphere();
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
    const crackTint = { value: 1 };
    bodyMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uCrackTint = crackTint;
      shader.vertexShader = [
        'attribute float aCrack;',
        'varying float vCrack;',
        shader.vertexShader,
      ].join('\n');
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vCrack = aCrack;',
      );
      shader.fragmentShader = [
        'uniform float uCrackTint;',
        'varying float vCrack;',
        shader.fragmentShader,
      ].join('\n');
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          '  float cut = smoothstep(0.03, 0.62, vCrack);',
          '  diffuseColor.rgb *= mix(1.0, 0.34, cut);',
        ].join('\n'),
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '  totalEmissiveRadiance += vec3(0.95, 0.34, 0.10) * smoothstep(0.5, 0.95, vCrack) * 0.55 * uCrackTint;',
        ].join('\n'),
      );
    };

    const body = new THREE.Mesh(sphereGeometry, bodyMaterial);
    group.add(body);

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
          'vec3 moonSurface = normalize(transformed) * 2.1;',
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
    // Horizontal in its own frame, exactly as the reference lays it out.
    ring.rotation.x = -Math.PI / 2;
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

      moon.bodyMaterial.opacity = Math.min(1, body.alpha);
      moon.ringMaterial.opacity = 0.3 * Math.min(1, body.alpha);
      // Point sizes are world units in three's point shader, and the grains have to
      // shrink with the body: this keeps them about a pixel wide at the reference's
      // dust-to-moon ratio.
      moon.ringMaterial.size = 0.02 * unit;

      moon.body.rotation.y += delta * 0.05;
      moon.ring.rotation.y -= delta * 0.02;

      // The flight already ramps a progress value; the reference sweeps the whole
      // ring in at 1.4x that, so it is scaled up to land at one.
      const progress = Math.max(0, Math.min(1, body.progress * 1.8));
      moon.ringUniforms.uProgress.value = progress;
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
        const x = Math.cos(asteroid.angle) * currentRadius;
        const y = Math.sin(asteroid.angle) * currentRadius;

        asteroidLocal.set(x, y, asteroid.zOffset).applyMatrix4(ringMatrix);
        moon.ringUniforms.uAsteroids.value[i * 4] = asteroidLocal.x;
        moon.ringUniforms.uAsteroids.value[i * 4 + 1] = asteroidLocal.y;
        moon.ringUniforms.uAsteroids.value[i * 4 + 2] = asteroidLocal.z;
        moon.ringUniforms.uAsteroids.value[i * 4 + 3] = asteroid.scale;

        asteroid.rx += asteroid.rsx;
        asteroid.ry += asteroid.rsy;
        asteroid.rz += asteroid.rsz;

        dummy.position.set(x, y, asteroid.zOffset);
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
      asteroidGeometry.dispose();
      ringGeometry.dispose();
      texture.dispose();
      renderer.dispose();
    },
  };
};
