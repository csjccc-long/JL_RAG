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

import { useCallback, useEffect, useRef } from 'react';

import { chime } from '@/lib/sound';

import { createMoonRig } from './moon-rig';

import './orbital-universe.css';

const VERTEX = [
  '#version 300 es',
  'precision highp float;',
  '',
  'in vec3 aPos;',
  'in vec3 aMeta;',
  '',
  'uniform mat3 uRot;',
  'uniform mat4 uProj;',
  'uniform mat4 uView;',
  'uniform vec3 uInk;',
  'uniform vec3 uOffset;',
  'uniform float uRadius;',
  'uniform float uPixel;',
  'uniform float uTime;',
  'uniform float uAlpha;',
  'uniform float uBoost;',
  '',
  'out vec3 vColor;',
  'out float vAlpha;',
  '',
  'void main() {',
  '  vec3 local = aPos * uRadius + uOffset;',
  '  vec4 clip = uProj * uView * vec4(uRot * local, 1.0);',
  '  gl_Position = clip;',
  '',
  '  float depth = max(clip.w, 0.4);',
  '  float size = uPixel * (0.6 + 1.05 * aMeta.x);',
  '  gl_PointSize = clamp(size * (3.0 / depth), 0.8, 4.2);',
  '',
  '  vec3 cool = vec3(0.58, 0.72, 1.0);',
  '  vec3 warm = vec3(1.0, 0.85, 0.63);',
  '  vColor = mix(cool, warm, aMeta.y) * aMeta.z * uInk * uBoost;',
  '  vAlpha = (0.7 + 0.3 * sin(uTime * (0.6 + aMeta.x * 2.8) + aMeta.x * 61.0)) * uAlpha;',
  '}',
].join('\n');

const FRAGMENT = [
  '#version 300 es',
  'precision highp float;',
  '',
  'in vec3 vColor;',
  'in float vAlpha;',
  '',
  'out vec4 outColor;',
  '',
  'void main() {',
  '  vec2 d = gl_PointCoord - 0.5;',
  '  float a = smoothstep(0.25, 0.0, dot(d, d));',
  '  float alpha = a * vAlpha;',
  '  outColor = vec4(vColor * alpha, alpha);',
  '}',
].join('\n');

const LINE_VERTEX = [
  '#version 300 es',
  'precision highp float;',
  '',
  'in vec3 aPos;',
  '',
  'uniform mat3 uRot;',
  'uniform mat4 uProj;',
  'uniform mat4 uView;',
  'uniform vec3 uOffset;',
  'uniform float uScale;',
  '',
  'void main() {',
  '  vec4 clip = uProj * uView * vec4(uRot * (aPos * uScale + uOffset), 1.0);',
  '  gl_Position = clip;',
  '}',
].join('\n');

const LINE_FRAGMENT = [
  '#version 300 es',
  'precision highp float;',
  '',
  'uniform vec3 uInk;',
  'uniform float uAlpha;',
  '',
  'out vec4 outColor;',
  '',
  'void main() {',
  '  outColor = vec4(uInk * uAlpha, uAlpha);',
  '}',
].join('\n');



const TAU = Math.PI * 2;
/** The star at the middle: the module itself. */
const CORE_COUNT = 48000;
/** Far stars, so the module looks like it sits in a universe. */
const FIELD_COUNT = 9000;
/** The overview module is the galaxy itself: a small spiral disc. */
const GALAXY_COUNT = 30000;
const GALAXY_RADIUS = 1;
/** One shared sphere, drawn once per feature. */
const PLANET_COUNT = 2600;
const STAR_RADIUS = 0.5;
const ORBIT_RADIUS = 1.06;
const PLANET_RADIUS = 0.2;
/** The orbit lives in the ring plane, so it needs no tilt of its own. */
const ORBIT_TILT = 0;
/** How much room around a star's centre the framing has to leave: the ball
 *  itself is drawn at radius 1 (the neighbours a little smaller), not at
 *  STAR_RADIUS, so the camera must stand back from the bigger of the two. */
const STAR_CLEARANCE = 1.06;
/** What a join throws off: not a ball bursting in the middle of the link, but
 *  sparks breaking loose from the star the link arrives at and drifting apart. */
const SPRAY_COUNT = 640;
/** How far the burst reaches, in world units, once it has fully opened. */
const SPRAY_SPAN = 1.5;
/** Seconds from the first spark to the last one gone. */
const SPRAY_LIFE = 1.7;
const SPRAY_ALPHA = 0.9;
/** Seconds for the plates of the shell to let go, one after another. */
const SHATTER_SECONDS = 2.9;

export type StarKey = 'overview' | 'memories' | 'reflect' | 'knowledge' | 'governance';

/** The five modules as stars, strung along the Dipper's arc. */
const CONSTELLATION: Record<StarKey, [number, number, number]> = {
  overview: [-5.6, 1.5, 0.6],
  memories: [-2.9, 0.4, -0.6],
  reflect: [-0.6, -0.8, -1.2],
  knowledge: [2.4, -1.1, -0.6],
  governance: [4.9, 0.2, 0.9],
};
/** Middle of the constellation: the camera settles here once the galaxy is gone. */
const HUB: [number, number, number] = [0.95, -0.33, -0.38];

/** Order the link line is drawn in. */
const CONSTELLATION_PATH: StarKey[] = [
  'overview',
  'memories',
  'reflect',
  'knowledge',
  'governance',
];
/** Neighbour stars are drawn smaller than the one we fly to. */
const NEIGHBOUR_RADIUS = 0.92;
/** Where the other stars gather once the camera lands: the same directions,
 *  pulled in close enough to stay in frame, so this module still sits in its
 *  constellation instead of standing alone in the dark. */
const NEIGHBOUR_SETTLE = 2.5;
/* The whole flight, in seconds from the moment the view opens. It is one
   continuous move: the camera pushes into the galaxy, and because the stars
   live inside that galaxy they light up as we come closer, join up, and slide
   past until we settle on this module's own star. */
const FLIGHT_SECONDS = 4.6;
/** How wide the galaxy reads in world units; it has to hold the constellation. */
const GALAXY_SPAN = 3.2;
/** The flight opens this many times the landed distance away, looking at the galaxy. */
const OPEN_DISTANCE = 1.34;
const CLOSE_DISTANCE = 0.8;
/** Wide enough for the whole constellation once the galaxy is gone. */
const WIDE_DISTANCE = 2.15;
/** Whatever it takes to hold the whole constellation, never further than this. */
const WIDE_DISTANCE_MAX = 3.4;
/** The constellation comes up in one breath, after the galaxy has dissolved. */
const STAR_APPEAR = 0.3;
const STAR_FADE = 0.08;
/** Segments are traced between the stars themselves, never to the galaxy. */
const LINK_START = 0.44;
const LINK_STEP = 0.05;
const LINK_GROW = 0.08;
const DISTANCE = 3.9;
/** A hop from one module to the next: pull back, swing across, push in. */
const TRAVEL_SECONDS = 2.6;

/** Where the reader just was, so a hop between two modules starts from the
 *  star they were already sitting on instead of replaying the galaxy intro. */
type ViewMemory = { key: StarKey; from: StarKey | null; at: number };
let lastView: ViewMemory | null = null;

const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

type Cloud = { position: Float32Array; meta: Float32Array; count: number };

const cloud = (count: number, fill: (slot: number, push: (x: number, y: number, z: number, warmth: number, brightness: number) => void, random: () => number) => void): Cloud => {
  const random = createRandom(0x9e3779b9 ^ count);
  const position = new Float32Array(count * 3);
  const meta = new Float32Array(count * 3);
  let index = 0;
  const push = (x: number, y: number, z: number, warmth: number, brightness: number) => {
    const slot = index * 3;
    position[slot] = x;
    position[slot + 1] = y;
    position[slot + 2] = z;
    meta[slot] = random();
    meta[slot + 1] = warmth;
    meta[slot + 2] = brightness;
    index += 1;
  };
  for (let n = 0; n < count; n += 1) fill(n, push, random);
  return { position, meta, count };
};

const gaussOf = (random: () => number) => {
  const u = Math.max(1e-6, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * random());
};

const buildCore = () =>
  cloud(CORE_COUNT, (_slot, push, random) => {
    // Mostly a shell with a little grit inside it, so the ball has an edge.
    const shell = random() < 0.88;
    const depth = shell ? 0.95 + 0.05 * random() : 0.8 * Math.pow(random(), 0.4);
    const radius = STAR_RADIUS * depth;
    const z = random() * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = random() * TAU;
    const y = z * radius;
    // A bare ball: no rings, no band across it, just the sphere itself.
    push(
      Math.cos(phi) * r * radius,
      y,
      Math.sin(phi) * r * radius,
      0.44 + 0.5 * random(),
      (shell ? 1.02 : 0.72) + 0.3 * random() + 0.22 * (1 - depth),
    );
  });

/**
 * One splash, built in unit space around the origin: sparks thrown off a star,
 * each joined to its two nearest neighbours, so it reads as a little
 * constellation breaking loose from that star rather than a cloud of dust.
 */
const buildSpray = () => {
  const random = createRandom(0x51ed270b);
  const points: number[][] = [];
  for (let n = 0; n < SPRAY_COUNT; n += 1) {
    // Even over a sphere, then pushed out: a shell that thickens as it flies,
    // so the splash opens on every side of the star it left.
    const up = random() * 2 - 1;
    const phi = random() * TAU;
    const ring = Math.sqrt(Math.max(0, 1 - up * up));
    // A full volume, not a shell: a thin skin of points would read as a ring
    // around the star, which is exactly what this must not look like.
    const shell = 0.42 + 1.25 * Math.pow(random(), 0.7);
    points.push([
      Math.cos(phi) * ring * shell,
      up * shell,
      Math.sin(phi) * ring * shell,
    ]);
  }
  const joins: number[] = [];
  const seen = new Set<string>();
  points.forEach((point, index) => {
    const near = points
      .map((other, slot) => ({
        slot,
        gap:
          (point[0] - other[0]) ** 2 +
          (point[1] - other[1]) ** 2 +
          (point[2] - other[2]) ** 2,
      }))
      .filter((item) => item.slot !== index)
      .sort((a, b) => a.gap - b.gap)
      .slice(0, 2);
    near.forEach((item) => {
      // Never twice, and never a line long enough to read as a stray scratch.
      if (item.gap > 0.18 * 0.18) return;
      const low = Math.min(index, item.slot);
      const high = Math.max(index, item.slot);
      const key = low + ':' + high;
      if (seen.has(key)) return;
      seen.add(key);
      joins.push(
        points[low][0], points[low][1], points[low][2],
        points[high][0], points[high][1], points[high][2],
      );
    });
  });

  const position = new Float32Array(points.length * 3);
  const meta = new Float32Array(points.length * 3);
  points.forEach((point, index) => {
    const slot = index * 3;
    position[slot] = point[0];
    position[slot + 1] = point[1];
    position[slot + 2] = point[2];
    meta[slot] = random();
    // Dead centre of the cool/warm blend: the spray is white, never tinted.
    meta[slot + 1] = 0.5;
    meta[slot + 2] = 0.95 + 0.45 * random();
  });
  return {
    cloud: { position, meta, count: points.length },
    joins: new Float32Array(joins),
    joinCount: joins.length / 3,
  };
};

const buildField = () =>
  cloud(FIELD_COUNT, (_slot, push, random) => {
    const radius = 10 + 16 * Math.pow(random(), 0.7);
    const z = random() * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = random() * TAU;
    push(
      Math.cos(phi) * r * radius,
      z * radius,
      Math.sin(phi) * r * radius,
      0.16 + 0.5 * random(),
      0.14 + 0.3 * random(),
    );
  });

const buildGalaxy = () =>
  cloud(GALAXY_COUNT, (_slot, push, random) => {
    // A bulge in the middle and two arms wound out of it.
    if (random() < 0.2) {
      const z = random() * 2 - 1;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const phi = random() * TAU;
      const radius = GALAXY_RADIUS * 0.32 * Math.pow(random(), 0.55);
      push(
        Math.cos(phi) * r * radius,
        z * radius * 0.55,
        Math.sin(phi) * r * radius,
        0.66 + 0.3 * random(),
        1.35 + 0.5 * random(),
      );
      return;
    }
    const radius =
      GALAXY_RADIUS * (0.1 + 0.9 * Math.pow(random(), 0.62));
    const reach = radius / GALAXY_RADIUS;
    const arm = random() < 0.5 ? 0 : Math.PI;
    const angle = arm + reach * 2.9 + gaussOf(random) * (0.06 + 0.2 * reach);
    push(
      Math.cos(angle) * radius,
      gaussOf(random) * (0.008 + 0.022 * (1 - reach)),
      Math.sin(angle) * radius,
      0.1 + 0.5 * (1 - reach),
      0.5 + 0.85 * Math.pow(1 - reach, 1.5),
    );
  });

const buildPlanet = () =>
  cloud(PLANET_COUNT, (_slot, push, random) => {
    const z = random() * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = random() * TAU;
    const shell = 0.72 + 0.28 * Math.pow(random(), 0.5);
    push(
      Math.cos(phi) * r * shell,
      z * shell,
      Math.sin(phi) * r * shell,
      0.08 + 0.55 * random(),
      0.92 + 0.5 * random(),
    );
  });




const perspective = (fov: number, aspect: number, near: number, far: number) => {
  const f = 1 / Math.tan(fov / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
};

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
};

const readInk = (canvas: HTMLCanvasElement) => {
  const value = getComputedStyle(canvas).color || '';
  const parts = value.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return [1, 1, 1] as const;
  return [
    Number(parts[0]) / 255,
    Number(parts[1]) / 255,
    Number(parts[2]) / 255,
  ] as const;
};

export type OrbitPlanet = { key: string; label: string };

type OrbitalUniverseProps = {
  /** Which module this star is, so the flight starts from its place in the constellation. */
  starKey: StarKey;
  planets: OrbitPlanet[];
  /** Planet whose details are open right now; drawn brighter. */
  activeKey?: string | null;
  /** Drawn over the star when the module name is worth showing there. */
  centerLabel?: string;
  className?: string;
  onHover?: (key: string) => void;
  onSelect?: (key: string) => void;
  /** A click on a neighbouring star: hand the reader over to that module. */
  onNavigate?: (key: StarKey) => void;
};

/**
 * One module of the memory console as a small universe: the module itself is
 * the star at the centre, every feature is a planet on the ring around it, and
 * the planets can be turned by dragging.
 */
export function OrbitalUniverse({
  starKey,
  planets,
  activeKey = null,
  centerLabel,
  className = '',
  onHover,
  onSelect,
  onNavigate,
}: OrbitalUniverseProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const handlers = useRef({ onHover, onSelect, onNavigate });
  handlers.current = { onHover, onSelect, onNavigate };
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  const handlePointerEnter = useCallback((key: string) => {
    handlers.current.onHover?.(key);
  }, []);

  const handleClick = useCallback((key: string) => {
    handlers.current.onSelect?.(key);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'orbital-universe__canvas';
    container.prepend(canvas);
    // The light theme's moons get their own canvas: three.js owns that context,
    // so the rigid-body solver can push plates around without touching the star
    // field's GL state. It sits above the star canvas and lets pointers through.
    const rigCanvas = document.createElement('canvas');
    rigCanvas.className = 'orbital-universe__rig';
    container.appendChild(rigCanvas);
    const rig = createMoonRig(rigCanvas);
    const fail = () => {
      canvas.remove();
      container.dataset.fallback = 'on';
    };

    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        depth: true,
      });
    } catch {
      gl = null;
    }
    if (!gl || gl.isContextLost()) {
      fail();
      return;
    }

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) {
      fail();
      return;
    }
    const program = gl.createProgram();
    if (!program) {
      fail();
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      fail();
      return;
    }

    gl.useProgram(program);
    const local = (name: string) => gl?.getUniformLocation(program, name) ?? null;
    const attrs = {
      pos: gl.getAttribLocation(program, 'aPos'),
      meta: gl.getAttribLocation(program, 'aMeta'),
    };
    const uniforms = {
      rot: local('uRot'),
      proj: local('uProj'),
      view: local('uView'),
      ink: local('uInk'),
      offset: local('uOffset'),
      radius: local('uRadius'),
      pixel: local('uPixel'),
      time: local('uTime'),
      alpha: local('uAlpha'),
      boost: local('uBoost'),
    };

    // A second, tiny program: the link line between the stars.
    const lineVertex = compile(gl, gl.VERTEX_SHADER, LINE_VERTEX);
    const lineFragment = compile(gl, gl.FRAGMENT_SHADER, LINE_FRAGMENT);
    const lineProgram = gl.createProgram();
    if (!lineVertex || !lineFragment || !lineProgram) {
      fail();
      return;
    }
    gl.attachShader(lineProgram, lineVertex);
    gl.attachShader(lineProgram, lineFragment);
    gl.linkProgram(lineProgram);
    if (!gl.getProgramParameter(lineProgram, gl.LINK_STATUS)) {
      fail();
      return;
    }
    const lineUniforms = {
      rot: gl.getUniformLocation(lineProgram, 'uRot'),
      proj: gl.getUniformLocation(lineProgram, 'uProj'),
      view: gl.getUniformLocation(lineProgram, 'uView'),
      offset: gl.getUniformLocation(lineProgram, 'uOffset'),
      ink: gl.getUniformLocation(lineProgram, 'uInk'),
      alpha: gl.getUniformLocation(lineProgram, 'uAlpha'),
      scale: gl.getUniformLocation(lineProgram, 'uScale'),
    };
    const lineAttrs = { pos: gl.getAttribLocation(lineProgram, 'aPos') };



    // The lunar map the card puts on its sphere: an equirectangular photograph,
    // sampled on the ball and, in patches, on every stone of the belt.
    const mapTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, mapTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([148, 144, 138, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const mapImage = new Image();
    mapImage.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, mapTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mapImage);
      gl.generateMipmap(gl.TEXTURE_2D);
    };
    mapImage.src = '/moon-map.jpg';

    // The link line is rebuilt every frame, because each segment grows from one
    // star to the next instead of appearing all at once. The galaxy is the
    // universe those stars sit in, so it is never joined to them.
    const LINK_COUNT = CONSTELLATION_PATH.length - 2;
    const linkData = new Float32Array(LINK_COUNT * 6);
    const linkBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, linkBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, linkData, gl.DYNAMIC_DRAW);

    const upload = (data: Cloud) => {
      const position = gl.createBuffer();
      const meta = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, position);
      gl.bufferData(gl.ARRAY_BUFFER, data.position, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, meta);
      gl.bufferData(gl.ARRAY_BUFFER, data.meta, gl.STATIC_DRAW);
      return { position, meta, count: data.count };
    };

    const galaxy = upload(buildGalaxy());
    const core = upload(buildCore());
    const field = upload(buildField());
    const planet = upload(buildPlanet());
    // One plume, run out along every link as that link arrives, at whatever size
    // it has drifted to by then.
    const spray = buildSpray();
    const sprayPoints = upload(spray.cloud);
    const sprayJoins = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sprayJoins);
    gl.bufferData(gl.ARRAY_BUFFER, spray.joins, gl.STATIC_DRAW);


    const projection = new Float32Array(16);
    const viewMatrix = new Float32Array(16);
    const rotation = new Float32Array(9);
    const drift = new Float32Array(9);

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let focal = 1;
    let width = 1;
    let height = 1;
    let yaw = -0.35;
    let pitch = 0.36;
    let zoom = 1;
    let phase = 0;
    // Seconds since the view opened; the whole flight is scripted off it.
    let flightTime = reduced ? 100 : 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    let moved = false;
    let velocity = 0;
    let lastInteract = 0;
    let raf = 0;
    let last = 0;
    let time = 0;
    let visible = true;
    let lost = false;

    const applySize = () => {
      const rect = container.getBoundingClientRect();
      const ratio = Math.max(0.5, Math.min(window.devicePixelRatio || 1, 2));
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      rigCanvas.style.width = width + 'px';
      rigCanvas.style.height = height + 'px';
      rig?.resize(width, height, ratio);
      projection.set(perspective(0.82, width / height, 0.1, 60));
      focal = 1 / Math.tan(0.82 / 2);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const smoothstep = (edge0: number, edge1: number, value: number) => {
      const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
      return t * t * (3 - 2 * t);
    };

    const focus = CONSTELLATION[starKey] ?? CONSTELLATION.memories;
    const galaxyNode = CONSTELLATION.overview;
    const neighbours = (Object.keys(CONSTELLATION) as StarKey[])
      .filter((key) => key !== starKey && key !== 'overview')
      .map((key) => {
        const node = CONSTELLATION[key];
        return {
          key,
          offset: [node[0] - focus[0], node[1] - focus[1], node[2] - focus[2]],
        };
      });
    // Where this view starts from. A hop between two modules is a journey of
    // its own — back out, across, in — and never the galaxy intro again.
    const openedAt = Date.now();
    const remount =
      lastView !== null &&
      lastView.key === starKey &&
      openedAt - lastView.at < 2000;
    const fromKey = remount
      ? lastView!.from
      : lastView && lastView.key !== starKey
        ? lastView.key
        : null;
    lastView = { key: starKey, from: fromKey, at: openedAt };
    const travels =
      Boolean(fromKey) && fromKey !== 'overview' && starKey !== 'overview';
    const fromNode = travels && fromKey ? CONSTELLATION[fromKey] : null;

    // A join is a sound as much as a sight: a bell as each link lands,
    // climbing, and one deeper note when the camera settles on the star. The
    // bell itself lives in lib/sound, shared with the chat's message sound.
    const sounded = new Set<string>();

    // Where the neighbour stars are on screen this frame, so a click can carry
    // the reader to that module instead of only turning the view.
    const targets: { key: StarKey; x: number; y: number; r: number }[] = [];

    /** Where we are in the push-in, 0 at the galaxy and 1 on the landed star. */
    const progressOf = (time: number) =>
      Math.min(1, Math.max(0, time / FLIGHT_SECONDS));
    /** The whole constellation lights at once, once the galaxy has dissolved. */
    const revealOf = () =>
      smoothstep(STAR_APPEAR, STAR_APPEAR + STAR_FADE, progressOf(flightTime));
    /** A segment is traced once the stars it joins are lit. */
    const linkOf = (index: number) =>
      smoothstep(
        LINK_START + index * LINK_STEP,
        LINK_START + index * LINK_STEP + LINK_GROW,
        progressOf(flightTime),
      );
    /** Every joined segment leaves its two stars a little brighter. */
    const glowOf = (key: StarKey) => {
      const slot = CONSTELLATION_PATH.indexOf(key);
      let glow = 0;
      // Slot 0 is the galaxy, which carries no links of its own.
      if (slot > 1) glow += linkOf(slot - 2);
      if (slot >= 1 && slot < LINK_COUNT + 1) glow += linkOf(slot - 1);
      return Math.min(1.4, glow * 0.7);
    };

    const writeRotation = (y: number, p: number, out: Float32Array) => {
      const cy = Math.cos(y);
      const sy = Math.sin(y);
      const cp = Math.cos(p);
      const sp = Math.sin(p);
      out[0] = cy;
      out[1] = 0;
      out[2] = -sy;
      out[3] = sy * sp;
      out[4] = cp;
      out[5] = cy * sp;
      out[6] = sy * cp;
      out[7] = -sp;
      out[8] = cy * cp;
    };

    const orbitPoint = (index: number, total: number, out: number[]) => {
      const angle = phase * 0.55 + (index / Math.max(1, total)) * TAU;
      const ox = Math.cos(angle) * ORBIT_RADIUS;
      const oz = Math.sin(angle) * ORBIT_RADIUS;
      const oy = 0.05 + Math.sin(angle * 2 + index) * 0.012;
      const ct = Math.cos(ORBIT_TILT);
      const st = Math.sin(ORBIT_TILT);
      out[0] = ox;
      out[1] = oy * ct - oz * st;
      out[2] = oy * st + oz * ct;
      return out;
    };

    const placeNode = (
      element: HTMLElement,
      p: number[],
      distance: number,
      fade = 1,
    ) => {
      const x = rotation[0] * p[0] + rotation[3] * p[1] + rotation[6] * p[2];
      const y = rotation[1] * p[0] + rotation[4] * p[1] + rotation[7] * p[2];
      const z = rotation[2] * p[0] + rotation[5] * p[1] + rotation[8] * p[2];
      const w = distance - z;
      if (w <= 0.35) {
        element.style.opacity = '0';
        element.style.pointerEvents = 'none';
        return;
      }
      const sx = ((x * focal) / (width / height) / w) * 0.5 + 0.5;
      const sy = (y * focal / w) * 0.5 + 0.5;
      const left = sx * width;
      const top = (1 - sy) * height;
      element.style.transform =
        'translate3d(' + left.toFixed(1) + 'px,' + top.toFixed(1) + 'px,0) translate(-50%,-50%)';
      const near = Math.min(1, Math.max(0.8, 2.9 / w));
      element.style.opacity = (near * fade).toFixed(2);
      element.style.pointerEvents = fade > 0.6 ? 'auto' : 'none';
    };

    /** The same projection the labels use, for anything that must be hit-tested. */
    const project = (
      p: number[],
      distance: number,
    ): [number, number, number, number] => {
      const x = rotation[0] * p[0] + rotation[3] * p[1] + rotation[6] * p[2];
      const y = rotation[1] * p[0] + rotation[4] * p[1] + rotation[7] * p[2];
      const z = rotation[2] * p[0] + rotation[5] * p[1] + rotation[8] * p[2];
      const w = distance - z;
      if (w <= 0.35) return [-1, -1, 0, 0];
      const sx = ((x * focal) / (width / height) / w) * 0.5 + 0.5;
      const sy = (y * focal / w) * 0.5 + 0.5;
      return [
        sx * width,
        (1 - sy) * height,
        1,
        ((STAR_CLEARANCE * focal) / w) * 0.5 * height,
      ];
    };

    /** The constellation is only worth watching if all of it is in frame, so
        the camera backs off far enough for the widest star this tab shows,
        measured in camera space so turning the view never crops anyone. */
    const frameDistance = (shift: number[]) => {
      // The data drawer always keeps a strip of the right edge, so the stars have
      // to fit in what is left of the frame rather than in all of it.
      const rail = width >= 768 ? 96 : 0;
      const aspect = Math.max(0.45, (width - rail) / height);
      const margin = 0.84;
      let need = 0;
      const stars = [[0, 0, 0], ...neighbours.map((item) => item.offset)];
      stars.forEach((star) => {
        const dx = star[0] - shift[0];
        const dy = star[1] - shift[1];
        const dz = star[2] - shift[2];
        const x = rotation[0] * dx + rotation[3] * dy + rotation[6] * dz;
        const y = rotation[1] * dx + rotation[4] * dy + rotation[7] * dz;
        const z = rotation[2] * dx + rotation[5] * dy + rotation[8] * dz;
        const across = ((Math.abs(x) + STAR_CLEARANCE) * focal) / (aspect * margin);
        const down = ((Math.abs(y) + STAR_CLEARANCE) * focal) / margin;
        need = Math.max(need, z + Math.max(across, down));
      });
      // Whatever it takes, but never so far that the stars stop reading.
      return Math.min(
        DISTANCE * WIDE_DISTANCE_MAX,
        Math.max(DISTANCE * WIDE_DISTANCE, need),
      );
    };

    const render = () => {
      if (!gl) return;
      const dark = document.documentElement.classList.contains('dark');
      const ink = readInk(canvas);
      // Four beats: the galaxy swells and dissolves where it stands, the whole
      // constellation comes up, the links are drawn between the stars, and only
      // then does the camera close on this module's star.
      // On paper the sky is a set of solid worlds, not a galaxy to fly out of,
      // so arriving from the overview is instant: the view opens already
      // standing on the star. A hop between two modules still gets its own move.
      const instant = !dark && !travels;
      const progress = instant ? 1 : progressOf(flightTime);
      // A hop between two modules is its own move: back off until the whole
      // constellation is in frame, swing across to the new star, close in.
      const travel = travels
        ? Math.min(1, Math.max(0, flightTime / TRAVEL_SECONDS))
        : instant
          ? 1
          : 0;
      const retreat = smoothstep(0.02, 0.38, travel);
      const travelPan = smoothstep(0.3, 0.7, travel);
      const arrival = smoothstep(0.68, 1, travel);
      // The camera falls into the disc, opens back up on the whole
      // constellation, and only then closes on this star.
      const fall = travels ? 0 : smoothstep(0.02, 0.3, progress);
      const widen = travels ? 0 : smoothstep(0.3, 0.46, progress);
      const dive = travels ? 0 : smoothstep(0.72, 1, progress);
      const landed = travels ? arrival : smoothstep(0.86, 1, progress);

      writeRotation(yaw, pitch, rotation);
      writeRotation(yaw * 0.32, pitch * 0.32, drift);

      // The camera pans from the galaxy to the middle of the constellation, and
      // only after the links are finished does it swing onto the target star.
      const shift = [0, 0, 0];
      for (let axis = 0; axis < 3; axis += 1) {
        if (fromNode) {
          // The camera is still standing on the star we came from, and swings
          // across to this one while it is held wide.
          shift[axis] = (fromNode[axis] - focus[axis]) * (1 - travelPan);
          continue;
        }
        const hubX = galaxyNode[axis] + (HUB[axis] - galaxyNode[axis]) * widen;
        const cam = hubX + (focus[axis] - hubX) * dive;
        shift[axis] = cam - focus[axis];
      }

      // Where each star of the constellation sits this frame: at its own place
      // in the sky while we fly, and gathered in around this star once we land,
      // so the module keeps its neighbours (and its links) after the flight.
      // On a narrow screen the neighbours gather tighter, or the outermost of
      // them ends up clipped by the edge once the flight lands.
      const settleRadius =
        NEIGHBOUR_SETTLE * (0.58 + 0.42 * Math.min(1, width / height));
      const settle = (offset: number[]) => {
        if (landed <= 0.001) return offset;
        const length = Math.hypot(offset[0], offset[1], offset[2]) || 1;
        const pull = (settleRadius / length - 1) * landed;
        return [offset[0] * (1 + pull), offset[1] * (1 + pull), offset[2] * (1 + pull)];
      };
      const place: Record<string, number[]> = {};
      CONSTELLATION_PATH.forEach((key) => {
        const node = CONSTELLATION[key];
        place[key] = settle([
          node[0] - focus[0],
          node[1] - focus[1],
          node[2] - focus[2],
        ]);
      });

      const near = DISTANCE * CLOSE_DISTANCE;
      // Standing back far enough that every star of the constellation is on
      // screen while the links are traced between them.
      const wide = frameDistance(shift);
      let distance = DISTANCE * OPEN_DISTANCE;
      if (travels) {
        // Out of the old star, wide over the constellation, into the new one.
        distance = DISTANCE + (wide - DISTANCE) * retreat;
        distance += (DISTANCE - distance) * arrival;
      } else {
        distance += (near - distance) * fall;
        distance += (wide - distance) * widen;
        distance += (DISTANCE - distance) * dive;
      }
      distance *= zoom;

      viewMatrix.fill(0);
      viewMatrix[0] = 1;
      viewMatrix[5] = 1;
      viewMatrix[10] = 1;
      viewMatrix[15] = 1;
      viewMatrix[14] = -distance;

      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // Depth keeps the near half of each ball in front of the far half.
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, dark ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);

      const soften = dark ? 0 : 0.58;
      gl.uniformMatrix4fv(uniforms.proj, false, projection);
      gl.uniformMatrix4fv(uniforms.view, false, viewMatrix);
      gl.uniform3f(
        uniforms.ink,
        ink[0] + (0.52 - ink[0]) * soften,
        ink[1] + (0.53 - ink[1]) * soften,
        ink[2] + (0.58 - ink[2]) * soften,
      );
      const pixel =
        (canvas.height / 760) *
        Math.min(2.2, Math.max(1, window.devicePixelRatio || 1));
      gl.uniform1f(uniforms.pixel, pixel);
      gl.uniform1f(uniforms.time, reduced ? 0 : time);
      gl.uniform1f(uniforms.alpha, dark ? 1 : 0.86);

      const draw = (
        buffer: { position: WebGLBuffer | null; meta: WebGLBuffer | null; count: number },
        matrix: Float32Array,
        offset: number[],
        radius: number,
        boost: number,
        alpha = 1,
        // Sparks need a fatter pixel than the dust they are drawn with, or at
        // this distance they are sub-pixel and only the joins show.
        grain = 1,
      ) => {
        gl.uniformMatrix3fv(uniforms.rot, false, matrix);
        gl.uniform3f(
          uniforms.offset,
          offset[0] - shift[0],
          offset[1] - shift[1],
          offset[2] - shift[2],
        );
        gl.uniform1f(uniforms.radius, radius);
        gl.uniform1f(uniforms.boost, boost);
        if (grain !== 1) gl.uniform1f(uniforms.pixel, pixel * grain);
        gl.uniform1f(uniforms.alpha, (dark ? 1 : 0.86) * alpha);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer.position);
        gl.enableVertexAttribArray(attrs.pos);
        gl.vertexAttribPointer(attrs.pos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer.meta);
        gl.enableVertexAttribArray(attrs.meta);
        gl.vertexAttribPointer(attrs.meta, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, buffer.count);
        // Back to the shared grain, so the next cloud is drawn as usual.
        if (grain !== 1) gl.uniform1f(uniforms.pixel, pixel);
      };

      // The same galaxy that sits on the overview tab, nothing scaled or rebuilt:
      // the camera simply falls into it, so it magnifies in place and dissolves.
      const galaxyFade = travels ? 0 : 1 - smoothstep(0.06, 0.3, progress);

      const zero = [0, 0, 0];
      // The far stars barely move, which is what makes turning the view feel
      // like standing still while the module turns.
      draw(field, drift, zero, 1, 1);
      // Drawing it at the camera's own offset pins it to the centre, so the disc
      // only ever grows and dims while the stars come up around it.
      draw(galaxy, rotation, shift, GALAXY_SPAN, 1.25, galaxyFade);
      // The neighbours are the same stars as the one we are going to, not
      // markers: every one of them comes up as a full sphere, and stays on as a
      // smaller, dimmer one once we land, so the module is seen sitting in its
      // constellation rather than alone.
      // A hop already has the constellation lit, so nothing fades up again.
      const reveal = travels ? 1 : revealOf();
      targets.length = 0;

      // Every star in the light theme is a moon, and every one of them comes
      // apart as the camera settles: the sweep is timed off the landing, so a
      // ball only breaks open while the reader is looking straight at it.
      const shatterFrom = travels ? TRAVEL_SECONDS * 0.72 : FLIGHT_SECONDS * 0.8;
      const settleAt = (delay: number) =>
        Math.min(
          1,
          Math.max(0, (flightTime - shatterFrom - delay) / SHATTER_SECONDS),
        );
      const shatter = settleAt(0);
      type Body = {
        offset: number[];
        alpha: number;
        progress: number;
        // Neighbours are drawn smaller: they are background, not the subject.
        scale: number;
        /** The operations of the module, in moon radii from its centre. */
        marks?: number[][];
      };
      const bodies: Body[] = [];
      const homeNode = place[starKey];
      neighbours.forEach((item, index) => {
        const pulse = 0.9 + 0.1 * Math.sin(phase * 1.3 + index * 2.1);
        if (reveal <= 0.001) return;
        // The brightening belongs to the tracing, so it lets go as we land.
        const glow = travels ? 0 : glowOf(item.key) * (1 - landed);
        const radius = NEIGHBOUR_RADIUS * (1 - 0.74 * landed) * (1 + 0.12 * glow);
        const alpha =
          reveal * (0.72 + 0.28 * Math.min(1, glow)) * (1 - 0.62 * landed) * pulse;
        const spot = project(
          [
            place[item.key][0] - shift[0],
            place[item.key][1] - shift[1],
            place[item.key][2] - shift[2],
          ],
          distance,
        );
        if (dark) {
          // Only the ball itself: no ring, nothing circling it.
          draw(core, rotation, place[item.key], radius, 1 + 2.2 * glow, alpha);
          // Once the camera has settled the other stars step back: a soft,
          // half-there ghost rather than a sharp ball in the way of this one.
          if (landed > 0.02) {
            draw(
              core,
              rotation,
              place[item.key],
              radius * (1 + 0.85 * landed),
              1 + 0.4 * glow,
              alpha * 0.42,
            );
          }
        } else if (spot[2] > 0) {
          // They sit further off than the star the reader is on, so they stay
          // quieter: rubble in the background, never the subject.
          const far = alpha * (0.62 - 0.26 * landed);
          bodies.push({
            offset: [
              place[item.key][0] - shift[0],
              place[item.key][1] - shift[1],
              place[item.key][2] - shift[2],
            ],
            alpha: far,
            // Halfway is the look: a crust breaking up, not one exploded.
            progress: 0.5 * settleAt(0.22 * (index + 1)),
            scale: 0.62,
          });
        }
        if (spot[2] > 0 && reveal > 0.5) {
          targets.push({
            key: item.key,
            x: spot[0],
            y: spot[1],
            r: Math.max(18, spot[3]),
          });
        }
      });
      if (import.meta.env.DEV) {
        // Development only: lets the visual checks aim at a star by name
        // instead of guessing where one landed on screen.
        (window as unknown as { __orbitalTargets?: unknown }).__orbitalTargets =
          targets;
      }
      const home = reveal;
      const homeGlow = travels ? 0 : glowOf(starKey) * (1 - landed);
      if (dark) {
        draw(core, rotation, zero, 1, 1 + 2.2 * homeGlow, home);
      } else {
        // The star the reader is on: the one moon in the frame that is whole,
        // and the only one whose ring is allowed to be obvious.
        const spot = project([-shift[0], -shift[1], -shift[2]], distance);
        if (spot[2] > 0 && home > 0.001) {
          bodies.push({
            offset: [-shift[0], -shift[1], -shift[2]],
            alpha: home,
            progress: 0.55 * shatter,
            scale: 1,
          });
        }
      }

      const active = activeKeyRef.current;
      const point: number[] = [0, 0, 0];
      // Where the module's operations sit, in moon radii from the star: the rig
      // parks one stone of the belt under each label.
      const marks: number[][] = [];
      planets.forEach((item, index) => {
        orbitPoint(index, planets.length, point);
        // On paper the moon is solid, so its belt has to stand clear of the
        // disc: the same orbit, opened out, keeps every stone and its label off
        // the face of the moon.
        if (!dark) {
          point[0] *= 1.55;
          point[1] *= 1.55;
          point[2] *= 1.55;
        }
        const isActive = item.key === active;
        const radius =
          PLANET_RADIUS * (1 + 0.06 * Math.sin(phase * 1.8 + index * 1.7));
        if (dark) {
          draw(planet, rotation, point, radius, isActive ? 1.9 : 1, landed);
        } else if (landed > 0.02) {
          marks.push([
            (point[0] - homeNode[0]) / STAR_RADIUS,
            (point[1] - homeNode[1]) / STAR_RADIUS,
            (point[2] - homeNode[2]) / STAR_RADIUS,
          ]);
        }
        const node = nodeRefs.current[index];
        if (node) {
          node.dataset.active = isActive ? 'on' : 'off';
          placeNode(
            node,
            [point[0] - shift[0], point[1] - shift[1], point[2] - shift[2]],
            distance,
            landed,
          );
        }
      });

      if (!dark) {
        const homeBody = bodies.find((item) => item.scale === 1);
        if (homeBody) homeBody.marks = marks;
      }

      // The link line: each segment grows out of the star it starts from, in
      // order, so the constellation is traced rather than dropped in, and the
      // lines stay on once we land, holding the module in its constellation.
      const linksGone = travels ? 0 : smoothstep(0.74, 0.9, progress);
      const linkAlpha = 0.55 - 0.37 * linksGone;
      let drawn = 0;
      for (let index = 0; index < LINK_COUNT; index += 1) {
        // A hop starts with the constellation already joined up.
        const grow = travels ? 1 : linkOf(index);
        if (grow <= 0) break;
        const from = place[CONSTELLATION_PATH[index + 1]];
        const to = place[CONSTELLATION_PATH[index + 2]];
        const at = drawn * 6;
        linkData[at] = from[0];
        linkData[at + 1] = from[1];
        linkData[at + 2] = from[2];
        linkData[at + 3] = from[0] + (to[0] - from[0]) * grow;
        linkData[at + 4] = from[1] + (to[1] - from[1]) * grow;
        linkData[at + 5] = from[2] + (to[2] - from[2]) * grow;
        drawn += 1;
      }
      gl.useProgram(lineProgram);
      gl.uniformMatrix3fv(lineUniforms.rot, false, rotation);
      gl.uniformMatrix4fv(lineUniforms.proj, false, projection);
      gl.uniformMatrix4fv(lineUniforms.view, false, viewMatrix);
      gl.uniform3f(lineUniforms.offset, -shift[0], -shift[1], -shift[2]);
      gl.uniform3f(
        lineUniforms.ink,
        ink[0] + (0.52 - ink[0]) * soften,
        ink[1] + (0.53 - ink[1]) * soften,
        ink[2] + (0.58 - ink[2]) * soften,
      );
      gl.uniform1f(lineUniforms.scale, 1);
      // On paper the constellation is joined by the moons themselves, not by
      // a line: the ink theme drops the link entirely.
      if (drawn > 0 && dark) {
        gl.bindBuffer(gl.ARRAY_BUFFER, linkBuffer);
        gl.enableVertexAttribArray(lineAttrs.pos);
        gl.vertexAttribPointer(lineAttrs.pos, 3, gl.FLOAT, false, 0, 0);
        for (let index = 0; index < drawn; index += 1) {
          // The first segment reaches back to the galaxy, which has dissolved by
          // the time we land; the rest are what keep the constellation together.
          const toGalaxy =
            CONSTELLATION_PATH[index + 1] === 'overview' ? 1 - landed : 0;
          gl.uniform1f(lineUniforms.alpha, linkAlpha * (1 - toGalaxy));
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, linkData, index * 6, 6);
          gl.drawArrays(gl.LINES, 0, 2);
        }
      }

      // The join throws sparks: the moment a segment reaches its star, a burst
      // of white dust breaks loose from that star, opens outward and drifts
      // apart, its little web of joins letting go first. It belongs to the star
      // the link arrives at — never a ball on the middle of the link.
      const sprayFade = travels
        ? 1 - smoothstep(0.9, 1, travel)
        : 1 - smoothstep(0.86, 0.98, progress);
      // The star's own splash keeps going after the camera has landed, so this
      // gate outlives the flight rather than following its fade.
      const splashing = travels
        ? flightTime < TRAVEL_SECONDS + SPRAY_LIFE
        : flightTime < FLIGHT_SECONDS + SPRAY_LIFE;
      if (splashing) {
        const plumes: {
          at: number[];
          size: number;
          alpha: number;
          web: number;
        }[] = [];
        /** One splash on one star: it opens out and drifts apart with age. */
        const splash = (at: number[], age: number, fade = sprayFade) => {
          if (age <= 0 || age > SPRAY_LIFE) return;
          const loose = Math.pow(Math.min(1, age / SPRAY_LIFE), 0.62);
          const alpha =
            SPRAY_ALPHA *
            smoothstep(0, 0.18, age) *
            (1 - smoothstep(SPRAY_LIFE * 0.34, SPRAY_LIFE, age)) *
            fade;
          if (alpha <= 0.01) return;
          plumes.push({
            at,
            // It starts on the surface and keeps opening out as it goes.
            size: SPRAY_SPAN * (0.3 + 0.62 * loose),
            alpha,
            // The web lets go first, so what is left is dust drifting apart.
            web: alpha * 0.55 * (1 - smoothstep(0.22, 0.9, loose)),
          });
        };
        if (travels) {
          // Landing on the new star is the one join left to celebrate.
          const settles = TRAVEL_SECONDS * 0.72;
          // Not tied to the flight fade: the star keeps bursting into dust
          // after the camera has come to rest on it.
          splash([0, 0, 0], flightTime - settles, 1);
          if (flightTime >= settles && !sounded.has('landing')) {
            sounded.add('landing');
            chime(783.99, 0.055);
          }
        } else {
          for (let index = 0; index < LINK_COUNT; index += 1) {
            const arrives =
              (LINK_START + index * LINK_STEP + LINK_GROW) * FLIGHT_SECONDS;
            // Thrown off the star the line arrives at, never mid-link.
            splash(
              place[CONSTELLATION_PATH[index + 2]].slice(),
              flightTime - arrives,
            );
            if (flightTime >= arrives && !sounded.has('link' + index)) {
              sounded.add('link' + index);
              chime(1318.51 * Math.pow(1.1225, index), 0.05);
            }
          }
          // The star this module lives on is the first one met, so it gets the
          // same splash as the others when the camera settles on it.
          const settles = FLIGHT_SECONDS * 0.8;
          splash([0, 0, 0], flightTime - settles, 1);
          if (flightTime >= settles && !sounded.has('landing')) {
            sounded.add('landing');
            chime(783.99, 0.055);
          }
        }
        // On paper the moon's own shatter is the burst; the star dust would only
        // sit on top of it as a web of scratches.
        if (dark && plumes.length > 0) {
          // White, not gold: the spray is the one bright thing on screen.
          const spark: [number, number, number] = dark
            ? [1, 1, 1]
            : [0.16, 0.17, 0.2];
          gl.useProgram(program);
          gl.uniform3f(uniforms.ink, spark[0], spark[1], spark[2]);
          plumes.forEach((plume) => {
            draw(
              sprayPoints,
              rotation,
              plume.at,
              plume.size,
              dark ? 1.9 : 1.4,
              plume.alpha,
              3.4,
            );
          });

          gl.useProgram(lineProgram);
          gl.uniformMatrix4fv(lineUniforms.proj, false, projection);
          gl.uniformMatrix4fv(lineUniforms.view, false, viewMatrix);
          gl.uniform3f(lineUniforms.ink, spark[0], spark[1], spark[2]);
          gl.bindBuffer(gl.ARRAY_BUFFER, sprayJoins);
          gl.enableVertexAttribArray(lineAttrs.pos);
          gl.vertexAttribPointer(lineAttrs.pos, 3, gl.FLOAT, false, 0, 0);
          plumes.forEach((plume) => {
            if (plume.web <= 0.01) return;
            gl.uniformMatrix3fv(lineUniforms.rot, false, rotation);
            gl.uniform3f(
              lineUniforms.offset,
              plume.at[0] - shift[0],
              plume.at[1] - shift[1],
              plume.at[2] - shift[2],
            );
            gl.uniform1f(lineUniforms.scale, plume.size);
            gl.uniform1f(lineUniforms.alpha, plume.web);
            gl.drawArrays(gl.LINES, 0, spray.joinCount);
          });
        }
      }

      // The light theme's moon, the ring of dust it sheds and the belt around it
      // go down last, in one pass: no depth test, hand-ordered, so a stone in
      // front of a moon still reads as being in front of it.
      // The moon, the dust it sheds and its belt are drawn by the three.js pass
      // on its own canvas, against this exact projection.
      if (!dark && bodies.length > 0) {
        rig?.render(bodies, projection, viewMatrix, rotation);
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (lost || !visible || document.hidden) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      time += dt;
      phase += dt;
      flightTime += dt;
      if (!dragging) {
        yaw += velocity * dt;
        velocity *= Math.exp(-4.4 * dt);
        if (!reduced && now - lastInteract > 1600 && Math.abs(velocity) < 0.02) {
          yaw += 0.038 * dt;
        }
      }
      render();
      raf = window.requestAnimationFrame(frame);
    };

    const wake = () => {
      if (raf || lost || !visible) return;
      last = 0;
      raf = window.requestAnimationFrame(frame);
    };

    /** The neighbouring star under this point, if the reader aimed at one. */
    const pickAt = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      for (const target of targets) {
        // Generous: a star is a fuzzy ball, not a bullseye.
        const slop = Math.max(target.r, 24);
        if (Math.hypot(target.x - x, target.y - y) <= slop) return target.key;
      }
      return null;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      downX = event.clientX;
      downY = event.clientY;
      moved = false;
      velocity = 0;
      lastInteract = performance.now();
      canvas.dataset.dragging = 'on';
      canvas.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) {
        // Nothing to drag: the only thing to say is whether a star is under
        // the pointer, so the reader knows it can be clicked.
        canvas.style.cursor = pickAt(event.clientX, event.clientY)
          ? 'pointer'
          : '';
        return;
      }
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 6) {
        moved = true;
      }
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      yaw += dx * 0.0062;
      pitch = Math.max(-1.25, Math.min(1.25, pitch + dy * 0.0052));
      velocity = dx * 0.16;
      lastInteract = performance.now();
      wake();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      delete canvas.dataset.dragging;
      canvas.releasePointerCapture?.(event.pointerId);
      lastInteract = performance.now();
      // A click that never turned the view is a request to go to a star.
      if (!moved) {
        const key = pickAt(event.clientX, event.clientY);
        if (key) handlers.current.onNavigate?.(key);
      }
      moved = false;
      wake();
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom = Math.max(0.55, Math.min(1.9, zoom * (1 + event.deltaY * 0.0009)));
      lastInteract = performance.now();
      wake();
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    };

    const onVisibility = () => {
      if (!document.hidden) wake();
    };

    const resizeObserver = new ResizeObserver(() => {
      applySize();
      wake();
    });
    resizeObserver.observe(container);

    const intersection = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) wake();
    });
    intersection.observe(container);

    const themeObserver = new MutationObserver(() => wake());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('webglcontextlost', onContextLost);
    document.addEventListener('visibilitychange', onVisibility);

    applySize();
    render();
    wake();

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver.disconnect();
      intersection.disconnect();
      themeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      document.removeEventListener('visibilitychange', onVisibility);
      [core, field, planet, sprayPoints].forEach((item) => {
        gl?.deleteBuffer(item.position);
        gl?.deleteBuffer(item.meta);
      });
      gl.deleteBuffer(sprayJoins);
      gl.deleteBuffer(linkBuffer);
      gl.deleteTexture(mapTexture);
      gl.deleteBuffer(galaxy.position);
      gl.deleteBuffer(galaxy.meta);
      rig?.dispose();
      rigCanvas.remove();
      gl.deleteProgram(program);
      gl.deleteProgram(lineProgram);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteShader(lineVertex);
      gl.deleteShader(lineFragment);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    };
  }, [planets.length, starKey]);

  return (
    <div ref={containerRef} className={'orbital-universe ' + className}>
      {centerLabel ? <p className="orbital-universe__core">{centerLabel}</p> : null}
      <div className="orbital-universe__fallback" aria-hidden />
      {planets.map((item, index) => (
        <button
          key={item.key}
          ref={(node) => {
            nodeRefs.current[index] = node;
          }}
          type="button"
          className="orbital-universe__node"
          data-active="off"
          onClick={() => handleClick(item.key)}
          onPointerEnter={() => handlePointerEnter(item.key)}
        >
          <span className="orbital-universe__dot" aria-hidden />
          <span className="orbital-universe__name">{item.label}</span>
        </button>
      ))}
    </div>
  );
};

export default OrbitalUniverse;