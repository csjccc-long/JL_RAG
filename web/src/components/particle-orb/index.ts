/**
 * A node "orb": a sphere of stippled dust, the way a point-cloud planet reads
 * against a dark field — crisp specks, denser at the limb, holes in between.
 * Sprites are generated at the size they are drawn at, so the specks stay one
 * or two pixels instead of blurring into a grey ball when scaled down.
 */

type Rgb = [number, number, number];

const CACHE = new Map<string, HTMLCanvasElement>();

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const hexToRgb = (hex: string): Rgb => {
  let value = hex.replace('#', '');
  if (value.length === 3) {
    value = value
      .split('')
      .map((part) => part + part)
      .join('');
  }
  const parsed = Number.parseInt(value, 16);
  if (Number.isNaN(parsed)) return [150, 150, 158];
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
};

const mix = (base: Rgb, target: Rgb, amount: number): Rgb => [
  Math.round(base[0] + (target[0] - base[0]) * amount),
  Math.round(base[1] + (target[1] - base[1]) * amount),
  Math.round(base[2] + (target[2] - base[2]) * amount),
];

const hashSeed = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Sprites are built per size bucket so a speck is always roughly 1-2px. */
const bucketOf = (diameter: number) => {
  const bucket = Math.round(clamp(diameter, 10, 220) / 4) * 4;
  return clamp(bucket, 12, 220);
};

/** Sprites are cheap but not free: keep the working set bounded per session. */
const CACHE_LIMIT = 220;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const orbSprite = (
  color: string,
  dark: boolean,
  diameter: number,
): HTMLCanvasElement | null => {
  if (typeof document === 'undefined') return null;
  const size = bucketOf(diameter);
  const key = color + '|' + (dark ? 'd' : 'l') + '|' + size;
  const cached = CACHE.get(key);
  if (cached) return cached;

  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext('2d');
  if (!ctx) return null;

  const center = size / 2;
  const radius = center * 0.94;
  const base = hexToRgb(color);
  // Specks are near-white on dark, near-black on light, tinted by the node hue
  const bright = mix(base, dark ? [255, 255, 255] : [18, 18, 24], dark ? 0.74 : 0.68);
  const mid = mix(base, dark ? [238, 242, 250] : [40, 40, 48], dark ? 0.56 : 0.5);
  const dim = mix(base, dark ? [188, 196, 210] : [76, 76, 86], dark ? 0.36 : 0.34);

  // a whisper of body so a tiny node still reads as a sphere, never as a disc
  const body = ctx.createRadialGradient(center, center, 0, center, center, radius);
  body.addColorStop(0, 'rgba(' + base[0] + ',' + base[1] + ',' + base[2] + ',' + (dark ? 0.11 : 0.06) + ')');
  body.addColorStop(0.86, 'rgba(' + base[0] + ',' + base[1] + ',' + base[2] + ',' + (dark ? 0.07 : 0.04) + ')');
  body.addColorStop(1, 'rgba(' + base[0] + ',' + base[1] + ',' + base[2] + ',0)');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fill();

  const random = seededRandom(hashSeed(color + size + (dark ? 'd' : 'l')));
  const count = clamp(Math.round(size * size * 0.16), 40, 3200);
  const speck = clamp(size * 0.0056, 0.26, 1.05);

  // Snapping each speck to whole pixels keeps the dust crisp; smoothed
  // sub-pixel dots are what turned the old orbs into grey cotton balls.
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * GOLDEN_ANGLE + random() * 0.6;
    const shell = 0.88 + random() * 0.12;
    const x = Math.cos(theta) * ring * shell;
    const z = Math.sin(theta) * ring * shell;
    const yy = y * shell;
    const depth = clamp((z + 1) / 2, 0, 1);
    const limb = 1 - Math.min(1, Math.abs(z) / 0.5);

    const sparkle = random() < 0.1;
    const raw = speck * (0.6 + random() * 0.8 + (sparkle ? 0.7 : 0)) * (1 + limb * 0.2);
    const pointSize = raw < 0.85 ? 1 : Math.round(raw);
    const alpha = clamp(
      (dark ? 0.42 : 0.52) + random() * 0.3 + (sparkle ? 0.2 : 0) - (1 - depth) * 0.12,
      0.24,
      1,
    );
    const tone = depth > 0.3 ? bright : depth > 0.05 ? mid : dim;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(' + tone[0] + ',' + tone[1] + ',' + tone[2] + ',1)';
    const px = Math.round(center + x * radius - pointSize / 2);
    const py = Math.round(center - yy * radius - pointSize / 2);
    ctx.fillRect(px, py, pointSize, pointSize);
  }

  // dust inside the volume: without it the ball reads as a hollow shell
  const inner = Math.round(count * 0.22);
  for (let i = 0; i < inner; i++) {
    const y = 1 - 2 * random();
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = random() * Math.PI * 2;
    const depthRadius = Math.pow(random(), 0.55) * 0.92;
    const x = Math.cos(theta) * ring * depthRadius;
    const z = Math.sin(theta) * ring * depthRadius;
    const yy = y * depthRadius;
    const depth = clamp((z + 1) / 2, 0, 1);
    const tone = depth > 0.4 ? mid : dim;
    ctx.globalAlpha = 0.16 + random() * 0.26;
    ctx.fillStyle = 'rgba(' + tone[0] + ',' + tone[1] + ',' + tone[2] + ',1)';
    ctx.fillRect(
      Math.round(center + x * radius),
      Math.round(center - yy * radius),
      random() < 0.75 ? 1 : 2,
      1,
    );
  }

  ctx.globalAlpha = 1;
  // loose dust just outside the limb so the edge is not a cut disc
  for (let i = 0; i < Math.round(count * 0.05); i++) {
    const angle = random() * Math.PI * 2;
    const spread = radius * (1.01 + random() * 0.07);
    const pointSize = random() < 0.5 ? 1 : 2;
    ctx.globalAlpha = 0.16 + random() * 0.26;
    ctx.fillStyle = 'rgba(' + mid[0] + ',' + mid[1] + ',' + mid[2] + ',1)';
    ctx.fillRect(
      Math.round(center + Math.cos(angle) * spread),
      Math.round(center + Math.sin(angle) * spread),
      pointSize,
      pointSize,
    );
  }
  ctx.globalAlpha = 1;

  if (CACHE.size >= CACHE_LIMIT) {
    const oldest = CACHE.keys().next().value;
    if (oldest) CACHE.delete(oldest);
  }
  CACHE.set(key, sprite);
  return sprite;
};