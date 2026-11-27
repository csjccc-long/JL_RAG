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
import {
  buildFlower,
  disposeFlower,
  disposePetalCache,
  getPetalBump,
  getPetalTexture,
  type FlowerMaterials,
} from './flower-model';

export type FlowerTheme = 'dark' | 'light';

export interface FlowerSceneOptions {
  theme?: FlowerTheme;
  /** Slow idle rotation of the bloom. */
  spin?: boolean;
}

export interface FlowerSceneApi {
  setTheme: (theme: FlowerTheme) => void;
  setSpin: (spin: boolean) => void;
  /** Returns the camera to its opening framing. */
  reset: () => void;
  dispose: () => void;
}

interface Palette {
  outer: { color: number; attenuation: number };
  inner: { color: number; attenuation: number };
  core: number;
  stamen: number;
  stem: number;
  leaf: number;
  exposure: number;
  halo: number;
  shadows: number;
}

const PALETTES: Record<FlowerTheme, Palette> = {
  dark: {
    outer: { color: 0x3d6bff, attenuation: 0x142f8d },
    inner: { color: 0x7ea8ff, attenuation: 0x2b56b8 },
    core: 0x25497a,
    stamen: 0xffe6a6,
    stem: 0x2f9c86,
    leaf: 0x39b094,
    exposure: 1.05,
    halo: 0.85,
    shadows: 0.55,
  },
  light: {
    outer: { color: 0xe4eeff, attenuation: 0x9db9e8 },
    inner: { color: 0xf8fbff, attenuation: 0xc3d5f2 },
    core: 0x24405f,
    stamen: 0xffd877,
    stem: 0x3f9a80,
    leaf: 0x4aa88b,
    exposure: 1.0,
    halo: 0.28,
    shadows: 0.3,
  },
};

const TARGET = new THREE.Vector3(0, -0.3, 0);
const MIN_RADIUS = 1.7;
const MAX_RADIUS = 5;
const START_RADIUS = 4.4;
const START_YAW = 0.34;
const START_PITCH = 0.62;
const SPIN_SPEED = 0.24;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** An equirectangular studio gradient, so the glass petals have something to reflect. */
const drawEnvironment = (
  canvas: HTMLCanvasElement,
  theme: FlowerTheme,
): THREE.Texture => {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  if (theme === 'light') {
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.46, '#d3e0f4');
    gradient.addColorStop(0.64, '#8ea3c0');
    gradient.addColorStop(1, '#33465e');
  } else {
    gradient.addColorStop(0, '#3f7bff');
    gradient.addColorStop(0.32, '#15214a');
    gradient.addColorStop(0.62, '#070c1a');
    gradient.addColorStop(1, '#000206');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.globalCompositeOperation = 'lighter';
  const blobs: [number, number, number, string][] =
    theme === 'light'
      ? [
          [width * 0.2, height * 0.2, width * 0.1, 'rgba(255,255,255,0.95)'],
          [width * 0.68, height * 0.16, width * 0.08, 'rgba(235,245,255,0.9)'],
          [width * 0.5, height * 0.84, width * 0.18, 'rgba(120,160,220,0.35)'],
        ]
      : [
          [width * 0.2, height * 0.2, width * 0.09, 'rgba(230,245,255,0.98)'],
          [width * 0.7, height * 0.14, width * 0.07, 'rgba(150,205,255,0.95)'],
          [width * 0.5, height * 0.82, width * 0.16, 'rgba(40,90,230,0.45)'],
        ];
  for (const [x, y, radius, color] of blobs) {
    const blob = ctx.createRadialGradient(x, y, 0, x, y, radius);
    blob.addColorStop(0, color);
    blob.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = blob;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

const createMaterials = (theme: FlowerTheme): FlowerMaterials => {
  const palette = PALETTES[theme];
  return {
    outer: new THREE.MeshPhysicalMaterial({
      color: palette.outer.color,
      map: getPetalTexture(),
      bumpMap: getPetalBump(),
      bumpScale: 0.014,
      metalness: 0,
      roughness: 0.56,
      transmission: 0.06,
      thickness: 0.7,
      ior: 1.44,
      attenuationColor: new THREE.Color(palette.outer.attenuation),
      attenuationDistance: 0.5,
      clearcoat: 0.25,
      clearcoatRoughness: 0.45,
      specularIntensity: 0.6,
      sheen: 1,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color(0xe4efff),
      iridescence: 0.16,
      iridescenceIOR: 1.25,
      envMapIntensity: 1.2,
      vertexColors: true,
      side: THREE.DoubleSide,
    }),
    inner: new THREE.MeshPhysicalMaterial({
      color: palette.inner.color,
      map: getPetalTexture(),
      bumpMap: getPetalBump(),
      bumpScale: 0.011,
      metalness: 0,
      roughness: 0.54,
      transmission: 0.05,
      thickness: 0.6,
      ior: 1.44,
      attenuationColor: new THREE.Color(palette.inner.attenuation),
      attenuationDistance: 0.9,
      clearcoat: 0.22,
      clearcoatRoughness: 0.45,
      specularIntensity: 0.6,
      sheen: 1,
      sheenRoughness: 0.55,
      sheenColor: new THREE.Color(0xf4f9ff),
      iridescence: 0.12,
      iridescenceIOR: 1.25,
      envMapIntensity: 1.15,
      vertexColors: true,
      side: THREE.DoubleSide,
    }),
    core: new THREE.MeshPhysicalMaterial({
      color: palette.core,
      metalness: 0.25,
      roughness: 0.45,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
      envMapIntensity: 1,
    }),
    stamen: new THREE.MeshStandardMaterial({
      color: palette.stamen,
      emissive: new THREE.Color(palette.stamen),
      emissiveIntensity: 0.85,
      roughness: 0.4,
    }),
    stem: new THREE.MeshPhysicalMaterial({
      color: palette.stem,
      roughness: 0.42,
      metalness: 0.05,
      clearcoat: 0.35,
      clearcoatRoughness: 0.4,
      sheen: 0.6,
      sheenColor: new THREE.Color(0x8ef0d6),
      envMapIntensity: 0.9,
    }),
    leaf: new THREE.MeshPhysicalMaterial({
      color: palette.leaf,
      map: getPetalTexture(),
      roughness: 0.42,
      metalness: 0.05,
      clearcoat: 0.45,
      clearcoatRoughness: 0.35,
      sheen: 0.7,
      sheenColor: new THREE.Color(0x9df2d8),
      envMapIntensity: 0.95,
      side: THREE.DoubleSide,
      vertexColors: true,
    }),
  };
};

export const createFlowerScene = (
  host: HTMLElement,
  options: FlowerSceneOptions = {},
): FlowerSceneApi => {
  let theme: FlowerTheme = options.theme ?? 'dark';
  let spin = options.spin ?? true;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = PALETTES[theme].exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'mark-flower__canvas';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 512;
  envCanvas.height = 256;
  let envTexture = drawEnvironment(envCanvas, theme);
  let envMap = pmrem.fromEquirectangular(envTexture).texture;
  scene.environment = envMap;

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-2.6, 3.4, 2.8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 12;
  key.shadow.camera.left = -1.4;
  key.shadow.camera.right = 1.4;
  key.shadow.camera.top = 1.6;
  key.shadow.camera.bottom = -1.6;
  key.shadow.bias = -0.0012;
  key.shadow.radius = 4;

  const rim = new THREE.DirectionalLight(0x8fbcff, 1.5);
  rim.position.set(2.8, 1.2, -3.2);
  // A shadowed petal still catches light from the sky and from the petals around
  // it; without these two the unlit sides collapse into flat navy wedges.
  const fill = new THREE.HemisphereLight(0xdfeaff, 0x2b3a5c, 0.62);
  const bounce = new THREE.DirectionalLight(0x9cc0ff, 0.6);
  bounce.position.set(1.6, -2.2, 2.4);
  scene.add(key, rim, fill, bounce);

  const materials = createMaterials(theme);
  let flower = buildFlower(materials);
  scene.add(flower);

  const haloCanvas = document.createElement('canvas');
  haloCanvas.width = 512;
  haloCanvas.height = 512;
  const haloCtx = haloCanvas.getContext('2d')!;
  const haloGradient = haloCtx.createRadialGradient(256, 256, 0, 256, 256, 256);
  haloGradient.addColorStop(0, 'rgba(120,180,255,0.5)');
  haloGradient.addColorStop(0.5, 'rgba(60,110,220,0.16)');
  haloGradient.addColorStop(1, 'rgba(0,0,0,0)');
  haloCtx.fillStyle = haloGradient;
  haloCtx.fillRect(0, 0, 512, 512);
  const haloTexture = new THREE.CanvasTexture(haloCanvas);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  const haloMaterial = new THREE.MeshBasicMaterial({
    map: haloTexture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: PALETTES[theme].halo,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), haloMaterial);
  halo.position.set(0, 0.2, -1.4);
  scene.add(halo);

  const groundCanvas = document.createElement('canvas');
  groundCanvas.width = 256;
  groundCanvas.height = 256;
  const groundCtx = groundCanvas.getContext('2d')!;
  const groundGradient = groundCtx.createRadialGradient(128, 128, 0, 128, 128, 128);
  groundGradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  groundGradient.addColorStop(0.55, 'rgba(0,0,0,0.18)');
  groundGradient.addColorStop(1, 'rgba(0,0,0,0)');
  groundCtx.fillStyle = groundGradient;
  groundCtx.fillRect(0, 0, 256, 256);
  const groundTexture = new THREE.CanvasTexture(groundCanvas);
  const groundMaterial = new THREE.MeshBasicMaterial({
    map: groundTexture,
    transparent: true,
    depthWrite: false,
    opacity: PALETTES[theme].shadows,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.04;
  scene.add(ground);

  const view = {
    yaw: START_YAW,
    pitch: START_PITCH,
    radius: START_RADIUS,
    targetYaw: START_YAW,
    targetPitch: START_PITCH,
    targetRadius: START_RADIUS,
  };

  const applyCamera = () => {
    const cp = Math.cos(view.pitch);
    camera.position.set(
      TARGET.x + view.radius * cp * Math.sin(view.yaw),
      TARGET.y + view.radius * Math.sin(view.pitch),
      TARGET.z + view.radius * cp * Math.cos(view.yaw),
    );
    camera.lookAt(TARGET);
  };
  applyCamera();

  const resize = () => {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (event: PointerEvent) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
    renderer.domElement.classList.add('is-dragging');
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    view.targetYaw -= dx * 0.007;
    view.targetPitch = clamp(view.targetPitch + dy * 0.007, -0.9, 1.25);
  };
  const onPointerUp = (event: PointerEvent) => {
    dragging = false;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
    renderer.domElement.classList.remove('is-dragging');
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    view.targetRadius = clamp(
      view.targetRadius + event.deltaY * 0.0018,
      MIN_RADIUS,
      MAX_RADIUS,
    );
  };

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointercancel', onPointerUp);
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__flowerScene = {
      camera,
      flower,
      view,
      renderer,
    };
  }

  let frame = 0;
  let lastTime = performance.now();

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    const delta = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    const ease = 1 - Math.exp(-delta * 9);
    view.yaw += (view.targetYaw - view.yaw) * ease;
    view.pitch += (view.targetPitch - view.pitch) * ease;
    view.radius += (view.targetRadius - view.radius) * ease;
    applyCamera();

    if (spin) flower.rotation.y += delta * SPIN_SPEED;
    flower.rotation.z = Math.sin(now * 0.00035) * 0.012;
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(tick);

  const rebuildEnvironment = (next: FlowerTheme) => {
    envTexture.dispose();
    envMap.dispose();
    envTexture = drawEnvironment(envCanvas, next);
    envMap = pmrem.fromEquirectangular(envTexture).texture;
    scene.environment = envMap;
  };

  const applyPalette = (next: FlowerTheme) => {
    const palette = PALETTES[next];
    const outer = materials.outer as THREE.MeshPhysicalMaterial;
    const inner = materials.inner as THREE.MeshPhysicalMaterial;
    const core = materials.core as THREE.MeshPhysicalMaterial;
    const stamen = materials.stamen as THREE.MeshStandardMaterial;
    const stem = materials.stem as THREE.MeshPhysicalMaterial;
    const leaf = materials.leaf as THREE.MeshPhysicalMaterial;

    outer.color.setHex(palette.outer.color);
    outer.attenuationColor.setHex(palette.outer.attenuation);
    inner.color.setHex(palette.inner.color);
    inner.attenuationColor.setHex(palette.inner.attenuation);
    core.color.setHex(palette.core);
    stamen.color.setHex(palette.stamen);
    stamen.emissive.setHex(palette.stamen);
    stem.color.setHex(palette.stem);
    leaf.color.setHex(palette.leaf);

    renderer.toneMappingExposure = palette.exposure;
    haloMaterial.opacity = palette.halo;
    groundMaterial.opacity = palette.shadows;
  };

  return {
    setTheme: (next) => {
      if (next === theme) return;
      theme = next;
      applyPalette(next);
      rebuildEnvironment(next);
    },
    setSpin: (next) => {
      spin = next;
    },
    reset: () => {
      view.targetYaw = START_YAW;
      view.targetPitch = START_PITCH;
      view.targetRadius = START_RADIUS;
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      disposeFlower(flower);
      disposePetalCache();
      scene.remove(flower);
      flower = new THREE.Group();
      Object.values(materials).forEach((material) => material.dispose());
      halo.geometry.dispose();
      haloTexture.dispose();
      haloMaterial.dispose();
      ground.geometry.dispose();
      groundTexture.dispose();
      groundMaterial.dispose();
      envTexture.dispose();
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
};