import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

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

/**
 * A knowledge base as a disk case lying on a table: the sleeve on the left is
 * printed with the name, the tray on the right holds the disk. The tray rides
 * behind the sleeve, so the part still inside stays hidden and pointing at the
 * card pulls the rest of it out.
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
      className="group group/disk relative h-[220px] w-full cursor-pointer select-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-text-accent hover:z-30"
      style={{ perspective: '900px', perspectiveOrigin: '42% 45%' }}
    >
      <div
        className="absolute inset-0"
        style={{ transformStyle: 'preserve-3d', transform: 'rotateX(10deg)' }}
      >
        {/* table shadow, spreading as the tray comes out */}
        <div
          className={cn(
            'pointer-events-none absolute bottom-[3%] left-[6%] right-[2%] top-[14%] rounded-[18px] bg-black/75 blur-[15px]',
            'transition-all duration-500 [transition-timing-function:cubic-bezier(.32,.08,.18,1)]',
            'group-hover/disk:translate-x-[4%] group-hover/disk:translate-y-[8px]',
            active && 'translate-x-[4%] translate-y-[8px]',
          )}
        />

        {/* tray: rides behind the sleeve, the disk end sticks out of the case */}
        <div
          className={cn(
            'absolute left-[46%] top-[9%] h-[82%] w-[50%] will-change-transform',
            'transition-transform duration-500 [transition-timing-function:cubic-bezier(.32,.08,.18,1)]',
            '[transform:translate3d(0,0,0)]',
            'group-hover/disk:[transform:translate3d(15%,-3px,0)]',
            'group-focus-visible/disk:[transform:translate3d(15%,-3px,0)]',
            active && '[transform:translate3d(15%,-3px,0)]',
          )}
          style={{ transformStyle: 'preserve-3d' }}
        >
          <div
            className={cn(
              'relative flex h-full w-full flex-col justify-between rounded-[5px] border border-white/15 px-2 pb-2 pt-2',
              'bg-[linear-gradient(172deg,#767e86_0%,#4c525a_18%,#353b42_52%,#454b53_80%,#23272c_100%)]',
              'transition-shadow duration-500',
              '[box-shadow:inset_0_2px_0_rgba(255,255,255,0.35),inset_0_-3px_7px_rgba(0,0,0,0.6),0_16px_28px_-14px_rgba(0,0,0,0.95)]',
              'group-hover/disk:[box-shadow:inset_0_2px_0_rgba(255,255,255,0.4),inset_0_-3px_7px_rgba(0,0,0,0.6),16px_18px_40px_-14px_rgba(0,0,0,1)]',
            )}
          >
            <div className="flex items-center justify-center">
              <span className="size-[3px] flex-none rounded-full bg-[#c9a24a]/80" />
            </div>

            <div className="relative mx-auto aspect-square w-[62%] flex-none rounded-full bg-[radial-gradient(circle_at_32%_24%,#fbfeff_0%,#d3dde3_15%,#93a0a9_38%,#59636b_60%,#23282d_100%)] shadow-[inset_0_0_0_2px_rgba(0,0,0,0.32),0_4px_9px_rgba(0,0,0,0.6)]">
              <div
                className={cn(
                  'absolute inset-[3px] rounded-full opacity-80',
                  'group-hover/disk:animate-vinyl-spin',
                  active && 'animate-vinyl-spin',
                )}
                style={{
                  backgroundImage:
                    'repeating-radial-gradient(circle at center, rgba(255,255,255,0.26) 0 1px, transparent 1px 4px)',
                }}
              />
              <div className="absolute inset-[26px] rounded-full bg-[radial-gradient(circle_at_38%_32%,#6f7880,#15181b)] shadow-[inset_0_0_0_2px_rgba(0,0,0,0.65)]" />
              <div className="absolute left-1/2 top-1/2 size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#d8e1e6] shadow-[inset_0_1px_1px_rgba(0,0,0,0.5)]" />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-baseline justify-end gap-1">
                <span className="truncate text-[8px] font-semibold uppercase tracking-[0.14em] text-white/55">
                  {files}
                </span>
                <span className="flex-none rounded-[2px] border border-white/20 px-1 text-[7px] uppercase tracking-[0.1em] text-white/40">
                  disk
                </span>
              </div>
              <div className="flex gap-[3px]">
                {Array.from({ length: 8 }).map((_, index) => (
                  <span key={index} className="h-[3px] flex-1 rounded-[1px] bg-[#c9a24a]/45" />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* sleeve: the printed case, painted over the part of the tray still inside */}
        <div className="absolute inset-y-0 left-0 z-10 w-[58%] overflow-hidden rounded-[10px] border border-white/[0.13] bg-[linear-gradient(156deg,#32373f_0%,#23272d_48%,#171a1f_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_16px_32px_-20px_rgba(0,0,0,0.95)] transition-colors duration-300 group-hover/disk:border-text-accent/30">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(115deg, rgba(255,255,255,0.6) 0 1px, transparent 1px 9px)',
            }}
          />
          <div className="pointer-events-none absolute inset-[6px] rounded-[6px] border border-white/[0.08]" />
          <div className="pointer-events-none absolute -right-9 -top-8 size-[96px] rounded-full border border-white/[0.07] bg-[radial-gradient(circle_at_36%_30%,rgba(255,255,255,0.09),transparent_60%)]">
            <div className="absolute inset-[18px] rounded-full border border-white/[0.06]" />
          </div>

          <div className="relative flex h-full flex-col px-3 pb-3 pt-[11px]">
            <div className="flex items-center justify-between gap-1">
              <span className="truncate text-[8px] font-medium uppercase tracking-[0.18em] text-text-secondary/70">
                knowledge base
              </span>
            </div>

            <div className="mt-1.5 flex items-start gap-1">
              <h3 className="min-w-0 flex-1 line-clamp-2 text-[15px] font-bold leading-tight text-text-primary">
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

            <p className="mt-1 truncate text-[11px] text-text-secondary">{files}</p>

            <div className="mt-auto flex min-w-0 flex-col gap-1.5">
              <div className="flex items-end gap-[2px] opacity-[0.28]" aria-hidden>
                {[6, 3, 9, 4, 7, 3, 10, 5, 8, 3, 6].map((weight, index) => (
                  <span
                    key={index}
                    className="w-[2px] rounded-[1px] bg-text-secondary"
                    style={{ height: weight + 6 }}
                  />
                ))}
              </div>
              <div className="flex min-w-0 items-center gap-1">
                {badge}
                <p className="min-w-0 flex-1 truncate text-[10px] tabular-nums leading-tight text-text-secondary/70">
                  {date}
                </p>
              </div>
            </div>
          </div>

          {/* the opening the tray leaves through */}
          <div className="pointer-events-none absolute inset-y-[12px] right-[2px] w-[6px] rounded-l-[3px] bg-[linear-gradient(90deg,rgba(0,0,0,0.3),rgba(0,0,0,0.72))] shadow-[inset_1px_0_2px_rgba(0,0,0,0.85),inset_-1px_0_1px_rgba(255,255,255,0.12)]" />
        </div>
      </div>
    </article>
  );
}
