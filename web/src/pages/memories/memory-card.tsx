import FluxLines from '@/components/flux-lines';
import { isDarkTheme, watchTheme } from '@/components/live-orb';
import { MoreButton } from '@/components/more-button';
import { SharedBadge } from '@/components/shared-badge';
import { TruncatedText } from '@/components/truncated-text';
import { Card } from '@/components/ui/card';
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
  'radial-gradient(circle closest-side at center, transparent 0 44%, #000 45%)';

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
 * Near-square memory tile. The tile itself acts as the record sleeve: a vinyl
 * record is parked behind it and the tile's rounded right edge wraps the rim,
 * so nothing of the record shows until hover, when it slides out and spins.
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
    <div
      className="group relative h-[220px] w-full hover:z-20 focus-within:z-20"
      style={{ perspective: 1300, perspectiveOrigin: '50% -6%' }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/* contact shadow, so the sleeve reads as a slab resting on a desk */}
      <div className="pointer-events-none absolute inset-x-6 -bottom-4 h-9 rounded-[50%] bg-black/50 opacity-70 blur-2xl" />

      {/* the sleeve is a real slab: printed face, thickness, and a hollow the record hides in */}
      <div
        className="relative h-full w-full [transform-style:preserve-3d]"
        style={{ transform: 'rotateX(30deg) rotateY(-10deg)' }}
      >
        {/* the board behind the printed face, dropped back to give the sleeve its thickness */}
        <div
          className="pointer-events-none absolute inset-0 rounded-[14px] bg-[#c9ccd1] dark:bg-[#0a0c0f]"
          style={{ transform: 'translateZ(-26px)' }}
        />

        {/* record: parked inside the sleeve, slides out of the open end and spins */}
        <div
          className="pointer-events-none absolute inset-0 [transform-style:preserve-3d]"
          style={{ transform: 'translateZ(-2px)' }}
        >
          <div className="absolute top-1/2 right-[6px] h-[196px] w-[196px] -translate-y-1/2 transition-transform duration-500 ease-[cubic-bezier(0.34,1.36,0.64,1)] group-hover:translate-x-[104px]">
        <div className="relative h-full w-full group-hover:animate-vinyl-spin group-hover:[animation-delay:140ms]">
          {/* dyed rim: the wash is masked into the outer ring of the disc */}
          <div
            className="absolute inset-0 isolate overflow-hidden rounded-full border border-border-default bg-vinyl-base"
            style={{ maskImage: VINYL_MASK, WebkitMaskImage: VINYL_MASK }}
          >
            <VinylRim seed={String(data?.id ?? data?.name ?? 'memory')} />
            {/* settle the hub into the dye */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  'radial-gradient(circle closest-side at center, rgb(8 8 10 / 0.55) 44%, transparent 66%)',
              }}
            />
            {/* pigment tooth, so the dye reads as soaked-in watercolour */}
            <div
              className="absolute inset-0 mix-blend-soft-light"
              style={{
                backgroundImage: WATERCOLOR_GRAIN,
                backgroundSize: '150px 150px',
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
          <div className="absolute left-1/2 top-1/2 h-[46%] w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-vinyl-sheen/25 bg-vinyl-sheen/[0.08] shadow-[inset_0_0_10px_rgba(255,255,255,0.06)] backdrop-blur-[2px]">
            <div className="absolute inset-[9%] rounded-full border border-vinyl-sheen/15" />
          </div>
          {/* spindle hole */}
          <div className="absolute left-1/2 top-1/2 h-[9%] w-[9%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-vinyl-sheen/40 bg-bg-base/50" />
        </div>
      </div>

        </div>

        {/* the printed face of the sleeve, lifted above the hollow */}
        <div className="absolute inset-0" style={{ transform: 'translateZ(6px)' }}>
          <div className="pointer-events-none absolute inset-0 rounded-[14px] bg-bg-base" />

          <Card
        as="article"
        tabIndex={0}
        data-testid="memory-card"
        onClick={navigateToMemory(data?.id)}
        className="absolute inset-0 flex cursor-pointer flex-col overflow-hidden rounded-[14px] px-4 py-4 transition-all hover:shadow-md"
      >
        {/* hover background: flux lines in the accent colour */}
        {fluxOn && (
          <div className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
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

        {/* faint print, cut by the card's right edge */}
        {/* only the hemisphere that sits against the record seam is printed */}
        <div className="pointer-events-none absolute inset-y-0 right-0 z-0 w-[100px] overflow-hidden">
          <div className="absolute left-0 top-1/2 -translate-y-1/2">
            <MemoryBrainWatermark size={200} />
          </div>
        </div>

        <div className="relative z-10 flex min-w-0 items-center gap-2 pr-6">
          <TruncatedText
            as="h3"
            className="min-w-0 flex-1 truncate text-base font-bold leading-snug"
            testId="memory-name"
            tooltip={data?.name}
          >
            {data?.name}
          </TruncatedText>
          <MemoryDropdown
            memory={data}
            showMemoryRenameModal={showMemoryRenameModal}
          >
            <MoreButton />
          </MemoryDropdown>
        </div>

        <div className="relative z-10 mt-auto flex min-w-0 flex-col gap-1">
          <p className="truncate text-sm text-text-secondary">
            {formatDate(data?.create_time)}
          </p>
          <SharedBadge>{data?.owner_name}</SharedBadge>
        </div>
          </Card>
        </div>
      </div>
    </div>
  );
}