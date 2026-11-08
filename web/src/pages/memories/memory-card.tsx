import FluxLines from '@/components/flux-lines';
import { isDarkTheme, watchTheme } from '@/components/live-orb';
import { MoreButton } from '@/components/more-button';
import { SharedBadge } from '@/components/shared-badge';
import { TruncatedText } from '@/components/truncated-text';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { formatDate } from '@/utils/date';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IMemory } from './interface';
import { MemoryBrainWatermark } from './memory-brain-watermark';
import { MemoryDropdown } from './memory-dropdown';
import { VinylRim } from './vinyl-rim';

interface IProps {
  data: IMemory;
  showMemoryRenameModal: (data: IMemory) => void;
}

const VINYL_MASK =
  'radial-gradient(circle closest-side at center, transparent 0 40%, #000 41%)';

/** Paper-like tooth that breaks the dye into pigment, like wet watercolour. */
const WATERCOLOR_GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="160" height="160" filter="url(#grain)" opacity="0.62"/></svg>',
)}")`;

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Memory tile rendered as a turntable: a plinth in perspective carries a
 * platter, the dyed record and a tonearm, and the memory's name is silk-screened
 * onto the front fascia. Hovering drops the needle and starts the record.
 */
export function MemoryCard({ data, showMemoryRenameModal }: IProps) {
  const { navigateToMemory } = useNavigatePage();
  // the flux background is a WebGL canvas: mount it on the first hover and drop
  // it again once the fade-out finished, so long lists stay well under the
  // browser's WebGL context limit.
  const [fluxOn, setFluxOn] = useState(false);
  const [dark, setDark] = useState(() => isDarkTheme());
  const fluxTimer = useRef<number | null>(null);
  const accent = useMemo(() => {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-primary')
      .trim();
    return raw ? `rgb(${raw})` : '#00beb4';
  }, []);

  useEffect(() => watchTheme(() => setDark(isDarkTheme())), []);
  useEffect(
    () => () => {
      if (fluxTimer.current) window.clearTimeout(fluxTimer.current);
    },
    [],
  );

  // the rim keeps a muted sheen that follows the disc; the dye itself is
  // painted on a canvas so it can reuse the folder artwork
  const rimSheen = useMemo(() => {
    const key = String(data?.id ?? data?.name ?? 'memory');
    const from = 176 + (hashString(key) % 40);
    return {
      grooves:
        'repeating-radial-gradient(circle closest-side at center, rgb(var(--vinyl-groove) / 0.6) 0 1px, transparent 1px 4.5px)',
      sheen: `conic-gradient(from ${from}deg at center, transparent 0deg, rgb(var(--vinyl-sheen) / 0.34) 28deg, transparent 72deg, transparent 360deg)`,
    };
  }, [data?.id, data?.name]);

  const handleEnter = () => {
    if (fluxTimer.current) {
      window.clearTimeout(fluxTimer.current);
      fluxTimer.current = null;
    }
    setFluxOn(true);
  };
  const handleLeave = () => {
    fluxTimer.current = window.setTimeout(() => setFluxOn(false), 1200);
  };

  return (
    <article
      data-testid="memory-card"
      tabIndex={0}
      onClick={navigateToMemory(data?.id)}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="group relative block h-[220px] w-full cursor-pointer outline-none hover:z-20 focus-visible:z-20 focus-within:z-20"
      style={{ perspective: 900, perspectiveOrigin: '50% 20%' }}
    >
      {/* hover aura: the flux lines glow around the deck instead of the tile */}
      {fluxOn && (
        <div
          className="pointer-events-none absolute inset-[-6px] z-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            maskImage:
              'radial-gradient(closest-side at 50% 58%, #000 34%, transparent 78%)',
            WebkitMaskImage:
              'radial-gradient(closest-side at 50% 58%, #000 34%, transparent 78%)',
          }}
        >
          <FluxLines
            colors={[accent, accent, accent]}
            flowDirection="down"
            speed={0.5}
            scale={1.6}
            turbulence={1}
            fluidity={0.1}
            rimWidth={0.2}
            sharpness={2.5}
            shimmer={1.5}
            glow={2}
            lineWidth={1}
            opacity={0.85}
            mouseInteraction
            mouseStrength={1}
            mouseRadius={0.35}
            clickSwirl
            intro
            lightMode={!dark}
          />
        </div>
      )}

      {/* contact shadow, so the plinth reads as a slab resting on a desk */}
      <div className="pointer-events-none absolute inset-x-7 bottom-2 z-0 h-7 rounded-[50%] bg-black/55 blur-xl transition-all duration-500 group-hover:bottom-1 group-hover:bg-black/60 group-hover:blur-2xl" />

      <MemoryDropdown
        memory={data}
        showMemoryRenameModal={showMemoryRenameModal}
      >
        <MoreButton className="absolute right-1 top-2 z-20" />
      </MemoryDropdown>

      {/* the plinth: a flat deck in perspective with a fascia wall at the front */}
      <div
        className="absolute left-1/2 top-1/2 h-[188px] w-[236px] transition-transform duration-500 [--lift:0px] [transform-style:preserve-3d] group-hover:[--lift:-3px] group-focus-visible:[--lift:-3px]"
        style={{
          transform:
            'translate(-50%, calc(-50% + var(--lift, 0px))) rotateX(44deg)',
          transitionTimingFunction: 'cubic-bezier(0.32, 0.08, 0.18, 1)',
        }}
      >
        {/* deck surface */}
        <div
          className="absolute inset-0 overflow-hidden rounded-[16px]"
          style={{
            background:
              'linear-gradient(156deg,#4d555e 0%,#2d333b 40%,#1d2127 78%,#16191d 100%)',
            boxShadow:
              'inset 0 0 0 1px rgba(255,255,255,0.11), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -22px 40px rgba(0,0,0,0.55)',
          }}
        >
          {/* anodised brushing across the plinth */}
          <div
            className="absolute inset-0 opacity-50"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 3px)',
            }}
          />

          {/* platter recess */}
          <div
            className="absolute left-[22px] top-[12px] h-[158px] w-[158px] rounded-full"
            style={{
              background:
                'radial-gradient(circle at 50% 44%, #2f353c, #1a1e22 56%, #0f1214 100%)',
              boxShadow:
                'inset 0 0 0 1px rgba(255,255,255,0.1), inset 0 12px 26px rgba(0,0,0,0.85), 0 1px 0 rgba(255,255,255,0.05)',
            }}
          >
            <div
              className="absolute inset-[11px] rounded-full"
              style={{
                background:
                  'radial-gradient(circle at 34% 22%, rgba(255,255,255,0.07), transparent 58%)',
              }}
            />
          </div>

          {/* the record, seated on the platter; spinning while hovered */}
          <div
            className="absolute left-[27px] top-[17px] h-[148px] w-[148px]"
            style={{ transform: 'translateZ(7px)' }}
          >
            <div className="relative h-full w-full group-hover:animate-vinyl-spin">
              {/* dyed rim: the wash is masked into the outer ring of the disc */}
              <div
                className="absolute inset-0 isolate overflow-hidden rounded-full border border-border-default bg-vinyl-base shadow-[0_10px_18px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.05)]"
                style={{ maskImage: VINYL_MASK, WebkitMaskImage: VINYL_MASK }}
              >
                <VinylRim seed={String(data?.id ?? data?.name ?? 'memory')} />
                {/* settle the hub into the dye */}
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage:
                      'radial-gradient(circle closest-side at center, rgb(8 8 10 / 0.55) 40%, transparent 62%)',
                  }}
                />
                {/* pigment tooth, so the dye reads as soaked-in watercolour */}
                <div
                  className="absolute inset-0 mix-blend-soft-light"
                  style={{
                    backgroundImage: WATERCOLOR_GRAIN,
                    backgroundSize: '120px 120px',
                    opacity: 0.7,
                  }}
                />
                <div
                  className="absolute inset-0"
                  style={{ backgroundImage: rimSheen.grooves, opacity: 0.5 }}
                />
                <div
                  className="absolute inset-0"
                  style={{ backgroundImage: rimSheen.sheen }}
                />
              </div>
              {/* clear hub in the middle of the ring, like the centre of a disc */}
              <div className="absolute left-1/2 top-1/2 h-[44%] w-[44%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-vinyl-sheen/25 bg-vinyl-sheen/[0.08] shadow-[inset_0_0_10px_rgba(255,255,255,0.06)] backdrop-blur-[2px]">
                <div className="absolute inset-[9%] rounded-full border border-vinyl-sheen/15" />
              </div>
              {/* spindle hole */}
              <div className="absolute left-1/2 top-1/2 h-[9%] w-[9%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-vinyl-sheen/40 bg-bg-base/50" />
            </div>
          </div>

          {/* tonearm: the pivot stays put, the arm swings onto the record */}
          <div
            className="absolute right-[8px] top-[20px] h-[27px] w-[27px] rounded-full"
            style={{
              background:
                'radial-gradient(circle at 34% 28%, #8b959d, #2c3238 64%, #171b1f)',
              boxShadow:
                'inset 0 0 0 1px rgba(255,255,255,0.16), 0 5px 9px rgba(0,0,0,0.6)',
            }}
          >
            <div
              className="absolute left-[6px] top-[6px] h-[15px] w-[15px] rounded-full"
              style={{
                background:
                  'radial-gradient(circle at 40% 30%, #c8d2d8, #4a525a 70%)',
              }}
            />
          </div>
          <div
            className="absolute right-[21px] top-[33px] h-1 w-[92px] origin-right transition-transform duration-700 [transform:rotate(-80deg)_translateZ(22px)] group-hover:[transform:rotate(-52deg)_translateZ(22px)]"
            style={{
              transitionTimingFunction: 'cubic-bezier(0.32, 0.08, 0.18, 1)',
            }}
          >
            <div
              className="absolute inset-0 rounded-[2px] shadow-[0_3px_5px_rgba(0,0,0,0.5)]"
              style={{
                background:
                  'linear-gradient(90deg,#dae2e7,#9aa4ab 55%,#5f686f)',
              }}
            />
            {/* counterweight */}
            <div
              className="absolute -top-1 -right-[11px] h-[11px] w-[18px] rounded-[3px]"
              style={{
                background:
                  'linear-gradient(180deg,#a3acb3,#3c4247)',
              }}
            />
            {/* headshell + stylus */}
            <div
              className="absolute -top-1 -left-[12px] h-[11px] w-[19px] rounded-[2px] shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
              style={{
                background:
                  'linear-gradient(180deg,#eef4f8,#9aa4ab)',
              }}
            />
            <div className="absolute left-[2px] top-[10px] h-[6px] w-[1.5px] bg-[#c9d2d8]" />
          </div>

          {/* speed knob and start bar */}
          <div
            className="absolute right-[16px] top-[140px] h-[22px] w-[22px] rounded-full"
            style={{
              background:
                'radial-gradient(circle at 34% 28%, #79838b, #2c3239 68%, #191d21)',
              boxShadow:
                'inset 0 0 0 1px rgba(255,255,255,0.14), 0 3px 6px rgba(0,0,0,0.55)',
            }}
          >
            <div className="absolute left-1/2 top-[4px] h-[6px] w-[2px] -translate-x-1/2 rounded-[1px] bg-[#b9c3ca]" />
          </div>
          <div
            className="absolute right-[16px] top-[170px] h-[12px] w-[30px] rounded-[3px]"
            style={{
              background: 'linear-gradient(180deg,#3b4249,#22272d)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)',
            }}
          />

          {/* bevel: a lit left edge and a shadowed right one read as thickness */}
          <div className="pointer-events-none absolute inset-0 rounded-[16px] shadow-[inset_2px_0_0_rgba(255,255,255,0.06),inset_-2px_0_0_rgba(0,0,0,0.6)]" />
        </div>

        {/* front fascia: silk-screened with the memory's name and date */}
        <div
          className="absolute bottom-0 left-0 h-[56px] w-[236px] origin-bottom overflow-hidden rounded-b-[12px] px-3.5 pt-2.5"
          style={{
            transform: 'translateZ(-56px) rotateX(-90deg)',
            transformOrigin: 'bottom center',
            backfaceVisibility: 'hidden',
            willChange: 'transform',
            background:
              'linear-gradient(180deg,#40474f 0%,#262c33 52%,#1a1e23 100%)',
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -10px 16px rgba(0,0,0,0.45)',
          }}
        >
          {/* faint print, so the brain motif survives on the new deck */}
          <div className="pointer-events-none absolute -right-4 -top-3 h-[92px] w-[92px] opacity-[0.07]">
            <MemoryBrainWatermark size={92} />
          </div>
          <div className="relative flex items-center gap-2">
            <TruncatedText
              as="h3"
              className="min-w-0 flex-1 truncate text-[15px] font-bold leading-tight text-white/90"
              testId="memory-name"
              tooltip={data?.name}
            >
              {data?.name}
            </TruncatedText>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#3ed9a0] shadow-[0_0_9px_#3ed9a0] transition-all duration-300 group-hover:bg-[#78ffca] group-hover:shadow-[0_0_16px_#78ffca]" />
          </div>
          <div className="relative mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-white/65">
            <span className="shrink-0 tabular-nums">
              {formatDate(data?.create_time)}
            </span>
            <SharedBadge>{data?.owner_name}</SharedBadge>
          </div>
          <span className="pointer-events-none absolute bottom-[9px] right-3.5 text-[7px] tracking-[0.16em] text-white/40">
            33⅓
          </span>
        </div>
      </div>
    </article>
  );
}
