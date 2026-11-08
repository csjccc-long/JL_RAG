import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

export interface DatasetDiskProps {
  name: string;
  files: string;
  date: string;
  badge?: ReactNode;
  more?: ReactNode;
  /** Keeps the disk ejected, for previews and tests. */
  active?: boolean;
  onClick?: () => void;
}

/**
 * A knowledge base rendered as a hard-disk cartridge resting in a drive bay.
 * Pointing at it ejects the disk: the platter and the label rise out of the
 * slot, so the card reads as a physical object rather than a flat tile.
 */
export function DatasetDisk({
  name,
  files,
  date,
  badge,
  more,
  active = false,
  onClick,
}: DatasetDiskProps) {
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
      className="group/disk relative h-[220px] w-full cursor-pointer select-none overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-text-accent"
      style={{ perspective: '900px' }}
    >
      {/* bay body */}
      <div className="absolute inset-0 rounded-xl border border-border-default bg-[linear-gradient(180deg,#1e2024_0%,#16181b_55%,#101114_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_10px_30px_-18px_rgba(0,0,0,0.9)] transition-colors duration-300 group-hover/disk:border-text-accent/25">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.13]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(115deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 7px)',
            maskImage: 'linear-gradient(180deg, transparent 42%, #000 100%)',
            WebkitMaskImage: 'linear-gradient(180deg, transparent 42%, #000 100%)',
          }}
        />
        <div className="relative flex h-full flex-col p-4 pb-[112px]">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[15px] font-bold leading-snug text-text-primary">
              {name}
            </h3>
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
          <p className="mt-1 truncate text-xs text-text-secondary">{files}</p>
          <div className="mt-auto flex min-w-0 items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs tabular-nums text-text-secondary/80">
              {date}
            </p>
            {badge}
          </div>
        </div>

        {/* the shadowed mouth the disk comes out of */}
        <div className="pointer-events-none absolute inset-x-2 bottom-0 h-[54px] rounded-b-xl bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.6))]" />
      </div>

      {/* the disk */}
      <div
        className={cn(
          'pointer-events-none absolute bottom-0 left-1/2 h-[78px] w-[calc(100%-44px)] will-change-transform',
          'transition-transform duration-500 [transition-timing-function:cubic-bezier(.32,.08,.18,1)]',
          '[transform:translateX(-50%)_translateY(34px)_rotateX(0deg)]',
          'group-hover/disk:[transform:translateX(-50%)_translateY(-8px)_translateZ(60px)_rotateX(8deg)]',
          'group-focus-visible/disk:[transform:translateX(-50%)_translateY(-8px)_translateZ(60px)_rotateX(8deg)]',
          active && '[transform:translateX(-50%)_translateY(-8px)_translateZ(60px)_rotateX(8deg)]',
        )}
        style={{ transformStyle: 'preserve-3d' }}
      >
        <div
          className={cn(
            'relative h-full w-full rounded-[9px] border border-white/10',
            'bg-[linear-gradient(165deg,#4a5057_0%,#2e3238_38%,#23262b_62%,#33383e_100%)]',
            'transition-shadow duration-500',
            '[box-shadow:0_-4px_12px_-8px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.22)]',
            'group-hover/disk:[box-shadow:0_-16px_30px_-12px_rgba(0,0,0,0.92),inset_0_1px_0_rgba(255,255,255,0.32)]',
            active &&
              '[box-shadow:0_-16px_30px_-12px_rgba(0,0,0,0.92),inset_0_1px_0_rgba(255,255,255,0.32)]',
          )}
        >
          <div className="flex h-full items-center gap-3 px-3">
            <div className="relative size-[52px] flex-none rounded-full bg-[radial-gradient(circle_at_35%_28%,#e8eef2_0%,#b9c4cb_18%,#7d8a93_42%,#4d565d_62%,#2b3136_100%)] shadow-[inset_0_0_0_2px_rgba(0,0,0,0.35),0_1px_4px_rgba(0,0,0,0.5)]">
              <div
                className={cn(
                  'absolute inset-[3px] rounded-full opacity-70',
                  'group-hover/disk:animate-vinyl-spin',
                  active && 'animate-vinyl-spin',
                )}
                style={{
                  backgroundImage:
                    'repeating-radial-gradient(circle at center, rgba(255,255,255,0.22) 0 1px, transparent 1px 5px)',
                }}
              />
              <div className="absolute inset-[16px] rounded-full bg-[radial-gradient(circle_at_40%_35%,#5a646b,#1b1e22)] shadow-[inset_0_0_0_2px_rgba(0,0,0,0.55)]" />
              <div className="absolute left-1/2 top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#c9d4da] shadow-[inset_0_1px_1px_rgba(0,0,0,0.6)]" />
            </div>

            <div
              className={cn(
                'min-w-0 flex-1 opacity-0 transition-opacity duration-300',
                'group-hover/disk:opacity-100',
                active && 'opacity-100',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium uppercase tracking-[0.16em] text-white/55">
                  {files}
                </span>
                <span className="flex-none rounded-[3px] border border-white/15 px-1 text-[9px] uppercase tracking-[0.12em] text-white/45">
                  disk
                </span>
              </div>
              <p className="mt-1 truncate text-[12px] font-semibold text-white/85">
                {name}
              </p>
              <div className="mt-1.5 flex gap-1">
                {[0, 1, 2].map((index) => (
                  <span
                    key={index}
                    className="h-[3px] flex-1 rounded-full bg-white/15"
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="absolute inset-x-4 bottom-[3px] flex gap-[3px]">
            {Array.from({ length: 12 }).map((_, index) => (
              <span
                key={index}
                className="h-[3px] flex-1 rounded-[1px] bg-[#c9a24a]/45"
              />
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
