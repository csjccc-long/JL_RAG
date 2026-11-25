'use client';

import { useEffect, useRef } from 'react';

import './black-hole-universe.css';

import { setBlackHoleCollapse } from './collapse';

/**
 * The light theme's universe: a black hole instead of a galaxy.
 *
 * On paper the star field turns into a grey smear, so this half of the console
 * is drawn as ink: a pocket of near black, a disc turning inside it and the
 * shadow the disc is orbiting. The hole itself is a screen space fragment
 * shader -- the band, the arc the far side is lensed into and the near side
 * that crosses in front of the shadow are layered by hand, which keeps every
 * edge where it belongs at any size.
 *
 * Around it the same particles the dark sky is built from: a field of ink dots
 * standing in for the far stars and a ring of dust turning with the disc, so
 * both themes are the same universe seen in different light. Dragging turns it,
 * the wheel closes in, a double click puts it back.
 */

const VERTEX = String.raw`#version 300 es
precision highp float;

void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAGMENT = String.raw`#version 300 es
precision highp float;

uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uScale;
uniform float uTime;
uniform float uTilt;
uniform float uYaw;
uniform float uAlpha;
uniform float uCollapse;

out vec4 outColor;

const float R_IN = 1.16;         // disc radii, in shadow radii
const float R_OUT = 2.40;

const vec3 INK = vec3(0.012, 0.014, 0.022);
const vec3 GOLD = vec3(1.0, 0.82, 0.55);
const vec3 PALE = vec3(1.0, 0.95, 0.86);
const vec3 RUST = vec3(0.55, 0.22, 0.09);

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    total += amp * vnoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return total;
}

void main() {
  // Everything is measured in shadow radii, so the drawing keeps its shape
  // whatever the canvas size.
  vec2 p = (gl_FragCoord.xy - uCenter) / uScale;

  // Falling in: the frame is pushed through the shadow while space itself
  // twists around it, so the page spirals into the dark instead of just zooming.
  if (uCollapse > 0.0) {
    // Shrinking the measure of a pixel means the shadow covers more of the
    // frame: the hole grows until there is nothing left but itself.
    float pull = 1.0 - 0.94 * uCollapse;
    vec2 q = p * max(0.06, pull);
    float twist = uCollapse * 1.45 * (0.3 + 1.1 / (1.0 + length(q)));
    float cs = cos(twist);
    float sn = sin(twist);
    p = mat2(cs, -sn, sn, cs) * q;
    p *= 1.0 + 0.055 * sin(length(p) * 9.0 - uTime * 3.5) * uCollapse;
  }

  float radius = length(p);
  float angle = atan(p.y, p.x);

  float alpha = 0.0;
  vec3 col = vec3(0.0);

  // The drawing is measured in shadow radii, so the visible half width in
  // those units tells us where the drawing has to stop before it is chopped.
  float room = (uRes.x * 0.5) / uScale;
  float sides = 1.0 - smoothstep(room * 0.55, room * 0.85, abs(p.x));

  // The ink pool the hole sits in: black out to the rim, then gone, so the
  // light theme still reads as paper around it.
  float pocket = 1.0 - smoothstep(0.995, 1.10, radius);
  col = mix(col, INK, pocket);
  alpha = pocket * sides;

  // The far side of the disc, lifted over the shadow by the lensing. It shows
  // up as a thin arc hugging the rim plus a softer glow outside it.
  float above = smoothstep(-0.12, 0.6, p.y);
  float rim = exp(-pow((radius - 1.085) / 0.045, 2.0));
  float crown = exp(-pow((radius - 1.30) / 0.10, 2.0));
  float grain = 0.55 + 0.45 * fbm(vec2(angle * 3.4 + uTime * 0.06, radius * 2.2));
  float arc = (rim + crown * 0.5) * above * grain;
  col += GOLD * arc * sides;
  alpha = max(alpha, min(1.0, arc * 1.15) * sides);

  // The shadow itself.
  float shadow = 1.0 - smoothstep(0.965, 1.015, radius);
  col = mix(col, vec3(0.003, 0.004, 0.008), shadow);
  alpha = max(alpha, shadow);

  // The photon ring, thin and hot.
  float ring = exp(-pow((radius - 1.032) / 0.018, 2.0));
  col += PALE * ring * 0.85;
  alpha = max(alpha, ring * 0.8);

  // The near side of the disc. The plane is squashed by the inclination, so
  // the pixels are stretched back into it before the radius is measured --
  // that is what turns the band into an ellipse, and what lets it cross the
  // lower half of the shadow.
  vec2 plane = vec2(p.x, p.y / max(0.05, uTilt));
  float disc = length(plane);
  float band = smoothstep(R_IN, R_IN + 0.12, disc) *
    (1.0 - smoothstep(R_OUT - 0.62, R_OUT, disc));
  // The half of the ring that passes in front of the shadow, and the half that
  // passes behind it. The far half is only lost where the shadow covers it, so
  // it is gated by the rim of the shadow instead of being cut at the horizon --
  // cutting it there is what made the disc look sawn in half at steep angles.
  float front = 1.0 - smoothstep(-0.06, 0.10, p.y);
  float far = (1.0 - front) * smoothstep(0.99, 1.05, radius);
  float visible = clamp(front + far, 0.0, 1.0);

  if (band * visible > 0.001) {
    float heat = clamp((disc - R_IN) / (R_OUT - R_IN), 0.0, 1.0);
    float phi = atan(plane.y, plane.x) + uYaw;
    float spin = phi - uTime * (0.22 / pow(disc, 1.15));

    float streak = 0.42 + 0.72 * fbm(vec2(log(disc) * 4.6, spin * 2.4));
    streak *= 0.74 + 0.26 * fbm(vec2(log(disc) * 12.0, spin * 6.0));

    // The side turning toward the reader runs hotter.
    float doppler = 0.72 + 0.5 * smoothstep(-0.9, 0.9, cos(phi - 0.7));

    vec3 tint = mix(PALE, GOLD, smoothstep(0.0, 0.34, heat));
    tint = mix(tint, RUST, smoothstep(0.55, 1.0, heat) * 0.55);

    float falloff = pow(1.0 - heat, 1.15);
    // The far half is seen through the space above the hole, so it reads a
    // little cooler than the near half.
    float emission = band * visible * (0.68 + 1.15 * falloff) * streak * doppler;
    emission *= mix(1.0, 0.82, far);
    // The inner rim runs hottest and shows up as a thin bright edge.
    float hot = exp(-pow((disc - R_IN - 0.03) / 0.038, 2.0)) * band * visible;

    col += tint * emission * sides;
    col += PALE * hot * 0.52 * sides;
    alpha = max(alpha, min(1.0, (emission + hot * 0.52) * 0.85) * sides);
  }

  // Nothing may end on a hard canvas edge: the drawing dissolves into the
  // page instead.
  vec2 uv = gl_FragCoord.xy / uRes;
  float edge = smoothstep(0.0, 0.08, uv.x) * smoothstep(0.0, 0.08, uv.y) *
    smoothstep(1.0, 0.92, uv.x) * smoothstep(1.0, 0.92, uv.y);
  alpha *= edge;

  outColor = vec4(col * alpha * uAlpha, alpha * uAlpha);
}
`;

/**
 * The particles. One program draws both clouds: kind 0 is dust riding the disc
 * plane (so it shears with the same angular speed the shader paints with), kind
 * 1 is the far star field standing behind the hole.
 */
const POINT_VERTEX = String.raw`#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;   // kind 0: (radius, phase, lift); kind 1: (radius, phase, 0)
layout(location = 1) in vec3 aMeta;  // (size, brightness, warmth)

uniform float uKind;
uniform float uTilt;
uniform float uYaw;
uniform float uTime;
uniform float uScale;
uniform float uZoom;
uniform vec2 uCenter;
uniform vec2 uRes;
uniform float uPixel;
uniform float uCollapse;

out float vAlpha;
out float vWarm;

void main() {
  float radius = aPos.x;
  vec2 p;
  if (uKind < 0.5) {
    // Dust turns with the disc, faster the closer in, exactly as the shader
    // paints its streaks.
    float a = aPos.y + uYaw - uTime * (0.22 / pow(radius, 1.15));
    p = vec2(radius * cos(a), radius * sin(a) * uTilt + aPos.z);
  } else {
    float a = aPos.y + uYaw * 0.22;
    p = radius * vec2(cos(a), sin(a));
  }

  // Dust behind the shadow is swallowed by it; dust on the near side is not.
  float vis = 1.0;
  if (uKind < 0.5 && length(p) < 1.04 && p.y > 0.0) vis = 0.0;

  // The sky rushes outward as the hole swallows the frame.
  vec2 screen = uCenter + p * uScale * uZoom * (1.0 + 2.6 * uCollapse);
  gl_Position = vec4(screen / uRes * 2.0 - 1.0, 0.0, 1.0);

  // Like the drawing itself, no particle may end on a hard canvas edge.
  vec2 uv = screen / uRes;
  float edge = smoothstep(0.0, 0.1, uv.x) * smoothstep(1.0, 0.9, uv.x) *
    smoothstep(0.0, 0.1, uv.y) * smoothstep(1.0, 0.9, uv.y);

  float swell = uKind < 0.5 ? 1.0 : clamp(uZoom, 0.8, 1.4);
  gl_PointSize = clamp(aMeta.x * uPixel * swell, 1.0, 7.0);
  vAlpha = vis * aMeta.y * edge * (1.0 - uCollapse);
  vWarm = aMeta.z;
}
`;

const POINT_FRAGMENT = String.raw`#version 300 es
precision highp float;

uniform vec3 uInk;
uniform vec3 uHeat;
uniform float uAlpha;

in float vAlpha;
in float vWarm;

out vec4 outColor;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float mask = smoothstep(0.5, 0.32, d);
  float alpha = mask * vAlpha * uAlpha;
  vec3 col = mix(uInk, uHeat, vWarm);
  outColor = vec4(col * alpha, alpha);
}
`;

type Program = {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

const compile = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type) as WebGLShader;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('shader: ' + (log || 'unknown'));
  }
  return shader;
};

const createProgram = (
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
  names: string[],
): Program => {
  const program = gl.createProgram() as WebGLProgram;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error('link: ' + (log || 'unknown'));
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  names.forEach((name) => {
    uniforms[name] = gl.getUniformLocation(program, name);
  });
  return { program, uniforms };
};

/** Shadow radius as a fraction of the canvas height. */
const SHADOW_SCALE = 0.235;

/** Far stars, and the dust that rides the disc. */
const STAR_COUNT = 4200;
const DUST_COUNT = 20000;

const REST_TILT = 0.2;
const MIN_TILT = 0.12;
const MAX_TILT = 0.62;
const REST_ZOOM = 1;
const MIN_ZOOM = 0.62;
const MAX_ZOOM = 1.9;

const random = (seed: number) => {
  // A plain deterministic generator keeps the sky identical between mounts.
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
};

/** Interleaved [radius, phase, lift, size, brightness, warmth] per particle. */
const buildParticles = () => {
  const next = random(0x9e3779b9);
  const stride = 6;
  const data = new Float32Array((STAR_COUNT + DUST_COUNT) * stride);
  const tau = Math.PI * 2;

  let slot = 0;
  for (let i = 0; i < STAR_COUNT; i += 1) {
    // Sparse ink specks on paper: they thin out with distance, so the page
    // stays a page and the hole stays the subject.
    const radius = 1.7 + Math.pow(next(), 0.7) * 7.8;
    const phase = next() * tau;
    const bright = 0.16 + 0.42 * Math.pow(next(), 1.6);
    const size = 0.8 + next() * 0.8;
    data[slot] = radius;
    data[slot + 1] = phase;
    data[slot + 2] = 0;
    data[slot + 3] = size;
    data[slot + 4] = bright * (1.25 / (1 + radius * 0.5));
    data[slot + 5] = 0;
    slot += stride;
  }

  for (let i = 0; i < DUST_COUNT; i += 1) {
    // Dust hugs the band: dense where the disc is bright, gone by the time it
    // reaches the edge of the annulus, so it never fogs the paper.
    const radius = 1.3 + Math.pow(next(), 1.3) * 1.22;
    const phase = next() * tau;
    const lift = (next() - 0.5) * 0.05;
    const size = 0.9 + next() * 0.9;
    const near = 1 - Math.min(1, (radius - 1.3) / 1.22);
    const band = 1 - Math.min(1, Math.max(0, (radius - 1.85) / 0.67));
    data[slot] = radius;
    data[slot + 1] = phase;
    data[slot + 2] = lift;
    data[slot + 3] = size;
    data[slot + 4] = (0.17 + 0.33 * next()) * (0.5 + 0.5 * near) * band;
    data[slot + 5] = 0.35 + 0.65 * near;
    slot += stride;
  }

  return { data, stride };
};

type BlackHoleUniverseProps = { className?: string };

const BlackHoleUniverse = ({ className = '' }: BlackHoleUniverseProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    if (!gl) return;

    let disc: Program;
    let points: Program;
    try {
      disc = createProgram(gl, VERTEX, FRAGMENT, [
        'uRes',
        'uCenter',
        'uScale',
        'uTime',
        'uTilt',
        'uYaw',
        'uAlpha',
        'uCollapse',
      ]);
      points = createProgram(gl, POINT_VERTEX, POINT_FRAGMENT, [
        'uKind',
        'uTilt',
        'uYaw',
        'uTime',
        'uScale',
        'uZoom',
        'uCenter',
        'uRes',
        'uPixel',
        'uInk',
        'uHeat',
        'uAlpha',
        'uCollapse',
      ]);
    } catch (error) {
      console.warn('[black-hole] shader failed', error);
      return;
    }

    const quad = gl.createVertexArray();
    const cloud = gl.createVertexArray();
    const particles = buildParticles();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(cloud);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, particles.data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, particles.stride * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, particles.stride * 4, 12);
    gl.bindVertexArray(null);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    const view = {
      yaw: 0,
      tilt: REST_TILT,
      zoom: REST_ZOOM,
      spin: 0,
      drift: 0,
      dragging: false,
    };
    let lastX = 0;
    let lastY = 0;

    const clamp = (value: number, low: number, high: number) =>
      Math.min(high, Math.max(low, value));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let frame = 0;
    let last = performance.now();
    let elapsed = 0;

    // Falling in: the drawing pushes in and twists, then reports that it is
    // done so the page can swap the tab behind the black.
    const COLLAPSE_MS = 620;
    let collapseStart = 0;
    let collapseDone: (() => void) | null = null;

    const render = (now: number) => {
      frame = 0;
      const step = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!reduced.matches) elapsed += step;

      const sinkRaw = collapseStart
        ? Math.min(1, (now - collapseStart) / COLLAPSE_MS)
        : 0;
      const sink = sinkRaw * sinkRaw * (3 - 2 * sinkRaw);

      // Released turns coast a little before settling.
      if (!view.dragging) {
        view.yaw += view.spin;
        view.tilt = clamp(view.tilt + view.drift, MIN_TILT, MAX_TILT);
        view.spin *= 0.94;
        view.drift *= 0.92;
        if (Math.abs(view.spin) < 0.00004) view.spin = 0;
        if (Math.abs(view.drift) < 0.00004) view.drift = 0;
      }

      const width = canvas.width;
      const height = canvas.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);

      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );

      const scale = Math.min(height * SHADOW_SCALE, width * 0.26);
      const centerX = width * 0.5;
      // gl_FragCoord counts from the bottom, so this lifts the hole a little.
      const centerY = height * 0.53;

      // The far stars go down first, so the hole is drawn on top of them.
      gl.useProgram(points.program);
      gl.uniform1f(points.uniforms.uKind, 1);
      gl.uniform1f(points.uniforms.uTilt, view.tilt);
      gl.uniform1f(points.uniforms.uYaw, view.yaw);
      gl.uniform1f(points.uniforms.uTime, elapsed);
      gl.uniform1f(points.uniforms.uScale, scale);
      gl.uniform1f(points.uniforms.uZoom, view.zoom);
      gl.uniform1f(points.uniforms.uCollapse, sink);
      gl.uniform2f(points.uniforms.uCenter, centerX, centerY);
      gl.uniform2f(points.uniforms.uRes, width, height);
      gl.uniform1f(points.uniforms.uPixel, ratio);
      gl.uniform3f(points.uniforms.uInk, 0.2, 0.21, 0.26);
      gl.uniform3f(points.uniforms.uHeat, 0.33, 0.29, 0.24);
      gl.uniform1f(points.uniforms.uAlpha, 1);
      gl.bindVertexArray(cloud);
      gl.drawArrays(gl.POINTS, 0, STAR_COUNT);

      gl.useProgram(disc.program);
      gl.uniform2f(disc.uniforms.uRes, width, height);
      gl.uniform2f(disc.uniforms.uCenter, centerX, centerY);
      // Keep the whole drawing inside the frame, even in a narrow window.
      gl.uniform1f(disc.uniforms.uScale, scale);
      gl.uniform1f(disc.uniforms.uTime, elapsed);
      gl.uniform1f(disc.uniforms.uTilt, view.tilt);
      gl.uniform1f(disc.uniforms.uYaw, view.yaw);
      gl.uniform1f(disc.uniforms.uAlpha, 1);
      gl.uniform1f(disc.uniforms.uCollapse, sink);
      gl.bindVertexArray(quad);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // The dust rides over the band, so the disc keeps a grain of its own.
      gl.useProgram(points.program);
      gl.uniform1f(points.uniforms.uKind, 0);
      gl.uniform1f(points.uniforms.uZoom, view.zoom);
      gl.uniform3f(points.uniforms.uInk, 0.3, 0.24, 0.18);
      gl.uniform3f(points.uniforms.uHeat, 0.52, 0.24, 0.06);
      gl.bindVertexArray(cloud);
      gl.drawArrays(gl.POINTS, STAR_COUNT, DUST_COUNT);
      gl.bindVertexArray(null);

      if (sinkRaw >= 1 && collapseDone) {
        const done = collapseDone;
        collapseDone = null;
        done();
      }

      if (!reduced.matches) frame = requestAnimationFrame(render);
    };

    const kick = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };

    const collapse = () =>
      new Promise<void>((resolve) => {
        if (reduced.matches) {
          resolve();
          return;
        }
        collapseStart = performance.now();
        collapseDone = resolve;
        kick();
      });
    const releaseCollapse = setBlackHoleCollapse(collapse);
    if (import.meta.env.DEV) {
      (window as unknown as { __bhCollapse?: unknown }).__bhCollapse =
        collapse;
    }

    const handlePointerDown = (event: PointerEvent) => {
      view.dragging = true;
      view.spin = 0;
      view.drift = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('is-dragging');
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!view.dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      view.yaw -= dx * 0.006;
      view.tilt = clamp(view.tilt + dy * 0.004, MIN_TILT, MAX_TILT);
      view.spin = -dx * 0.0025;
      view.drift = dy * 0.0016;
      kick();
    };

    const handlePointerUp = (event: PointerEvent) => {
      view.dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      canvas.classList.remove('is-dragging');
      kick();
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      view.zoom = clamp(
        view.zoom * Math.exp(-event.deltaY * 0.0012),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      kick();
    };

    const handleDoubleClick = () => {
      view.yaw = 0;
      view.tilt = REST_TILT;
      view.zoom = REST_ZOOM;
      view.spin = 0;
      view.drift = 0;
      kick();
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('dblclick', handleDoubleClick);
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      releaseCollapse();
      observer.disconnect();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerUp);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      gl.deleteVertexArray(quad);
      gl.deleteVertexArray(cloud);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(disc.program);
      gl.deleteProgram(points.program);
    };
  }, []);

  return (
    <div className={'black-hole-universe ' + className}>
      <canvas
        ref={canvasRef}
        className="black-hole-universe__canvas"
        aria-label="黑洞：拖动转动圆盘，滚轮缩放"
      />
    </div>
  );
};

export default BlackHoleUniverse;
export { BlackHoleUniverse };
