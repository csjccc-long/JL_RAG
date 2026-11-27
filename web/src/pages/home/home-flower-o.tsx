import { useEffect, useRef } from 'react';
import * as THREE from 'three';

import {
  buildFlower,
  disposeFlower,
  getPetalBump,
  getPetalTexture,
  type FlowerMaterials,
} from '../mark-flower/flower-model';

/* The head-line replaces the "O" of KNOWLEDGE with the product's own bloom.
   It is a second, deliberately tiny render of the /mark-flower model: same
   petals, same palette, no stem — a living letter inside the wordmark. */

const TONES = {
  dark: {
    outer: 0x3053d6,
    outerAtt: 0x102a80,
    inner: 0x7ea8ff,
    innerAtt: 0x2b56b8,
    core: 0x25497a,
    stamen: 0xffe6a6,
    sheen: 0xe4efff,
    exposure: 1.05,
  },
  light: {
    outer: 0xe4eeff,
    outerAtt: 0x9db9e8,
    inner: 0xf8fbff,
    innerAtt: 0xc3d5f2,
    core: 0x24405f,
    stamen: 0xffd877,
    sheen: 0xffffff,
    exposure: 1,
  },
} as const;

const makeMaterials = (theme: 'dark' | 'light'): FlowerMaterials => {
  const tone = TONES[theme];
  return {
    outer: new THREE.MeshPhysicalMaterial({
      color: tone.outer,
      map: getPetalTexture(),
      bumpMap: getPetalBump(),
      bumpScale: 0.014,
      roughness: 0.56,
      transmission: 0.06,
      thickness: 0.7,
      ior: 1.44,
      attenuationColor: new THREE.Color(tone.outerAtt),
      attenuationDistance: 0.5,
      clearcoat: 0.2,
      clearcoatRoughness: 0.5,
      specularIntensity: 0.5,
      sheen: 0.4,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color(tone.sheen),
      iridescence: 0.1,
      iridescenceIOR: 1.25,
      envMapIntensity: 0.95,
      vertexColors: true,
      side: THREE.DoubleSide,
    }),
    inner: new THREE.MeshPhysicalMaterial({
      color: tone.inner,
      map: getPetalTexture(),
      bumpMap: getPetalBump(),
      bumpScale: 0.011,
      roughness: 0.54,
      transmission: 0.05,
      thickness: 0.6,
      ior: 1.44,
      attenuationColor: new THREE.Color(tone.innerAtt),
      attenuationDistance: 0.9,
      clearcoat: 0.18,
      clearcoatRoughness: 0.5,
      specularIntensity: 0.5,
      sheen: 0.38,
      sheenRoughness: 0.55,
      sheenColor: new THREE.Color(0xf4f9ff),
      iridescence: 0.08,
      iridescenceIOR: 1.25,
      envMapIntensity: 0.95,
      vertexColors: true,
      side: THREE.DoubleSide,
    }),
    core: new THREE.MeshPhysicalMaterial({
      color: tone.core,
      metalness: 0.25,
      roughness: 0.45,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
      envMapIntensity: 1,
    }),
    stamen: new THREE.MeshStandardMaterial({
      color: tone.stamen,
      emissive: new THREE.Color(tone.stamen),
      emissiveIntensity: 0.85,
      roughness: 0.4,
    }),
    stem: new THREE.MeshPhysicalMaterial({ color: 0x2f9c86, roughness: 0.42 }),
    leaf: new THREE.MeshPhysicalMaterial({ color: 0x39b094, roughness: 0.42 }),
  };
};

const visibleThroughParents = (object: THREE.Object3D) => {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
};

/** A bloom-only cut of the model: the letter needs no stem or leaves. */
const trimToBloom = (flower: THREE.Group) => {
  flower.children.forEach((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && (mesh.geometry as THREE.BufferGeometry).type === 'TubeGeometry') {
      child.visible = false;
      return;
    }
    if (child instanceof THREE.Group && child.position.y < -0.2) child.visible = false;
  });
};

const drawEnvironment = (canvas: HTMLCanvasElement, theme: 'dark' | 'light') => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width, height } = canvas;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  if (theme === 'light') {
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.5, '#dbe6f6');
    gradient.addColorStop(1, '#7d92b0');
  } else {
    gradient.addColorStop(0, '#4b86ff');
    gradient.addColorStop(0.35, '#182552');
    gradient.addColorStop(1, '#04070f');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(
    width * 0.24,
    height * 0.2,
    0,
    width * 0.24,
    height * 0.2,
    width * 0.3,
  );
  glow.addColorStop(0, theme === 'light' ? 'rgba(255,255,255,0.9)' : 'rgba(220,240,255,0.95)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

export function HomeFlowerO() {
  const hostRef = useRef<HTMLSpanElement>(null);
  // One palette for both themes: the bloom has to stay the same saturated blue
  // the mark uses, otherwise it reads as a washed-out sticker on the cream page.
  const tone = 'dark' as const;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = TONES[tone].exposure;
    renderer.domElement.className = 'home-hero__o-canvas';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envCanvas = document.createElement('canvas');
    envCanvas.width = 256;
    envCanvas.height = 128;
    let envTexture = drawEnvironment(envCanvas, tone);
    let envMap = envTexture ? pmrem.fromEquirectangular(envTexture).texture : null;
    if (envMap) scene.environment = envMap;

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-2.4, 3.2, 2.6);
    const rim = new THREE.DirectionalLight(0x8fbcff, 1.4);
    rim.position.set(2.8, 1.4, -2.8);
    const fill = new THREE.HemisphereLight(0xdfeaff, 0x2b3a5c, 0.7);
    scene.add(key, rim, fill);

    const materials = makeMaterials(tone);
    const flower = buildFlower(materials);
    trimToBloom(flower);

    const box = new THREE.Box3();
    flower.updateMatrixWorld(true);
    flower.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !visibleThroughParents(mesh)) return;
      box.expandByObject(mesh);
    });

    const center = box.isEmpty() ? new THREE.Vector3(0, 0.1, 0) : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? new THREE.Vector3(1.6, 1.6, 1.6) : box.getSize(new THREE.Vector3());
    flower.position.sub(center);

    const pivot = new THREE.Group();
    pivot.add(flower);
    scene.add(pivot);

    const fov = 30;
    const extent = Math.max(size.x, size.y);
    const distance = (extent * 0.5) / Math.tan((fov * Math.PI) / 360) * 0.88;
    // The bloom opens along +Y, so the letter looks straight down its axis.
    const pitch = 1.16;
    const yaw = 0.24;
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 80);
    camera.position.set(
      distance * Math.cos(pitch) * Math.sin(yaw),
      distance * Math.sin(pitch),
      distance * Math.cos(pitch) * Math.cos(yaw),
    );
    camera.lookAt(0, 0, 0);

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

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frame = window.requestAnimationFrame(tick);
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!reduced) {
        pivot.rotation.y += delta * 0.22;
        pivot.rotation.z = Math.sin(now * 0.0004) * 0.05;
      }
      renderer.render(scene, camera);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      pmrem.dispose();
      envMap?.dispose();
      envTexture?.dispose();
      disposeFlower(flower);
      Object.values(materials).forEach((material) => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [tone]);

  return (
    <span className="home-hero__o" ref={hostRef} aria-hidden="true" />
  );
}
