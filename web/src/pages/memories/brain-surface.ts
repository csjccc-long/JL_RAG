const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uScale;
uniform float uYaw;
uniform float uPitch;
uniform float uZoom;
uniform float uDark;
uniform float uTime;
out vec4 outColor;

mat2 rot2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-4);
}

// smooth minimum keeps the lobes one continuous surface
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float smax(float a, float b, float k) { return -smin(-a, -b, k); }

float hash13(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// the gyrus network: the zero set of three warped sine trains draws the thin
// sulci, and the same field dents the surface so the lines sit in real grooves
float sulci(vec3 p) {
  float a = sin(p.x * 15.5 + 1.30 * sin(p.y * 10.4 + 1.00 * sin(p.z * 7.8)));
  float b = sin(p.y * 16.5 + 1.35 * sin(p.z * 11.2 + 1.05 * sin(p.x * 8.2)));
  float c = sin(p.z * 15.0 + 1.25 * sin(p.x * 10.8 + 0.95 * sin(p.y * 8.0)));
  return (a + b + c) * 0.3333;
}

vec3 toModel(vec3 p) {
  vec3 q = p;
  q.xz = rot2(uYaw) * q.xz;
  q.yz = rot2(uPitch) * q.yz;
  return q;
}

// one cerebral hemisphere: the hull sits on its own side of the midline, so the
// two of them meet in a crease instead of forming a single egg
float hemisphere(vec3 q, float sgn) {
  float d = (length((q - vec3(0.0, 0.0, sgn * 0.300)) / vec3(0.90, 0.72, 0.330)) - 1.0) * 0.58;
  d = smin(d, sdEllipsoid(q - vec3(-0.44, 0.06, sgn * 0.235), vec3(0.52, 0.42, 0.245)), 0.12);
  d = smin(d, sdEllipsoid(q - vec3(0.52, 0.00, sgn * 0.235), vec3(0.40, 0.34, 0.225)), 0.12);
  d = smin(d, sdEllipsoid(q - vec3(-0.02, -0.30, sgn * 0.255), vec3(0.44, 0.22, 0.235)), 0.10);
  return d;
}

float map(vec3 p) {
  vec3 q = toModel(p);
  // left and right hemisphere, joined by a sharp crease at the midline
  float d = min(hemisphere(q, 1.0), hemisphere(q, -1.0));
  // flat base of the cerebrum
  d = smax(d, -0.47 - q.y, 0.17);
  // cerebellum hangs below the base at the back, brainstem below and forward of it
  d = smin(d, sdEllipsoid(q - vec3(0.50, -0.44, 0.0), vec3(0.28, 0.22, 0.30)), 0.06);
  float stem = length(vec2(q.x - 0.34, q.z)) - 0.13;
  d = smin(d, max(max(stem, -0.68 - q.y), q.y + 0.50), 0.10);
  // the longitudinal fissure: a real slot between the hemispheres, open along the
  // whole vault and closed low down where the hemispheres stay joined
  float slot = max(abs(q.z) - 0.026, -(q.y + 0.16));
  d = smax(d, -slot, 0.028);
  // a shallow vermis notch keeps the cerebellum from reading as one smooth bulb
  d += 0.020 * exp(-pow(q.z / 0.045, 2.0)) * smoothstep(-0.30, -0.52, q.y);
  // rounded gyri: seams recessed, crests untouched; cerebellar folia in the bulb
  float sul = sulci(q);
  float seam = 1.0 - abs(sul);
  float cerebMask = smoothstep(-0.18, -0.34, q.y) * smoothstep(0.16, 0.46, q.x);
  float lam = sin(q.x * 52.0 + q.z * 20.0 + q.y * 9.0);
  d += 0.030 * seam * seam * (1.0 - cerebMask) + 0.008 * lam * cerebMask;
  return d * 0.92;
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(0.0012, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)
  ));
}

// cavities (ventricles) and white-matter fibre bundles, seen through the shell
float ventricle(vec3 q) {
  float v1 = sdEllipsoid(q - vec3(-0.10, 0.02, 0.05), vec3(0.26, 0.10, 0.15));
  float v2 = sdEllipsoid(q - vec3(-0.36, 0.06, 0.00), vec3(0.15, 0.075, 0.10));
  float v3 = sdEllipsoid(q - vec3(0.14, -0.02, 0.00), vec3(0.20, 0.085, 0.12));
  return min(min(v1, v2), v3);
}

float fibres(vec3 q) {
  float u = q.y * 7.0 + 1.9 * sin(q.x * 4.0 + 0.6) + 1.1 * sin(q.z * 3.0);
  float v = q.z * 5.4 + 1.4 * sin(q.y * 3.4);
  float w = q.x * 4.6 + 1.1 * sin(q.z * 2.8 + 1.7);
  return sin(u) * 0.52 + sin(v) * 0.30 + sin(w) * 0.18;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - uCenter) / uScale;
  vec3 ro = vec3(0.0, 0.0, 2.55 / uZoom);
  vec3 rd = normalize(vec3(uv * 0.82, -1.55));

  float t = 0.0;
  float hit = -1.0;
  for (int i = 0; i < 108; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.0012) { hit = t; break; }
    t += d * 0.9;
    if (t > 4.2) break;
  }
  if (hit < 0.0) discard;

  vec3 p = ro + rd * hit;
  vec3 n = normalAt(p);
  vec3 v = normalize(ro - p);
  vec3 q = toModel(p);

  float s = sulci(q);
  float ws = max(fwidth(s), 1e-4);
  // widen each line by a slow noise so thick and hairline sulci alternate
  float wmul = (0.95 + 1.05 * abs(sin(q.x * 2.6 + q.z * 1.9 + 0.6 * sin(q.y * 1.7)))) * 1.25;
  float wline = max(ws * wmul, 0.0065);
  float gyrusLine = 1.0 - smoothstep(wline, wline + max(ws * 3.0, 0.010), abs(s));
  float gyrusGlow = 1.0 - smoothstep(0.0, ws * (wmul + 9.0), abs(s));
  float wf2 = max(fwidth(sin(q.x * 44.0 + q.z * 17.0 + q.y * 9.0)), 1e-4);
  float gyrusFine = 1.0 - smoothstep(wf2 * 1.0, wf2 * 3.0, abs(sin(q.x * 44.0 + q.z * 17.0 + q.y * 9.0)));

  vec3 L1 = normalize(vec3(-0.55, 0.62, 0.72));
  vec3 L2 = normalize(vec3(0.7, -0.35, 0.5));
  float dif = clamp(dot(n, L1), 0.0, 1.0);
  float back = clamp(dot(n, L2), 0.0, 1.0);
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.0);
  float spec = pow(clamp(dot(reflect(-L1, n), v), 0.0, 1.0), 52.0);

  vec3 deep = uDark > 0.5 ? vec3(0.010, 0.055, 0.068) : vec3(0.34, 0.68, 0.66);
  vec3 bodyCol = uDark > 0.5 ? vec3(0.020, 0.100, 0.125) : vec3(0.14, 0.48, 0.47);
  vec3 glowCol = uDark > 0.5 ? vec3(0.34, 1.00, 0.95) : vec3(0.02, 0.24, 0.23);
  vec3 rimCol = uDark > 0.5 ? vec3(0.46, 1.00, 0.96) : vec3(0.05, 0.30, 0.30);
  vec3 innerCol = uDark > 0.5 ? vec3(0.20, 0.86, 0.98) : vec3(0.03, 0.30, 0.34);

  vec3 col = mix(deep, bodyCol, dif * 0.7 + back * 0.2);
  if (uDark > 0.5) {
    col += glowCol * (gyrusLine * 1.58 + gyrusGlow * 0.46 + gyrusFine * 0.20) * (0.40 + 0.80 * fres);
    col += rimCol * fres * 0.95;
    col += vec3(1.0) * spec * 0.30;
    // soft highlight roll-off so the thick sulci keep a gradient instead of clipping to white
    col = (col / (1.0 + 0.15 * col)) * 1.06;
  } else {
    // light theme: pale teal body with the sulci inked in a much darker teal
    vec3 ink = vec3(0.03, 0.20, 0.20);
    col = mix(col, ink, clamp(gyrusLine * 0.92 + gyrusGlow * 0.16 + gyrusFine * 0.16, 0.0, 0.95));
    col = mix(col, rimCol, fres * 0.55);
    col += vec3(1.0) * spec * 0.08;
  }

  float alpha = (uDark > 0.5
    ? clamp(0.10 + 0.62 * fres + 0.16 * dif, 0.0, 0.72)
    : clamp(0.88 + 0.10 * fres, 0.0, 1.0));

  // march the interior: cavities, fibre bundles, inner fold lines, dust, haze
  vec3 inside = vec3(0.0);
  for (int i = 0; i < 22; i++) {
    float ti = hit + 0.05 + float(i) * 0.052;
    vec3 pi = ro + rd * ti;
    if (sdEllipsoid(pi, vec3(1.02, 0.78, 0.72)) > 0.0) continue;
    vec3 qi = toModel(pi);
    float fade = exp(-float(i) * 0.085);

    float vd = ventricle(qi);
    float wv = max(fwidth(vd), 1e-4);
    float vsh = 1.0 - smoothstep(wv * 1.2, wv * 4.0, abs(vd));

    float fb = fibres(qi);
    float wfb = max(fwidth(fb), 1e-4);
    float fl = 1.0 - smoothstep(wfb * 0.9, wfb * 2.6, abs(fb));

    float core = sdEllipsoid(qi, vec3(0.70, 0.52, 0.48));
    float wc = max(fwidth(core), 1e-4);
    float csh = 1.0 - smoothstep(wc * 2.0, wc * 6.0, abs(core));

    float isul = abs(sulci(qi * 1.22));
    float wi = max(fwidth(isul), 1e-4);
    float iline = 1.0 - smoothstep(wi * 0.9, wi * 2.8, isul);

    vec3 cell = floor(qi * 52.0);
    vec3 fr = fract(qi * 52.0) - 0.5;
    float speck = (1.0 - smoothstep(0.16, 0.26, length(fr))) * step(0.90, hash13(cell));

    float haze = 0.55 + 0.45 * sin(qi.x * 5.0 + qi.y * 4.2 + qi.z * 3.4);

    inside += glowCol * 0.062 * haze * fade;
    inside += innerCol * (vsh * 1.5 + fl * 0.55 + csh * 0.45 + iline * 0.45) * fade;
    inside += glowCol * speck * 0.30 * fade;
  }

  outColor = vec4(col * alpha + inside * 0.52, alpha);
}
`;

export interface BrainCamera {
  yaw: number;
  pitch: number;
  zoom: number;
}

export interface BrainSurface {
  draw(
    camera: BrainCamera,
    dark: boolean,
    cx: number,
    cy: number,
    radius: number,
  ): void;
  dispose(): void;
}

export function createBrainSurface(
  canvas: HTMLCanvasElement,
): BrainSurface | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
  });
  if (!gl) return null;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const uRes = uniform("uRes");
  const uCenter = uniform("uCenter");
  const uScale = uniform("uScale");
  const uYaw = uniform("uYaw");
  const uPitch = uniform("uPitch");
  const uZoom = uniform("uZoom");
  const uDark = uniform("uDark");
  const uTime = uniform("uTime");

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  return {
    draw(camera, dark, cx, cy, radius) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, w, h);
      gl.uniform2f(uCenter, cx * dpr, (canvas.clientHeight - cy) * dpr);
      gl.uniform1f(uScale, radius * dpr);
      gl.uniform1f(uYaw, camera.yaw - 1.5);
      gl.uniform1f(uPitch, camera.pitch);
      gl.uniform1f(uZoom, camera.zoom);
      gl.uniform1f(uDark, dark ? 1 : 0);
      gl.uniform1f(uTime, performance.now() / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    },
  };
}
