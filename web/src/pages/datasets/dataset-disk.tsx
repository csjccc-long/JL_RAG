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

/** Chassis screws, drawn as a bevelled dot with a slot. */
function Screw({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute size-[5px] rounded-full bg-[radial-gradient(circle_at_35%_30%,#c9d2d8,#6e777e_55%,#23272b_100%)] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.7),0_0.5px_1px_rgba(255,255,255,0.18)]',
        className,
      )}
    >
      <span className="absolute left-1/2 top-1/2 h-[0.5px] w-[3px] -translate-x-1/2 -translate-y-1/2 rotate-[28deg] bg-black/60" />
    </span>
  );
}

/**
 * A knowledge base as a disk drive lying on a table: the sleeve on the left is
 * printed with the name, the tray on the right carries the drive itself — an
 * anodised chassis, a mirrored platter and a green status light. The tray rides
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
      style={{ perspective: '900px', perspectiveOrigin: '44% 44%' }}
    >
      <div
        className="absolute inset-0"
        style={{ transformStyle: 'preserve-3d', transform: 'rotateX(10deg)' }}
      >
        {/* table shadow, spreading as the drive comes out */}
        <div
          className={cn(
            'pointer-events-none absolute bottom-[3%] left-[6%] right-[2%] top-[14%] rounded-[18px] bg-black/75 blur-[15px]',
            'transition-all duration-500 [transition-timing-function:cubic-bezier(.32,.08,.18,1)]',
            'group-hover/disk:translate-x-[4%] group-hover/disk:translate-y-[8px]',
            active && 'translate-x-[4%] translate-y-[8px]',
          )}
        />

        {/* tray: aluminium chassis, slides out of the sleeve */}
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
              'relative h-full w-full overflow-hidden rounded-[4px]',
              'bg-[linear-gradient(158deg,#3d4349_0%,#22262b_26%,#171a1e_58%,#2a2f35_84%,#101216_100%)]',
              'transition-shadow duration-500',
              '[box-shadow:inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-1px_0_rgba(0,0,0,0.85),inset_1px_0_0_rgba(255,255,255,0.07),inset_-1px_0_0_rgba(0,0,0,0.6),0_16px_28px_-14px_rgba(0,0,0,0.95)]',
              'group-hover/disk:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.34),inset_0_-1px_0_rgba(0,0,0,0.85),inset_1px_0_0_rgba(255,255,255,0.08),inset_-1px_0_0_rgba(0,0,0,0.6),16px_18px_40px_-14px_rgba(0,0,0,1)]',
            )}
          >
            {/* brushed anodised grain */}
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.35]"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(0deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 3px)',
              }}
            />
            {/* chamfer highlight */}
            <div className="pointer-events-none absolute inset-[1px] rounded-[3px] border border-white/[0.06]" />
            {/* curved specular sweep across the top of the chassis */}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(148deg,rgba(255,255,255,0.13)_0%,rgba(255,255,255,0.03)_26%,transparent_46%,rgba(0,0,0,0.25)_100%)]" />
            {/* green status light, and the hairline that goes with it */}
            <div className="pointer-events-none absolute right-[6px] top-[6px] size-[3px] rounded-full bg-[#76b900] shadow-[0_0_5px_rgba(118,185,0,0.9)]" />
            <div className="pointer-events-none absolute left-[8px] right-[8px] top-[7px] h-[1px] bg-[linear-gradient(90deg,transparent,rgba(118,185,0,0.35)_40%,rgba(118,185,0,0.55)_78%,transparent)]" />

            {/* platter */}
            <div className="absolute left-1/2 top-[46%] aspect-square w-[64%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_30%_24%,#ffffff_0%,#e8eff3_9%,#c0cad1_24%,#8d979f_44%,#59626a_66%,#2b3035_92%)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4),inset_0_0_0_3px_rgba(0,0,0,0.35),0_6px_14px_rgba(0,0,0,0.7)]">
              <div
                className={cn(
                  'absolute inset-0 rounded-full opacity-70 mix-blend-screen',
                  'group-hover/disk:animate-vinyl-spin',
                  active && 'animate-vinyl-spin',
                )}
                style={{
                  backgroundImage:
                    'conic-gradient(from 20deg, rgba(255,255,255,0.4) 0deg, transparent 28deg, rgba(255,255,255,0.22) 62deg, transparent 104deg, rgba(255,255,255,0.34) 148deg, transparent 196deg, rgba(255,255,255,0.26) 244deg, transparent 300deg, rgba(255,255,255,0.36) 360deg)',
                }}
              />
              <div
                className="absolute inset-[2px] rounded-full opacity-60"
                style={{
                  backgroundImage:
                    'repeating-radial-gradient(circle at center, rgba(255,255,255,0.28) 0 0.5px, rgba(0,0,0,0.18) 0.5px 1px, transparent 1px 3px)',
                }}
              />
              {/* spindle hub with its screws */}
              <div className="absolute left-1/2 top-1/2 size-[34%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_34%_28%,#aeb8bf,#5d666d_52%,#22272b_100%)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_0_0_3px_rgba(0,0,0,0.5)]">
                <span className="absolute left-1/2 top-1/2 size-[30%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_40%_35%,#3c4348,#0c0e11)] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.8)]" />
                {[0, 120, 240].map((deg) => (
                  <span
                    key={deg}
                    className="absolute left-1/2 top-1/2 size-[12%] rounded-full bg-[#8e979e] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.6)]"
                    style={{
                      transform: `rotate(${deg}deg) translateY(-190%) translateX(-50%)`,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* actuator arm reaching in from the corner */}
            <div className="pointer-events-none absolute bottom-[16%] left-[8%] h-[4px] w-[54%] origin-left -rotate-[16deg] rounded-full bg-[linear-gradient(180deg,#c3ccd2,#6b747b_60%,#2f353a)] shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
              <span className="absolute -left-[4px] top-1/2 size-[9px] -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_35%_30%,#b6bfc5,#4b5258_60%,#1b1f22)] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.6)]" />
              <span className="absolute -right-[2px] top-1/2 size-[6px] -translate-y-1/2 rounded-full bg-[#20262a] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]" />
            </div>

            {/* gold edge connector */}
            <div className="pointer-events-none absolute inset-x-[10px] bottom-[3px] flex gap-[2px]">
              {Array.from({ length: 14 }).map((_, index) => (
                <span
                  key={index}
                  className="h-[4px] flex-1 rounded-[0.5px] bg-[linear-gradient(180deg,#e9c86a,#b9902f_70%,#7a5c1c)] opacity-80"
                />
              ))}
            </div>

            {/* chassis screws on the visible side */}
            <Screw className="right-[5px] bottom-[10px]" />
            <Screw className="right-[5px] top-[14px]" />

            {/* engraved spec text */}
            <div className="pointer-events-none absolute bottom-[13px] right-[13px] text-right">
              <p className="text-[7px] font-semibold uppercase leading-none tracking-[0.16em] text-white/45">
                {files}
              </p>
              <p className="mt-[3px] text-[6px] uppercase leading-none tracking-[0.3em] text-white/25">
                nvme · disk
              </p>
            </div>
          </div>
        </div>

        {/* sleeve: the printed case, painted over the part of the drive inside */}
        <div className="absolute inset-y-0 left-0 z-10 w-[58%] overflow-hidden rounded-[10px] border border-white/[0.14] bg-[linear-gradient(154deg,#2f343c_0%,#20242a_50%,#15181d_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_1px_0_0_rgba(255,255,255,0.06),inset_-1px_0_0_rgba(0,0,0,0.7),0_18px_36px_-22px_rgba(0,0,0,0.95)] transition-colors duration-300 group-hover/disk:border-text-accent/30">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.3]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 3px)',
            }}
          />
          <div className="pointer-events-none absolute inset-[6px] rounded-[6px] border border-white/[0.07]" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,0.07)_0%,transparent_38%,transparent_72%,rgba(0,0,0,0.32)_100%)]" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-[linear-gradient(180deg,transparent,rgba(118,185,0,0.5)_35%,rgba(118,185,0,0.5)_65%,transparent)]" />
          <div className="pointer-events-none absolute -right-9 -top-8 size-[96px] rounded-full border border-white/[0.06] bg-[radial-gradient(circle_at_36%_30%,rgba(255,255,255,0.08),transparent_60%)]">
            <div className="absolute inset-[18px] rounded-full border border-white/[0.05]" />
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
              <div className="flex items-end gap-[2px] opacity-[0.26]" aria-hidden>
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

          {/* the opening the drive leaves through */}
          <div className="pointer-events-none absolute inset-y-[12px] right-[2px] w-[6px] rounded-l-[3px] bg-[linear-gradient(90deg,rgba(0,0,0,0.35),rgba(0,0,0,0.78))] shadow-[inset_1px_0_2px_rgba(0,0,0,0.85),inset_-1px_0_1px_rgba(255,255,255,0.14)]" />
        </div>
      </div>
    </article>
  );
}
