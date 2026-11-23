/*
 * The weather over the range.
 *
 * Ported from the ERP trend chart's cloud field, because that one is the right
 * idea: the mass's upper edge is the reading (billowed by noise, so it is cloud
 * and not a curve), its body is turbulence that drifts and churns, and its
 * shading comes from sampling the same field twice and reading the difference —
 * bright crest, dark underside. That difference is the volume; no gradient is
 * painted on to fake one.
 *
 * One departure, because this is a chart and not a scene: the mass thins out
 * toward the axis instead of filling the frame, so the range stays legible
 * underneath it.
 */
import { useEffect, useRef } from 'react';

import { TrendCurve } from './trend-geometry';
import './trend-cloud-layer.css';

type TrendCloudLayerProps = {
  line: TrendCurve;
  /* the weather is scenery: it takes the same ink as the range */
  tint: string;
};

const VertexShader = [
  'attribute vec2 aPos;',
  'varying vec2 vUv;',
  '',
  'void main() {',
  '  vUv = aPos * 0.5 + 0.5;',
  '  gl_Position = vec4(aPos, 0.0, 1.0);',
  '}',
].join('\n');

const FragmentShader = [
  'precision mediump float;',
  '',
  'uniform float uTime;',
  'uniform sampler2D uCrest;',
  'uniform vec3 uTint;',
  'uniform float uOpacity;',
  'uniform float uBand;',
  'uniform float uLight;',
  '',
  'varying vec2 vUv;',
  '',
  'float hash(vec2 p) {',
  '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);',
  '}',
  '',
  'float noise(vec2 p) {',
  '  vec2 i = floor(p);',
  '  vec2 f = fract(p);',
  '  f = f * f * (3.0 - 2.0 * f);',
  '  float a = hash(i);',
  '  float b = hash(i + vec2(1.0, 0.0));',
  '  float c = hash(i + vec2(0.0, 1.0));',
  '  float d = hash(i + vec2(1.0, 1.0));',
  '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
  '}',
  '',
  'float fbm(vec2 p) {',
  '  float sum = 0.0;',
  '  float amp = 0.5;',
  '  for (int i = 0; i < 4; i++) {',
  '    sum += amp * noise(p);',
  '    p = p * 2.02 + 11.3;',
  '    amp *= 0.5;',
  '  }',
  '  return sum;',
  '}',
  '',
  'void main() {',
  '  /* the crest comes in as a strip: one reading height per column */',
  '  float crest = 1.0 - texture2D(uCrest, vec2(vUv.x, 0.5)).r;',
  '  float billow = (fbm(vec2(vUv.x * 7.0, 1.7)) - 0.5) * 0.15',
  '    + (fbm(vec2(vUv.x * 19.0, 4.1)) - 0.5) * 0.04;',
  '  float edge = crest + billow;',
  '',
  '  float below = edge - vUv.y;',
  '  if (below < -0.02) discard;',
  '',
  '  float band = 1.0 - smoothstep(uBand * 0.3, uBand, below);',
  '  if (band < 0.004) discard;',
  '',
  '  /* the weather is a field that moves: it drifts sideways and its own',
  '     turbulence drags the sample sideways, so edges churn instead of slide */',
  '  float warp = fbm(vec2(vUv.y * 6.4, uTime * 0.02));',
  '  vec2 p = vec2(',
  '    vUv.x * 9.0 + uTime * 0.018 + warp * 0.6,',
  '    vUv.y * 5.0 - uTime * 0.005',
  '  );',
  '',
  '  float n1 = fbm(p);',
  '  float n2 = fbm(p + vec2(0.0, 0.085));',
  '  float n3 = fbm(p * 2.3 + vec2(1.7, 0.4));',
  '  float cloud = n1 * 0.62 + n3 * 0.38;',
  '',
  '  /* the same field sampled a little higher: a cloud is brighter on top, and',
  '     that difference is the only shading there is — no gradient is painted */',
  '  float lit = clamp((cloud - n2) * 5.0 + 0.5, 0.0, 1.0);',
  '',
  '  float body = smoothstep(edge + 0.02, edge - 0.02, vUv.y);',
  '  float front = smoothstep(edge - 0.18, edge - 0.02, vUv.y) * body;',
  '',
  '  float dens = smoothstep(0.42, 0.66, cloud);',
  '  dens *= mix(1.0, smoothstep(0.32, 0.60, fbm(p * 0.45 + vec2(uTime * 0.04, 0.0))), 0.85);',
  '',
  '  float fill = 0.12 * (0.35 + 0.65 * fbm(p * 0.5 + vec2(uTime * 0.05, 3.1)));',
  '',
  '  float side = smoothstep(0.0, 0.05, vUv.x) * smoothstep(0.0, 0.05, 1.0 - vUv.x);',
  '  float alpha = (fill + dens * 1.25 * body) * band * side * (1.0 + front * 0.5) * uOpacity;',
  '  alpha *= mix(1.0, 1.5, uLight);',
  '',
  '  vec3 dark = mix(uTint * 0.34, min(vec3(1.0), uTint * 1.5),',
  '    clamp(lit * 0.9 + front * 0.65, 0.0, 1.0));',
  '  /* on a pale page there is no light to catch: only shadow reads, so the',
  '     shape is drawn by its underside and its lit crest stays near the page */',
  '  vec3 pale = mix(vec3(0.62), vec3(0.97), clamp(lit * 0.5 + front * 0.35, 0.0, 1.0));',
  '  vec3 shade = mix(dark, pale, uLight);',
  '  gl_FragColor = vec4(shade, alpha);',
  '}',
].join('\n');

/* the crest is uploaded as a strip: one height per column, in plot units */
const CrestColumns = 512;

/* clouds are soft, so they are drawn small and stretched by the browser: a
   third of the pixels, no visible difference, far less work per frame */
const RenderScale = 0.66;
const RenderWidthCap = 720;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const parseTint = (raw: string): [number, number, number] => {
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((part) => Number.isFinite(part));

  return parts.length >= 3 ? [parts[0], parts[1], parts[2]] : [255, 255, 255];
};

const crestStrip = (line: TrendCurve) => {
  const last = line.points.length - 1;
  const data = new Uint8Array(CrestColumns);

  for (let index = 0; index < CrestColumns; index += 1) {
    const y = line.at((index / (CrestColumns - 1)) * last).y;
    data[index] = Math.round(clamp01(y / line.height) * 255);
  }

  return data;
};

const compile = (gl: WebGLRenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);

  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[TrendCloud] shader', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
};

export function TrendCloudLayer({ line, tint }: TrendCloudLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
    });

    /* no WebGL is no weather: the range is still readable without it */
    if (!gl) return;

    const vertex = compile(gl, gl.VERTEX_SHADER, VertexShader);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FragmentShader);
    const program = gl.createProgram();

    if (!vertex || !fragment || !program) return;

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[TrendCloud] link', gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    /* one triangle covers the canvas; there is nothing to index */
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );

    const position = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.LUMINANCE,
      CrestColumns,
      1,
      0,
      gl.LUMINANCE,
      gl.UNSIGNED_BYTE,
      crestStrip(line),
    );

    const uTime = gl.getUniformLocation(program, 'uTime');
    const uOpacity = gl.getUniformLocation(program, 'uOpacity');
    const uBand = gl.getUniformLocation(program, 'uBand');
    const uTint = gl.getUniformLocation(program, 'uTint');

    gl.uniform1i(gl.getUniformLocation(program, 'uCrest'), 0);
    gl.uniform1f(uBand, 0.58);

    const [red, green, blue] = parseTint(tint);
    gl.uniform3f(uTint, red / 255, green / 255, blue / 255);
    gl.uniform1f(uOpacity, 0.82);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const still =
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let frame = 0;
    const started = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(
        1,
        Math.min(RenderWidthCap, Math.round(rect.width * RenderScale)),
      );
      const height = Math.max(
        1,
        Math.round(rect.height * (width / Math.max(1, rect.width))),
      );

      if (canvas.width === width && canvas.height === height) return;

      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const render = (seconds: number) => {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, seconds);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    /* light and dark are not the same picture: the shader needs to know */
    const uLight = gl.getUniformLocation(program, 'uLight');
    const readTheme = () =>
      document.documentElement.classList.contains('dark') ? 0 : 1;
    let light = readTheme();
    gl.uniform1f(uLight, light);
    const themeWatch = new MutationObserver(() => {
      const next = readTheme();
      if (next === light) return;
      light = next;
      gl.uniform1f(uLight, light);
      render(still ? 6.2 : (performance.now() - started) / 1000);
    });
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    const loop = () => {
      render(still ? 6.2 : (performance.now() - started) / 1000);
      frame = requestAnimationFrame(loop);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    resize();

    if (still) {
      render(6.2);
    } else {
      frame = requestAnimationFrame(loop);
    }

    return () => {
      themeWatch.disconnect();
      cancelAnimationFrame(frame);
      observer.disconnect();
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [line, tint]);

  return <canvas ref={canvasRef} className="trend-cloud" aria-hidden="true" />;
}