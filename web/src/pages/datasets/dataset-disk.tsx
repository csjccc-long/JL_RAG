import { cn } from '@/lib/utils';
import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';

export interface DatasetDiskProps {
  name: string;
  files: string;
  date: string;
  badge?: ReactNode;
  more?: ReactNode;
  /** Keeps the tray pulled out, for previews and tests. */
  active?: boolean;
  onClick?: () => void;
}

const CARD_H = 220;

function hashSeed(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRng(seed: number) {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothPath(points: [number, number][]) {
  if (points.length < 2) return '';
  let path = 'M ' + points[0][0].toFixed(2) + ' ' + points[0][1].toFixed(2);
  for (let index = 1; index < points.length - 1; index += 1) {
    const midX = (points[index][0] + points[index + 1][0]) / 2;
    const midY = (points[index][1] + points[index + 1][1]) / 2;
    path += ' Q ' + points[index][0].toFixed(2) + ' ' + points[index][1].toFixed(2) + ' ' + midX.toFixed(2) + ' ' + midY.toFixed(2);
  }
  const last = points[points.length - 1];
  return path + ' L ' + last[0].toFixed(2) + ' ' + last[1].toFixed(2);
}

/** Irregular hand-drawn rings that wrap the platter, unique per dataset. */
function buildFiligree(seed: string) {
  const rnd = makeRng(hashSeed(seed));
  const cx = 58;
  const cy = 46;
  const paths: { d: string; accent: boolean }[] = [];
  for (let ring = 0; ring < 4; ring += 1) {
    const base = 40 + ring * 5.4 + rnd() * 2.6;
    const steps = 26;
    const phase = rnd() * Math.PI * 2;
    const amp = 2.2 + rnd() * 2.4;
    const points: [number, number][] = [];
    for (let step = 0; step <= steps; step += 1) {
      const angle = phase + (step / steps) * Math.PI * 1.72;
      const radius = base + Math.sin(angle * 3 + ring) * amp + (rnd() - 0.5) * 1.8;
      points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.94]);
    }
    paths.push({ d: smoothPath(points), accent: ring === 1 });
  }
  for (let squiggle = 0; squiggle < 12; squiggle += 1) {
    const start = rnd() * Math.PI * 2;
    const radius0 = 33 + rnd() * 26;
    const points: [number, number][] = [];
    for (let step = 0; step <= 6; step += 1) {
      const angle = start + step * (0.05 + rnd() * 0.06);
      const radius = radius0 + Math.sin(step * 0.9 + squiggle) * 3.2 + (rnd() - 0.5) * 2;
      points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.94]);
    }
    paths.push({ d: smoothPath(points), accent: squiggle % 3 === 0 });
  }
  return paths;
}

/** Width of the card, so the box can be rebuilt in real pixels when it resizes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.offsetWidth);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * A knowledge base as a matchbox standing on a desk: the sleeve is a box with
 * real thickness and a printed panel, and the tray inside slides out of its open
 * end carrying the drive. Pure CSS 3D, no canvas.
 */
export function DatasetDisk({ name, files, date, badge, more, active = false, onClick }: DatasetDiskProps) {
  const [ref, measured] = useWidth();
  const W = measured || 232;

  const bw = Math.round(Math.min(W * 0.58, 176));
  const bd = Math.round(Math.min(182, bw * 1.34));
  const t = 38;
  const gap = 8;
  const tw = bw - gap * 2;
  const td = bd - gap * 2;
  const tt = 13;
  const slide = Math.max(24, Math.round(Math.min(bw * 0.72, W - bw - 10)));
  const x0 = Math.max(2, Math.round((W - (bw + slide)) / 2));
  const cy = CARD_H * 0.5;

  type FaceSpec = {
    w: number;
    h: number;
    transform: string;
    className?: string;
    style?: CSSProperties;
    children?: ReactNode;
  };

  const faces = (boxW: number, boxH: number, list: FaceSpec[]) =>
    list.map((face, index) => (
      <div
        key={index}
        className={cn('absolute', face.className)}
        style={{
          left: (boxW - face.w) / 2,
          top: (boxH - face.h) / 2,
          width: face.w,
          height: face.h,
          transform: face.transform,
          ...face.style,
        }}
      >
        {face.children}
      </div>
    ));

  const trayZ = 0;

  return (
    <article
      data-testid="dataset-disk"
      data-agent-name={name}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      }}
      className={cn(
        'group group/disk relative h-[220px] w-full cursor-pointer select-none rounded-xl outline-none',
        'focus-visible:ring-2 focus-visible:ring-text-accent hover:z-30',
        '[--dx:0px] hover:[--dx:var(--slide)] focus-visible:[--dx:var(--slide)]',
        active && '[--dx:var(--slide)]',
      )}
      style={{ '--slide': slide + 'px' } as CSSProperties}
    >
      <div ref={ref} className="absolute inset-0">
        {/* the shadow the box casts on the desk, widening as the tray comes out */}
        <div
          className="pointer-events-none absolute rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(150,196,214,0.10),rgba(150,196,214,0.03)_46%,transparent_72%)] blur-[10px]"
          style={{ left: x0 - 10, top: cy + bd * 0.30, width: bw + 20 + slide, height: 74 }}
        />
        <div
          className="pointer-events-none absolute rounded-[50%] bg-black/70 blur-[18px]"
          style={{ left: x0 + 8, top: cy + bd * 0.46, width: bw * 0.88, height: 14 }}
        />
        <div
          className="pointer-events-none absolute"
          style={{
            left: x0 + 10,
            top: cy + bd * 0.47,
            width: bw - 20,
            height: 46,
            background: 'linear-gradient(180deg, rgba(146,170,186,0.20) 0%, rgba(146,170,186,0.06) 40%, transparent 100%)',
            maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.85), transparent 88%)',
            WebkitMaskImage: 'linear-gradient(180deg, rgba(0,0,0,0.85), transparent 88%)',
            filter: 'blur(2px)',
          }}
        />

        <div
          className="absolute inset-0"
          style={{ perspective: Math.round(W * 2.3), perspectiveOrigin: '50% 14%' }}
        >
          <div
            className="absolute left-0"
            style={{ top: cy, width: 0, height: 0, transformStyle: 'preserve-3d', transform: 'rotateX(33deg) rotateY(-13deg)' }}
          >
            {/* tray: the drive sliding out of the open end */}
            <div
              className="absolute transition-transform duration-500 [transition-timing-function:cubic-bezier(.32,.08,.18,1)]"
              style={{
                width: tw,
                height: td,
                transform: 'translate3d(calc(' + x0 + 'px + ' + gap + 'px + var(--dx)), ' + -td / 2 + 'px, ' + (trayZ - tt / 2) + 'px)',
                transformStyle: 'preserve-3d',
              }}
            >
              {faces(tw, td, [
                {
                  w: tw,
                  h: td,
                  transform: 'translateZ(' + tt / 2 + 'px)',
                  className: 'overflow-hidden rounded-[2px]',
                  style: {
                    background: 'linear-gradient(158deg,#6d757e 0%,#484f57 26%,#2f353b 62%,#4a5158 86%,#23282d 100%)',
                    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16), inset 0 0 0 3px rgba(0,0,0,0.55)',
                  },
                  children: <TrayFace tw={tw} td={td} files={files} name={name} active={active} />,
                },
                {
                  w: tw,
                  h: tt,
                  transform: 'translateY(' + td / 2 + 'px) rotateX(-90deg)',
                  style: { background: 'linear-gradient(180deg,#3f464d,#14181c)' },
                },
                {
                  w: tt,
                  h: td,
                  transform: 'translateX(' + tw / 2 + 'px) rotateY(90deg)',
                  className: 'overflow-hidden',
                  style: {
                    background: 'linear-gradient(90deg,#20252a,#3f464d 40%,#22272c 74%,#0d1013)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.24)',
                  },
                  children: null,
                },
                {
                  w: tw,
                  h: tt,
                  transform: 'translateY(' + -td / 2 + 'px) rotateX(90deg)',
                  style: { background: 'linear-gradient(180deg,#262b30,#0b0e11)' },
                },
              ])}
            </div>

            {/* sleeve: a printed box with thickness, open on the right */}
            <div
              className="absolute"
              style={{
                width: bw,
                height: bd,
                transform: 'translate3d(' + x0 + 'px, ' + -bd / 2 + 'px, 0)',
                transformStyle: 'preserve-3d',
              }}
            >
              {faces(bw, bd, [
                {
                  w: bw,
                  h: t,
                  transform: 'translateY(' + -bd / 2 + 'px) rotateX(90deg)',
                  style: {
                    background: 'linear-gradient(180deg,#6f7883 0%,#49515a 34%,#262c32 100%)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
                  },
                },
                {
                  w: bw,
                  h: t,
                  transform: 'translateY(' + bd / 2 + 'px) rotateX(-90deg)',
                  style: { background: 'linear-gradient(180deg,#2a3036,#0c0f12)' },
                },
                {
                  w: t,
                  h: bd,
                  transform: 'translateX(' + -bw / 2 + 'px) rotateY(90deg)',
                  style: { background: 'linear-gradient(90deg,#0c0f12,#4a525b 52%,#191e24)' },
                },
                {
                  w: t,
                  h: bd,
                  transform: 'translateX(' + bw / 2 + 'px) rotateY(90deg)',
                  style: {
                    background: 'linear-gradient(90deg,#04060a,#1b2025 42%,#080b0e)',
                    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.9)',
                  },
                },
                {
                  w: bw - 12,
                  h: bd - 12,
                  transform: 'translateZ(' + (trayZ - 1) + 'px)',
                  style: { background: 'rgba(0,0,0,0.72)' },
                },
                {
                  w: bw,
                  h: bd,
                  transform: 'translateZ(' + t / 2 + 'px)',
                  className: 'overflow-hidden rounded-[2px]',
                  children: <SleeveFace name={name} files={files} date={date} badge={badge} more={more} />,
                },
                {
                  w: 6,
                  h: bd - 10,
                  transform: 'translateX(' + (bw / 2 - 5) + 'px) translateZ(' + (t / 2 + 0.5) + 'px)',
                  style: {
                    background: 'linear-gradient(90deg, rgba(0,0,0,0.6), rgba(0,0,0,0.22) 55%, transparent)',
                  },
                },
              ])}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function TrayFace({ tw, td, files, name, active }: { tw: number; td: number; files: string; name: string; active: boolean }) {
  const size = Math.round(Math.min(tw * 0.72, td * 0.64));
  const filigree = buildFiligree(name);
  return (
    <div className="absolute inset-0">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 3px)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(148deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.02) 30%, transparent 52%, rgba(0,0,0,0.35) 100%)',
        }}
      />

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ filter: 'drop-shadow(0 0 2px rgba(0, 196, 182, 0.45))' }}
        aria-hidden
      >
        {filigree.map((ring, index) => (
          <g key={index}>
            <path
              d={ring.d}
              fill="none"
              stroke={ring.accent ? 'rgba(0, 214, 198, 0.78)' : 'rgba(204, 236, 240, 0.46)'}
              strokeWidth={ring.accent ? 0.6 : 0.44}
              strokeLinecap="round"
            />
            {/* a spark that runs the groove, so the etching keeps catching the light */}
            <path
              d={ring.d}
              fill="none"
              className="filigree-flow"
              stroke={ring.accent ? 'rgba(170, 255, 248, 1)' : 'rgba(226, 255, 252, 0.8)'}
              strokeWidth={ring.accent ? 0.8 : 0.62}
              strokeLinecap="round"
              strokeDasharray="7 150"
              style={{
                animationDuration: 6 + index * 0.7 + 's',
                animationDelay: index * 0.55 + 's',
              }}
            />
          </g>
        ))}
      </svg>

      <div
        className="absolute rounded-full"
        style={{
          width: size,
          height: size,
          left: '56%',
          top: '44%',
          transform: 'translate(-50%, -50%)',
          background:
            'radial-gradient(circle at 30% 24%, #ffffff 0%, #e8eff3 9%, #c0cad1 24%, #8d979f 44%, #59626a 66%, #262b30 92%)',
          boxShadow:
            'inset 0 0 0 1px rgba(255,255,255,0.4), inset 0 0 0 3px rgba(0,0,0,0.45), 0 5px 12px rgba(0,0,0,0.65)',
        }}
      >
        <div
          className={cn('absolute inset-0 rounded-full mix-blend-screen', 'group-hover/disk:animate-vinyl-spin', active && 'animate-vinyl-spin')}
          style={{
            backgroundImage:
              'conic-gradient(from 20deg, rgba(255,255,255,0.45) 0deg, transparent 28deg, rgba(255,255,255,0.22) 62deg, transparent 104deg, rgba(255,255,255,0.4) 148deg, transparent 196deg, rgba(255,255,255,0.28) 244deg, transparent 300deg, rgba(255,255,255,0.4) 360deg)',
          }}
        />
        <div
          className="absolute inset-[2px] rounded-full opacity-55"
          style={{
            backgroundImage:
              'repeating-radial-gradient(circle at center, rgba(255,255,255,0.3) 0 0.5px, rgba(0,0,0,0.2) 0.5px 1px, transparent 1px 3px)',
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: size * 0.34,
            height: size * 0.34,
            transform: 'translate(-50%, -50%)',
            background: 'radial-gradient(circle at 34% 28%, #aeb8bf, #5d666d 52%, #22272b 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.3), inset 0 0 0 3px rgba(0,0,0,0.5)',
          }}
        >
          <span
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{
              width: '30%',
              height: '30%',
              transform: 'translate(-50%, -50%)',
              background: 'radial-gradient(circle at 40% 35%, #3c4348, #0c0e11)',
            }}
          />
        </div>
      </div>

      <div
        className="absolute origin-left rounded-full"
        style={{
          left: size * 0.28,
          top: '76%',
          width: size * 0.92,
          height: 4,
          transform: 'rotate(-19deg)',
          background: 'linear-gradient(180deg,#c3ccd2,#6b747b 60%,#2f353a)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.7)',
        }}
      >
        <span
          className="absolute rounded-full"
          style={{
            left: -4,
            top: '50%',
            width: 9,
            height: 9,
            transform: 'translateY(-50%)',
            background: 'radial-gradient(circle at 35% 30%, #b6bfc5, #4b5258 60%, #1b1f22)',
          }}
        />
      </div>

      <div
        className="absolute rounded-full bg-[#76b900]"
        style={{ right: 9, top: 8, width: 3, height: 3, boxShadow: '0 0 6px rgba(118,185,0,0.95)' }}
      />
      <p
        className="absolute font-semibold uppercase text-white/40"
        style={{ right: 9, bottom: 7, fontSize: 7, letterSpacing: '0.14em', lineHeight: 1 }}
      >
        {files}
      </p>
    </div>
  );
}


function SleeveFace({
  name,
  files,
  date,
  badge,
  more,
}: {
  name: string;
  files: string;
  date: string;
  badge?: ReactNode;
  more?: ReactNode;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[2px] bg-[linear-gradient(154deg,#4a525c_0%,#31373f_46%,#20242a_78%,#171b20_100%)]">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 3px)',
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(158deg,rgba(255,255,255,0.16)_0%,transparent_42%,rgba(0,0,0,0.42)_100%)]" />
      <div
        className="pointer-events-none absolute -inset-y-6 -left-10 w-[46%] rotate-[14deg] mix-blend-screen"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(208,228,240,0.10) 40%, rgba(208,228,240,0.03) 62%, transparent)' }}
      />
      <div className="pointer-events-none absolute inset-[5px] rounded-[2px] border border-white/[0.09]" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-[linear-gradient(180deg,transparent,rgba(118,185,0,0.55)_35%,rgba(118,185,0,0.55)_65%,transparent)]" />

      <div className="relative flex h-full flex-col px-2.5 pb-2.5 pt-2">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[7px] font-medium uppercase tracking-[0.16em] text-text-secondary/70">
            knowledge base
          </span>
          {more ? (
            <span
              className="flex-none"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {more}
            </span>
          ) : null}
        </div>

        <h3 className="mt-1 line-clamp-2 text-[14px] font-bold leading-tight text-text-primary">{name}</h3>
        <p className="mt-1 truncate text-[10px] text-text-secondary">{files}</p>

        <div className="mt-auto flex min-w-0 flex-col gap-1.5">
          <div className="flex items-end gap-[2px] opacity-[0.26]" aria-hidden>
            {[6, 3, 9, 4, 7, 3, 10, 5, 8, 3, 6].map((weight, index) => (
              <span key={index} className="w-[2px] rounded-[1px] bg-text-secondary" style={{ height: weight + 6 }} />
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-1">
            {badge}
            <p className="min-w-0 flex-1 truncate text-[9px] tabular-nums leading-tight text-text-secondary/70">
              {date}
            </p>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-y-[6px] right-0 w-[3px] bg-[linear-gradient(90deg,transparent,rgba(0,0,0,0.85))]" />
    </div>
  );
}
