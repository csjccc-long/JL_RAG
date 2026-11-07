import { memo, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { fallbackFaceStyle, LiveOrb, resolveVariant } from './live-orb';

/**
 * Unlit wash palettes for the agent face. One is picked per chat (see
 * `AgentAvatar`), so every conversation inside the same chat wears the same
 * colour, and different chats look like different characters.
 */
const WASH_PALETTES: readonly (readonly [string, string, string])[] = [
  ['#7C6AF7', '#7DD3C7', '#E8B4D4'],
  ['#4F7CF7', '#67E8F9', '#C4B5FD'],
  ['#F97362', '#FBBF77', '#E879F9'],
  ['#34D399', '#A3E635', '#38BDF8'],
  ['#F472B6', '#FB7185', '#A78BFA'],
  ['#F59E0B', '#FDE68A', '#F472B6'],
  ['#22D3EE', '#A5F3FC', '#818CF8'],
  ['#8B5CF6', '#22D3EE', '#F0ABFC'],
  ['#10B981', '#6EE7B7', '#FDE047'],
  ['#EA580C', '#FB923C', '#FCA5A5'],
  ['#0EA5E9', '#7DD3FC', '#A5B4FC'],
  ['#DB2777', '#F9A8D4', '#C084FC'],
];

/** FNV-1a: same seed, same palette, across renders and reloads. */
function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getAgentPalette(seed: string) {
  return WASH_PALETTES[hashSeed(seed) % WASH_PALETTES.length];
}

function StaticFace({ seed }: { seed: string }) {
  const palette = getAgentPalette(seed);
  const resolved = resolveVariant('webgl', undefined, undefined, [
    ...palette,
  ]);
  return (
    <div
      aria-hidden
      className="absolute inset-[2%] overflow-hidden rounded-full"
      style={fallbackFaceStyle(resolved)}
    >
      <span
        className="absolute rounded-full"
        style={{
          backgroundColor: resolved.eye,
          width: '13%',
          height: '28%',
          left: '31%',
          top: '34%',
        }}
      />
      <span
        className="absolute rounded-full"
        style={{
          backgroundColor: resolved.eye,
          width: '13%',
          height: '28%',
          left: '56%',
          top: '34%',
        }}
      />
    </div>
  );
}

interface AgentAvatarProps {
  /** Stable per-chat seed; the same seed always yields the same wash. */
  seed?: string;
  /** Edge length in CSS pixels. Default `40`. */
  size?: number;
  className?: string;
  interactive?: boolean;
}

/**
 * The assistant face in a chat: a live orb whose eyes follow the pointer.
 * It only mounts its WebGL surface near the viewport — a long thread would
 * otherwise exhaust the browser's handful of live contexts — and shows a
 * painted still of the same face everywhere else.
 */
export const AgentAvatar = memo(
  ({ seed = '', size = 40, className, interactive = true }: AgentAvatarProps) => {
    const holderRef = useRef<HTMLDivElement>(null);
    const [nearViewport, setNearViewport] = useState(false);
    const palette = getAgentPalette(seed);

    useEffect(() => {
      const node = holderRef.current;
      if (!node) return;
      // Keep enough lead-in that a face is painted before it scrolls in, but
      // never more than a screenful of live WebGL surfaces: the browser only
      // hands out a handful of contexts. The scroll probe is what makes this
      // reliable — an observer that reports late (or not at all, while the
      // thread is still settling) would otherwise leave a painted still in
      // place of the live face forever.
      const margin = 320;
      let frame = 0;
      const measure = () => {
        frame = 0;
        const rect = node.getBoundingClientRect();
        const vh = window.innerHeight || 0;
        const inside =
          rect.width > 0 && rect.bottom > -margin && rect.top < vh + margin;
        setNearViewport((prev) => (prev === inside ? prev : inside));
      };
      const schedule = () => {
        if (frame) return;
        frame = requestAnimationFrame(measure);
      };
      const observer = new IntersectionObserver(
        ([entry]) => setNearViewport(entry?.isIntersecting ?? false),
        { rootMargin: `${margin}px 0px` },
      );
      observer.observe(node);
      schedule();
      window.addEventListener('scroll', schedule, {
        capture: true,
        passive: true,
      });
      window.addEventListener('resize', schedule, { passive: true });
      return () => {
        observer.disconnect();
        window.removeEventListener('scroll', schedule, { capture: true });
        window.removeEventListener('resize', schedule);
        if (frame) cancelAnimationFrame(frame);
      };
    }, []);

    return (
      <div
        ref={holderRef}
        className={cn('relative shrink-0', className)}
        style={{ width: size, height: size }}
      >
        {nearViewport ? (
          <LiveOrb
            variant="webgl"
            colors={[...palette]}
            size={size}
            interactive={interactive}
            className="absolute inset-0"
          />
        ) : (
          <StaticFace seed={seed} />
        )}
      </div>
    );
  },
);

AgentAvatar.displayName = 'AgentAvatar';
