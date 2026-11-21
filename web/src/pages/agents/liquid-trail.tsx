import { useLayoutEffect, useRef } from 'react';

import './liquid-trail.css';

// 网格上的一层 WebGL 液体，机理照顶部导航栏（gooey-nav）的切换效果：
// 把卡片液面当成一池液体，指针带着液滴走的时候，从液面里“抽”出一根液丝——
// 液丝是一串由粗到细的锥形胶囊，根始终钉在卡片液面上（不断开），
// 所以看上去一直连着原液体；落进另一张卡片时整串往入口里收缩、半径归零，
// 那张卡的液面同时鼓一下再回弹（质量转移）。
const MAX_DROPS = 24;
const MAX_CARDS = 16;
// 融合半径：越小越分得开，越不会糊成一坨
const SMOOTH = 16;
// 液滴半径 = 卡片高度 × 这个比例（卡片 118px → 头约 12px，比卡片液面细）
const DROP_RATIO = 0.115;
// 液丝由几节组成（头 + 颈 + 根）
const LINKS = 5;
// 每节之间的间隔：指针停下时液丝还是保持这个长度
const TRAIL_GAP = 38;
// 卡片表面那一端的粗细上限，保证溢出的液体比卡片液面细
const ROOT_RADIUS = 5.2;
// 液丝拉长时的收细范围
const THIN_NEAR = 30;
const THIN_FAR = 240;
const THIN_FLOOR = 0.55;
const EMERGE_TIME = 0.14;
// 出口处的“开口”半径：让液丝能画进卡片内部一点，
// 把卡片液面凹进去的那道缝糊住（同色，看不出叠了一层）
const SEAL_RADIUS = 30;
const ABSORB_TIME = 0.26;
// 质量弹簧（和导航栏同一组参数）
const ZETA = 0.72;

const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT = `#version 300 es
precision highp float;

#define MAX_CARDS 16
#define MAX_DROPS 24

uniform vec2 uSize;
uniform float uRatio;
uniform vec4 uCards[MAX_CARDS];
uniform int uCardCount;
uniform vec4 uDrops[MAX_DROPS];
uniform vec4 uRoots[MAX_DROPS];
uniform int uDropCount;
uniform float uSmooth;
uniform vec3 uInk;
// 落液时贴在卡片边上的那团液体：xy 位置、z 半径
uniform vec4 uEntry;
// 液丝出口处给卡片开的小口：xy 位置、z 半径
uniform vec4 uSeal;

out vec4 outColor;

float sdCard(vec2 p, vec4 card) {
  vec2 q = abs(p - card.xy) - card.zw + 18.0;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 18.0;
}

float smoothMin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// 两头半径不同的锥形胶囊：液丝就是靠它一节一节接起来
float sdRoundCone(vec2 p, vec2 a, vec2 b, float r1, float r2) {
  vec2 ba = b - a;
  float l2 = max(dot(ba, ba), 1e-4);
  float rr = r1 - r2;
  float a2 = l2 - rr * rr;
  float il2 = 1.0 / l2;
  vec2 pa = p - a;
  float y = dot(pa, ba);
  float z = y - l2;
  float x2 = dot(pa * l2 - ba * y, pa * l2 - ba * y);
  float y2 = y * y * l2;
  float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y * uRatio - gl_FragCoord.y) / uRatio;

  // 卡片自己就是实心液面：落在卡片里的部分不画（底下本来就是同一片白色）
  float cardD = 1e5;
  for (int i = 0; i < MAX_CARDS; i++) {
    if (i >= uCardCount) break;
    cardD = min(cardD, sdCard(p, uCards[i]));
  }
  float mask = smoothstep(-1.2, 1.2, cardD);
  // 出口周围允许画到卡片里面，液丝才能和卡片液面真的连上
  if (uSeal.z > 0.5) {
    mask = max(mask, 1.0 - smoothstep(uSeal.z * 0.55, uSeal.z, length(p - uSeal.xy)));
  }

  float d = 1e5;
  for (int i = 0; i < MAX_DROPS; i++) {
    if (i >= uDropCount) break;
    vec4 drop = uDrops[i];
    if (drop.z <= 0.35) continue;
    float shape = length(p - drop.xy) - drop.z;
    vec4 root = uRoots[i];
    if (root.w > 0.5) {
      shape = min(shape, sdRoundCone(p, drop.xy, root.xy, drop.z, max(root.z, 0.5)));
    }
    d = smoothMin(d, shape, uSmooth);
  }

  if (uEntry.z > 0.35) {
    d = smoothMin(d, length(p - uEntry.xy) - uEntry.z, uSmooth);
  }

  float aa = max(fwidth(d), 0.6);
  float body = clamp(0.5 - d / aa, 0.0, 1.0) * mask;
  outColor = vec4(uInk * body, body);
}
`;

const compileShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
};

const parseRgb = (value: string) => {
  const match = /rgba?\(([^)]+)\)/i.exec(value);
  if (!match) return [0.96, 0.96, 0.96];
  const parts = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) {
    return [0.96, 0.96, 0.96];
  }
  return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
};

type Point = { x: number; y: number };

type CardBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  el: Element;
};

// 液丝上的一节：前面的（i 大的）追指针，后面的接在前一节上
type Node = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  // 半径系数（0..1，最小的那节贴着卡片表面）
  weight: number;
  // 当前半径
  r: number;
  // 这一节接在哪（前一节，或者卡片液面里的固定点）
  root: Point;
  // 落液瞬间相对入口的偏移：收进去的时候沿这个方向被吞掉，形状不散
  offset: Point;
  rootR: number;
  // 0..1
  emerged: number;
  absorbed: number;
  delay: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const insideBox = (box: CardBox, x: number, y: number) =>
  x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

// 从卡片里的一点朝指针方向穿过卡片表面：液体就是从这里被拔出来的
const edgeMouth = (box: CardBox, from: Point, toward: Point): Point => {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  let hit = length;
  if (ux > 1e-4) hit = Math.min(hit, (box.right - from.x) / ux);
  else if (ux < -1e-4) hit = Math.min(hit, (box.left - from.x) / ux);
  if (uy > 1e-4) hit = Math.min(hit, (box.bottom - from.y) / uy);
  else if (uy < -1e-4) hit = Math.min(hit, (box.top - from.y) / uy);
  return { x: from.x + ux * hit, y: from.y + uy * hit };
};

// 把出口往卡片里面推一点：卡片液面的可见边界比外框要缩进几个像素，
// 液丝如果刚好停在外框上就会看到一条缝。
const intoCard = (mouth: Point, toward: Point, distance: number): Point => {
  const dx = toward.x - mouth.x;
  const dy = toward.y - mouth.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: mouth.x + (dx / length) * distance, y: mouth.y + (dy / length) * distance };
};

export function LiquidTrail({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
    });
    if (!gl) return;

    const program = gl.createProgram();
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!program || !vertex || !fragment) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const loc = {
      size: uniform('uSize'),
      ratio: uniform('uRatio'),
      cards: uniform('uCards'),
      cardCount: uniform('uCardCount'),
      drops: uniform('uDrops'),
      roots: uniform('uRoots'),
      dropCount: uniform('uDropCount'),
      smooth: uniform('uSmooth'),
      ink: uniform('uInk'),
      entry: uniform('uEntry'),
      seal: uniform('uSeal'),
    };

    const nodeData = new Float32Array(MAX_DROPS * 4);
    const rootData = new Float32Array(MAX_DROPS * 4);
    const cardData = new Float32Array(MAX_CARDS * 4);

    let liquids: CardBox[] = [];
    // 网格里所有卡片（模板卡也要挡住液体，不能把别人的卡盖住）
    let blockers: CardBox[] = [];
    let cardsAt = 0;
    let ink = parseRgb(getComputedStyle(canvas).color);
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const view = { width: 1, height: 1 };

    let nodes: Node[] = [];
    // 卡片液面上那个固定的“出口”，液丝从头到尾都钉在这里
    let mouth: Point | null = null;
    let pointer: Point = { x: 0, y: 0 };
    let source: CardBox | null = null;
    let lastInside: { point: Point; card: CardBox } | null = null;
    let sink: CardBox | null = null;
    // 落液时的那团液体：位置 + 半径 + 已经过了多久
    let entry: Point | null = null;
    let entryAge = 0;
    let entryR = 0;
    let clock = 0;
    let raf = 0;
    let last = 0;
    let painted: { x0: number; y0: number; x1: number; y1: number } | null =
      null;

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      view.width = Math.max(1, rect.width);
      view.height = Math.max(1, rect.height);
      const width = Math.max(1, Math.round(view.width * ratio));
      const height = Math.max(1, Math.round(view.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      painted = null;
    };

    const readCards = () => {
      const grid = canvas.parentElement?.firstElementChild;
      const nodesInGrid = grid ? Array.from(grid.children) : [];
      const rect = canvas.getBoundingClientRect();
      liquids = [];
      blockers = [];
      for (const node of nodesInGrid) {
        const box = node.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;
        const entry = {
          left: box.left - rect.left,
          top: box.top - rect.top,
          right: box.right - rect.left,
          bottom: box.bottom - rect.top,
          el: node,
        };
        blockers.push(entry);
        if (node.classList.contains('liquid-agent')) liquids.push(entry);
      }
      cardsAt = performance.now();
    };

    const clearAll = () => {
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      painted = null;
    };

    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      nodes = [];
      mouth = null;
      entry = null;
      entryAge = 0;
      entryR = 0;
      source = null;
      lastInside = null;
      sink = null;
      clearAll();
    };

    const cardHeight = () => {
      const card = liquids[0];
      return card ? card.bottom - card.top : 118;
    };

    const render = () => {
      let count = 0;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const node of nodes) {
        if (node.delay > 0 || node.r <= 0.35) continue;
        if (count >= MAX_DROPS) break;
        nodeData[count * 4] = node.x;
        nodeData[count * 4 + 1] = node.y;
        nodeData[count * 4 + 2] = node.r;
        nodeData[count * 4 + 3] = 0;
        rootData[count * 4] = node.root.x;
        rootData[count * 4 + 1] = node.root.y;
        rootData[count * 4 + 2] = Math.max(0.5, node.rootR);
        rootData[count * 4 + 3] = 1;
        const pad = Math.max(node.r, node.rootR);
        x0 = Math.min(x0, node.x - node.r, node.root.x - pad);
        y0 = Math.min(y0, node.y - node.r, node.root.y - pad);
        x1 = Math.max(x1, node.x + node.r, node.root.x + pad);
        y1 = Math.max(y1, node.y + node.r, node.root.y + pad);
        count += 1;
      }
      nodeData.fill(0, count * 4);
      rootData.fill(0, count * 4);

      // 出口开口也要算进包围盒
      if (mouth) {
        x0 = Math.min(x0, mouth.x - SEAL_RADIUS);
        y0 = Math.min(y0, mouth.y - SEAL_RADIUS);
        x1 = Math.max(x1, mouth.x + SEAL_RADIUS);
        y1 = Math.max(y1, mouth.y + SEAL_RADIUS);
      }

      // 落液那团液体也算进包围盒
      if (entry && entryR > 0.35) {
        x0 = Math.min(x0, entry.x - entryR);
        y0 = Math.min(y0, entry.y - entryR);
        x1 = Math.max(x1, entry.x + entryR);
        y1 = Math.max(y1, entry.y + entryR);
      }

      if (!count && entryR <= 0.35) {
        if (painted) clearAll();
        return;
      }

      const cardCount = Math.min(blockers.length, MAX_CARDS);
      for (let i = 0; i < cardCount; i++) {
        const card = blockers[i];
        cardData[i * 4] = (card.left + card.right) / 2;
        cardData[i * 4 + 1] = (card.top + card.bottom) / 2;
        cardData[i * 4 + 2] = (card.right - card.left) / 2;
        cardData[i * 4 + 3] = (card.bottom - card.top) / 2;
      }
      cardData.fill(0, cardCount * 4);

      gl.uniform2f(loc.size, view.width, view.height);
      gl.uniform1f(loc.ratio, ratio);
      gl.uniform4fv(loc.cards, cardData);
      gl.uniform1i(loc.cardCount, cardCount);
      gl.uniform4fv(loc.drops, nodeData);
      gl.uniform4fv(loc.roots, rootData);
      gl.uniform1i(loc.dropCount, count);
      gl.uniform1f(loc.smooth, SMOOTH);
      gl.uniform3fv(loc.ink, ink);
      gl.uniform4f(loc.entry, entry ? entry.x : 0, entry ? entry.y : 0, entryR, 0);
      gl.uniform4f(
        loc.seal,
        mouth ? mouth.x : 0,
        mouth ? mouth.y : 0,
        mouth ? SEAL_RADIUS : 0,
        0,
      );

      // 只光栅化这一帧的包围盒（和上一帧的并起来），不整屏重画
      const pad = SMOOTH + 6;
      const box = {
        x0: Math.floor((Math.min(x0, painted ? painted.x0 : x0) - pad) * ratio),
        y0: Math.floor((Math.min(y0, painted ? painted.y0 : y0) - pad) * ratio),
        x1: Math.ceil((Math.max(x1, painted ? painted.x1 : x1) + pad) * ratio),
        y1: Math.ceil((Math.max(y1, painted ? painted.y1 : y1) + pad) * ratio),
      };
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(
        box.x0,
        canvas.height - box.y1,
        Math.max(1, box.x1 - box.x0),
        Math.max(1, box.y1 - box.y0),
      );
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      painted = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    };

    // 从卡片液面上长出一串液丝：根钉在 mouth，头追指针
    const emit = (at: Point) => {
      const radius = cardHeight() * DROP_RATIO;
      mouth = at;
      nodes = [];
      for (let i = 0; i < LINKS; i += 1) {
        const weight = 0.34 + 0.66 * Math.pow(i / (LINKS - 1), 0.75);
        nodes.push({
          x: at.x,
          y: at.y,
          vx: 0,
          vy: 0,
          weight,
          r: radius * weight,
          root: { x: at.x, y: at.y },
          offset: { x: 0, y: 0 },
          rootR: ROOT_RADIUS,
          emerged: 0,
          absorbed: 0,
          delay: (LINKS - 1 - i) * 0.02,
        });
      }
    };

    const receive = (box: CardBox, at: Point) => {
      const el = box.el as HTMLElement;
      el.classList.remove('liquid-agent--receive');
      el.style.setProperty('--liquid-receive-x', (at.x - box.left).toFixed(1) + 'px');
      el.style.setProperty('--liquid-receive-y', (at.y - box.top).toFixed(1) + 'px');
      // 强制回流，让连续两次落液也能重新播动画
      void el.getBoundingClientRect();
      el.classList.add('liquid-agent--receive');
      window.setTimeout(() => {
        el.classList.remove('liquid-agent--receive');
      }, 680);
    };

    const advance = (now: number) => {
      if (!last) last = now;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      clock += dt;
      if (now - cardsAt > 500) readCards();

      const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / steps;
      const radius = cardHeight() * DROP_RATIO;

      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (node.delay > 0) {
          node.delay = Math.max(0, node.delay - dt);
          if (!sink) {
            // 还没出场时贴着卡片表面
            node.x = node.root.x;
            node.y = node.root.y;
            continue;
          }
        }
        node.emerged = Math.min(1, node.emerged + dt / EMERGE_TIME);

        // 前面一节的位置就是这个节点的根：液丝因此永远不断
        if (i > 0) {
          const prev = nodes[i - 1];
          node.root = { x: prev.x, y: prev.y };
        } else if (mouth) {
          node.root = { x: mouth.x, y: mouth.y };
        }

        if (sink) {
          // 整根液丝沿各自相对入口的方向被吞进去：形状一路缩到入口，
          // 不会先在最粗的那一节缩成一个悬空的球。
          if (node.delay <= 0) {
            node.absorbed = Math.min(1, node.absorbed + dt / ABSORB_TIME);
          }
          const eat = 1 - Math.pow(1 - node.absorbed, 2.2);
          const center = mouth ?? node.root;
          node.x = center.x + node.offset.x * (1 - eat);
          node.y = center.y + node.offset.y * (1 - eat);
          node.vx = 0;
          node.vy = 0;
          node.r = radius * node.weight * (1 - node.absorbed);
          node.rootR =
            i === 0
              ? Math.max(1.2, ROOT_RADIUS * (1 - node.absorbed))
              : Math.max(1.2, nodes[i - 1].r * 0.86);
          continue;
        }

        // 目标：指针身后第 i 个位置
        const back = (LINKS - 1 - i) * TRAIL_GAP;
        const dx = pointer.x - node.x;
        const dy = pointer.y - node.y;
        const far = Math.hypot(dx, dy) || 1;
        const tx = pointer.x - (dx / far) * back;
        const ty = pointer.y - (dy / far) * back;
        const omega = 12 + 26 * (i / Math.max(1, LINKS - 1));
        for (let n = 0; n < steps; n += 1) {
          node.vx += (omega * omega * (tx - node.x) - 2 * ZETA * omega * node.vx) * h;
          node.vy += (omega * omega * (ty - node.y) - 2 * ZETA * omega * node.vy) * h;
          node.x += node.vx * h;
          node.y += node.vy * h;
        }

        // 拉得越长越细：液丝被拽出来的那种紧绷感
        const stretched = Math.hypot(node.x - node.root.x, node.y - node.root.y);
        const thin = clamp(
          1 - (stretched - THIN_NEAR) / (THIN_FAR - THIN_NEAR),
          THIN_FLOOR,
          1,
        );
        // 头端那颗是液滴本体，不完全跟着拉细，不然只剩一根线
        const soften = i === nodes.length - 1 ? 0.82 + 0.18 * thin : thin;
        node.r = radius * node.weight * node.emerged * soften;
        node.rootR =
          i === 0
            ? Math.max(2.2, ROOT_RADIUS * thin)
            : Math.max(2.2, nodes[i - 1].r * 0.86);
      }

      if (entry) {
        entryAge += dt;
        const t = Math.min(1, entryAge / 0.42);
        entryR = 15 * Math.sin(t * Math.PI);
      }

      render();

      const done =
        nodes.length > 0 &&
        nodes.every((node) => node.absorbed >= 1) &&
        (!entry || entryR < 0.5);
      if (done) {
        stop();
      } else if (nodes.length) {
        raf = requestAnimationFrame(frame);
      }
    };

    const frame = (now: number) => {
      raf = 0;
      try {
        advance(now);
      } catch {
        // 单帧算错不该把整条动画链弄死
        stop();
      }
    };

    const wake = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const beginDrag = (from: Point, card: CardBox, toward: Point) => {
      readCards();
      source = card;
      sink = null;
      emit(intoCard(edgeMouth(card, from, toward), from, 10));
      wake();
    };

    // 指针进入一张卡片：液丝整串往入口里收，那张卡的液面鼓起一团再回弹
    const land = (card: CardBox, from: Point, toward: Point) => {
      if (!nodes.length) return;
      const edge = edgeMouth(card, from, toward);
      const at = intoCard(edge, from, 10);
      mouth = at;
      sink = card;
      entry = edge;
      entryAge = 0;
      entryR = 0;
      for (let i = 0; i < nodes.length; i += 1) {
        nodes[i].delay = (LINKS - 1 - i) * 0.045;
        nodes[i].offset = { x: nodes[i].x - at.x, y: nodes[i].y - at.y };
      }
      if (card !== source && liquids.includes(card)) receive(card, at);
      wake();
    };

    const handleMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX;
      const y = event.clientY;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        if (nodes.length) stop();
        return;
      }
      if (performance.now() - cardsAt > 500) readCards();
      const local: Point = { x: x - rect.left, y: y - rect.top };
      pointer = local;

      const overCard = blockers.find((card) => insideBox(card, local.x, local.y));
      if (overCard) {
        const isLiquid = liquids.includes(overCard);
        if (nodes.length && !sink) {
          // 回到卡片里：液丝从这里被吸回去
          land(overCard, local, local);
        }
        if (isLiquid) lastInside = { point: local, card: overCard };
        return;
      }

      if (sink) return;

      // 刚离开卡片：从卡片液面把液体抽出来
      if (!lastInside) return;
      if (!nodes.length) {
        if (Math.hypot(local.x - lastInside.point.x, local.y - lastInside.point.y) > 120) return;
        beginDrag(lastInside.point, lastInside.card, local);
      }
    };

    const handleOut = (event: PointerEvent) => {
      if (!event.relatedTarget && nodes.length) stop();
    };

    const handleScroll = () => {
      readCards();
      if (nodes.length) stop();
    };

    const handleTheme = () => {
      ink = parseRgb(getComputedStyle(canvas).color);
      painted = null;
    };

    const observer = new ResizeObserver(() => {
      measure();
      if (!nodes.length) clearAll();
    });
    observer.observe(canvas);
    const themeObserver = new MutationObserver(handleTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    window.addEventListener('pointermove', handleMove, { passive: true });
    window.addEventListener('pointerout', handleOut);
    window.addEventListener('pointercancel', handleOut);
    const scrollHost = canvas.parentElement;
    scrollHost?.addEventListener('scroll', handleScroll, { passive: true });

    measure();
    readCards();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      themeObserver.disconnect();
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerout', handleOut);
      window.removeEventListener('pointercancel', handleOut);
      scrollHost?.removeEventListener('scroll', handleScroll);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas ref={canvasRef} className={`liquid-trail ${className}`.trim()} aria-hidden />;
}
