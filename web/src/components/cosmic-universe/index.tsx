'use client';

import { useEffect, useRef } from 'react';

import './cosmic-universe.css';

const VERTEX = `#version 300 es
precision highp float;

in vec3 aPos;
in vec3 aMeta; // x: seed, y: warmth, z: brightness

uniform mat3 uRot;
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uInk;
uniform float uPixel;
uniform float uTime;
uniform float uAlpha;

out vec3 vColor;
out float vAlpha;

void main() {
  vec4 clip = uProj * uView * vec4(uRot * aPos, 1.0);
  gl_Position = clip;

  float depth = max(clip.w, 0.4);
  float size = uPixel * (0.6 + 1.05 * aMeta.x);
  gl_PointSize = clamp(size * (4.0 / depth), 0.7, 6.5);

  vec3 cool = vec3(0.58, 0.72, 1.0);
  vec3 warm = vec3(1.0, 0.84, 0.62);
  vColor = mix(cool, warm, aMeta.y) * aMeta.z * uInk;
  vAlpha =
    (0.7 + 0.3 * sin(uTime * (0.6 + aMeta.x * 2.8) + aMeta.x * 61.0)) * uAlpha;
}
`;

const FRAGMENT = `#version 300 es
precision highp float;

in vec3 vColor;
in float vAlpha;

out vec4 outColor;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.25, 0.0, dot(d, d));
  float alpha = a * vAlpha;
  outColor = vec4(vColor * alpha, alpha);
}
`;

const TAU = Math.PI * 2;
const ARMS = 3;
/** Spiral disc: the arms carry most of the light. */
const DISC_COUNT = 42000;
/** Bulge at the centre, where the arms are lost in the core's glow. */
const CORE_COUNT = 12000;
/** Faint dust filling the space between arms, so the disc reads as a body. */
const DUST_COUNT = 18000;
/** A sparse halo that keeps the galaxy from ending at a hard edge. */
const HALO_COUNT = 7000;
/** Far-away stars. They turn more slowly than the galaxy, which reads as depth. */
const FIELD_COUNT = 16000;

const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

type Layer = { position: Float32Array; meta: Float32Array; count: number };

/**
 * Two layers instead of one: the galaxy turns with the pointer, the far field
 * only drifts, so turning the view feels like moving through space rather than
 * spinning a snow globe.
 */
const buildGalaxy = (): Layer => {
  const random = createRandom(0x9e3779b9);
  const total = DISC_COUNT + DUST_COUNT + CORE_COUNT + HALO_COUNT;
  const position = new Float32Array(total * 3);
  const meta = new Float32Array(total * 3);
  let index = 0;

  const push = (
    x: number,
    y: number,
    z: number,
    warmth: number,
    brightness: number,
  ) => {
    const slot = index * 3;
    position[slot] = x;
    position[slot + 1] = y;
    position[slot + 2] = z;
    meta[slot] = random();
    meta[slot + 1] = warmth;
    meta[slot + 2] = brightness;
    index += 1;
  };

  const gauss = () => {
    const u = Math.max(1e-6, random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * random());
  };

  const direction = () => {
    const z = random() * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = random() * TAU;
    return [Math.cos(phi) * r, z, Math.sin(phi) * r] as const;
  };

  for (let n = 0; n < DISC_COUNT; n += 1) {
    // A near-flat radius distribution leaves the middle as dense as the rim,
    // which is what makes the arms read as one body instead of a ring.
    const radius = 0.1 + 1.46 * Math.pow(random(), 0.82);
    const edge = 1 - Math.min(1, radius / 1.56);
    const arm = n % ARMS;
    const angle =
      (arm / ARMS) * TAU + radius * 2.45 + gauss() * (0.14 + 0.2 * edge);
    push(
      Math.cos(angle) * radius,
      gauss() * (0.024 + 0.05 * edge),
      Math.sin(angle) * radius,
      0.1 + 0.66 * edge * edge,
      0.36 + 0.5 * Math.pow(edge, 1.3),
    );
  }

  for (let n = 0; n < DUST_COUNT; n += 1) {
    const radius = 0.2 + 1.6 * Math.pow(random(), 0.72);
    const edge = 1 - Math.min(1, radius / 1.8);
    const angle = random() * TAU;
    push(
      Math.cos(angle) * radius,
      gauss() * 0.07,
      Math.sin(angle) * radius,
      0.18 + 0.5 * edge,
      0.1 + 0.24 * Math.pow(edge, 1.4),
    );
  }

  for (let n = 0; n < CORE_COUNT; n += 1) {
    const radius = Math.pow(random(), 1.5) * 0.46;
    const [dx, dy, dz] = direction();
    push(
      dx * radius,
      dy * radius * 0.6,
      dz * radius,
      0.52 + 0.44 * random(),
      0.55 + 0.45 * (1 - radius / 0.46),
    );
  }

  for (let n = 0; n < HALO_COUNT; n += 1) {
    const radius = 0.7 + 2.2 * Math.pow(random(), 0.8);
    const [dx, dy, dz] = direction();
    push(
      dx * radius,
      dy * radius * 0.8,
      dz * radius,
      0.16 + 0.34 * random(),
      0.12 + 0.22 * random(),
    );
  }

  return { position, meta, count: total };
};

const buildField = (): Layer => {
  const random = createRandom(0x51ed270b);
  const position = new Float32Array(FIELD_COUNT * 3);
  const meta = new Float32Array(FIELD_COUNT * 3);

  for (let n = 0; n < FIELD_COUNT; n += 1) {
    const radius = 10 + 16 * Math.pow(random(), 0.7);
    const z = random() * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = random() * TAU;
    const slot = n * 3;
    position[slot] = Math.cos(phi) * r * radius;
    position[slot + 1] = z * radius;
    position[slot + 2] = Math.sin(phi) * r * radius;
    meta[slot] = random();
    meta[slot + 1] = 0.16 + 0.5 * random();
    meta[slot + 2] = 0.22 + 0.42 * random();
  }

  return { position, meta, count: FIELD_COUNT };
};

const perspective = (fov: number, aspect: number, near: number, far: number) => {
  const f = 1 / Math.tan(fov / 2);
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * far * near) / (near - far),
    0,
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

type CosmicUniverseProps = {
  className?: string;
};

/**
 * A galaxy of particles you can turn by hand: the memory console's overview
 * draws the whole engine as one small universe, so the numbers can live in a
 * drawer at the edge instead of in the middle of the page.
 */
export function CosmicUniverse({ className = '' }: CosmicUniverseProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // The canvas is built here rather than in JSX on purpose: a canvas keeps
    // the context it was first given, so a canvas mounted twice (React's
    // development double-mount, a tab switch) would come back with the context
    // we released on unmount and could never draw again.
    const canvas = document.createElement('canvas');
    canvas.className = 'cosmic-universe__canvas';
    canvas.setAttribute('aria-hidden', '');
    container.appendChild(canvas);

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
        depth: false,
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

    const local = (name: string) =>
      gl?.getUniformLocation(program, name) ?? null;
    const attrs = {
      pos: gl.getAttribLocation(program, 'aPos'),
      meta: gl.getAttribLocation(program, 'aMeta'),
    };
    const uniforms = {
      rot: local('uRot'),
      proj: local('uProj'),
      view: local('uView'),
      ink: local('uInk'),
      pixel: local('uPixel'),
      time: local('uTime'),
      alpha: local('uAlpha'),
    };

    const layers = [buildField(), buildGalaxy()].map((layer, index) => {
      const position = gl.createBuffer();
      const meta = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, position);
      gl.bufferData(gl.ARRAY_BUFFER, layer.position, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, meta);
      gl.bufferData(gl.ARRAY_BUFFER, layer.meta, gl.STATIC_DRAW);
      // The far field sits 10-26 units away, where the same point size would
      // shrink to nothing: it gets its own scale instead.
      return { position, meta, count: layer.count, scale: index === 0 ? 5.4 : 1 };
    });

    const projection = new Float32Array(16);
    const viewMatrix = new Float32Array(16);
    const rotation = new Float32Array(9);
    const drift = new Float32Array(9);

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let yaw = -0.42;
    let pitch = 0.46;
    let zoom = 1;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
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
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      projection.set(perspective(0.82, width / height, 0.1, 60));
      if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const writeRotation = (y: number, p: number, out: Float32Array) => {
      const cy = Math.cos(y);
      const sy = Math.sin(y);
      const cp = Math.cos(p);
      const sp = Math.sin(p);
      // R = Ry(yaw) * Rx(pitch), column-major for uniformMatrix3fv.
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

    const draw = () => {
      if (!gl) return;
      const dark = document.documentElement.classList.contains('dark');
      const ink = readInk(canvas);
      const distance = 3.9 * zoom;

      writeRotation(yaw, pitch, rotation);
      writeRotation(yaw * 0.32, pitch * 0.32, drift);

      viewMatrix.fill(0);
      viewMatrix[0] = 1;
      viewMatrix[5] = 1;
      viewMatrix[10] = 1;
      viewMatrix[15] = 1;
      viewMatrix[14] = -distance;

      // The buffer is premultiplied, so a clear colour carrying alpha 0 must
      // carry no light either: anything brighter paints the whole canvas.
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);
      gl.enable(gl.BLEND);
      if (dark) {
        gl.blendFunc(gl.ONE, gl.ONE);
      } else {
        // Light theme paints dark ink, so overlapping particles add up to a
        // black pit unless each one stays faint.
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      gl.uniform1f(uniforms.alpha, dark ? 1 : 0.5);

      gl.uniformMatrix4fv(uniforms.proj, false, projection);
      gl.uniformMatrix4fv(uniforms.view, false, viewMatrix);
      // On paper the ink is nearly black, and thousands of dark dots on top of
      // each other turn the core into a hole: lighten it toward graphite.
      const soften = dark ? 0 : 0.58;
      gl.uniform3f(
        uniforms.ink,
        ink[0] + (0.52 - ink[0]) * soften,
        ink[1] + (0.53 - ink[1]) * soften,
        ink[2] + (0.58 - ink[2]) * soften,
      );
      const pixel =
        (canvas.height / 760) *
        Math.min(2.2, Math.max(1, window.devicePixelRatio || 1));
      gl.uniform1f(uniforms.time, reduced ? 0 : time);

      layers.forEach((layer, index) => {
        gl.uniform1f(uniforms.pixel, pixel * layer.scale);
        gl.uniformMatrix3fv(
          uniforms.rot,
          false,
          index === 0 ? drift : rotation,
        );
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.position);
        gl.enableVertexAttribArray(attrs.pos);
        gl.vertexAttribPointer(attrs.pos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.meta);
        gl.enableVertexAttribArray(attrs.meta);
        gl.vertexAttribPointer(attrs.meta, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, layer.count);
      });
    };

    const frame = (now: number) => {
      raf = 0;
      if (lost || !visible || document.hidden) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      time += dt;
      if (!dragging) {
        yaw += velocity * dt;
        velocity *= Math.exp(-4.4 * dt);
        if (!reduced && now - lastInteract > 1600 && Math.abs(velocity) < 0.02) {
          yaw += 0.052 * dt;
        }
      }
      draw();
      raf = window.requestAnimationFrame(frame);
    };

    const wake = () => {
      if (raf || lost || !visible) return;
      last = 0;
      raf = window.requestAnimationFrame(frame);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      velocity = 0;
      lastInteract = performance.now();
      canvas.dataset.dragging = 'on';
      canvas.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
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
      wake();
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom = Math.max(0.5, Math.min(2.2, zoom * (1 + event.deltaY * 0.0009)));
      lastInteract = performance.now();
      wake();
    };

    // A hidden tab stops the loop on purpose; coming back has to restart it.
    const onVisibility = () => {
      if (!document.hidden) wake();
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
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

    // Particle colour follows the theme's ink, so a redraw has to happen when
    // the theme class flips.
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
    draw();
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
      layers.forEach((layer) => {
        gl?.deleteBuffer(layer.position);
        gl?.deleteBuffer(layer.meta);
      });
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      // Hand the context back before the element goes: browsers cap how many a
      // page may hold, and detached canvases keep theirs until they are gone.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    };
  }, []);

  return (
    <div ref={containerRef} className={`cosmic-universe ${className}`.trim()}>
      <div className="cosmic-universe__fallback" aria-hidden />
    </div>
  );
}

export default CosmicUniverse;
