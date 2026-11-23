import { CSSProperties, ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { playContextKnock, playContextTick } from './dashboard-sound';
import './context-meter.css';

/* ══ Context meter ════════════════════════════════════════
   A window of tokens as a field of dots, one per thousand. Each kind of
   content fills its own band, column by column, in its own strength of ink,
   and the room left over is a faint grid. Point at a chip, or at any dot, and
   that kind lights while the rest fall back, and the big number rolls to its
   share. Compact folds the empty room away: the bands close up, the field
   fills, and the count rolls with them.

   ── EVERY DOT IS AN INDEX ───────────────────────────────
   Dot i belongs to whichever kind's running total it falls inside, so a dot
   never moves: folding changes which kind each index belongs to, and the
   colour change is the animation. A delay that grows along the indices that
   changed makes it a ripple rather than a cut.

   ── THE FIGURE POPS IN ──────────────────────────────────
   A digit that changes rises a hair out of a 2px blur and lands a touch past
   its mark, left to right 70ms apart — from below when the figure grows, from
   above when it shrinks. Every digit is keyed by its place and its value, so
   one that did not change never moves. */

type Kind = { id: string; name: string; k: number };
export type MeterStyle = 'Field' | 'Bar';

type ContextMeterProps = {
  kinds: Kind[];
  /** the window, in thousands of tokens */
  capacity: number;
  /** one colour per kind, keyed by its id */
  colours: Record<string, string>;
  emptyColour: string;
  labels: {
    title: string;
    compact: string;
    undo: string;
    of: (value: string) => string;
  };
  /** a control that belongs beside the action, such as the field/bar switch */
  action?: ReactNode;
  style?: MeterStyle;
  colour?: 'Colour' | 'Mono';
};

/* 200 dots, one per thousand: 20 across, 10 down, each an exact 11 by 11 on a
   3px gap, so every one is the same true square */
const DOTS = 200;
const COLS = 20;
const ROWS = 10;
const DOT_W = 11;
const DOT_H = 11;
const GAP = 3;

/* the whole ripple fits inside the knock: every dot that changes has started
   by RIPPLE ms. 1 rather than 0 for the first, since 0 reads as "unchanged" */
const RIPPLE = 220;

/* the bar's corners: OUTER at its two ends, INNER where pieces meet */
const OUTER = 6;
const INNER = 2;

const fmt = (k: number) => `${k.toFixed(1)}K`;

const corners = (first: boolean, last: boolean) => ({
  borderTopLeftRadius: first ? OUTER : INNER,
  borderBottomLeftRadius: first ? OUTER : INNER,
  borderTopRightRadius: last ? OUTER : INNER,
  borderBottomRightRadius: last ? OUTER : INNER,
});

function Roll({ text, up }: { text: string; up: boolean }) {
  const chars = text.split('');

  /* places counted from the right, so a new leading digit does not shift the
     keys of the ones already there */
  return (
    <span className="ctx-roll" aria-hidden="true">
      {chars.map((char, index) => {
        const place = chars.length - 1 - index;

        if (!/[0-9]/.test(char)) {
          return (
            <span key={`s${place}`} className="ctx-sym">
              {char}
            </span>
          );
        }

        return (
          <span key={`p${place}`} className="ctx-wheel">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={char}
                className="ctx-digit"
                initial={{
                  y: up ? '0.18em' : '-0.18em',
                  opacity: 0,
                  filter: 'blur(2px)',
                }}
                animate={{ y: '0em', opacity: 1, filter: 'blur(0px)' }}
                exit={{
                  opacity: 0,
                  filter: 'blur(2px)',
                  transition: { duration: 0.16 },
                }}
                transition={{
                  duration: 0.5,
                  ease: [0.34, 1.45, 0.64, 1],
                  delay: index * 0.07,
                }}
              >
                {char}
              </motion.span>
            </AnimatePresence>
          </span>
        );
      })}
    </span>
  );
}

/* which kind each dot is, for a given window: running totals, a dot per
   thousand. Both the open and the folded window are fixed, so the dots that
   differ between them — and so the ripple's delays — are too */
const ownersFor = (kinds: Kind[], order: number[], capacity: number) => {
  const per = capacity > 0 ? capacity / DOTS : 0;
  const out: (number | null)[] = [];

  order.forEach((ci) => {
    const count = per > 0 ? Math.round(kinds[ci].k / per) : 0;
    for (let dot = 0; dot < count && out.length < DOTS; dot += 1) {
      out.push(ci);
    }
  });

  while (out.length < DOTS) out.push(null);

  return out;
};

export function ContextMeter({
  kinds,
  capacity,
  colours,
  emptyColour,
  labels,
  action,
  style = 'Bar',
  colour = 'Colour',
}: ContextMeterProps) {
  const [compact, setCompact] = useState(false);
  const [hot, setHot] = useState<string | null>(null);

  /* biggest first, as it stands before folding: the order of the field, the
     bar and the chips alike. Fixed, so folding closes the bands in place
     rather than reshuffling them */
  const order = useMemo(
    () => kinds.map((_, index) => index).sort((a, b) => kinds[b].k - kinds[a].k),
    [kinds],
  );

  const used = useMemo(
    () => kinds.reduce((sum, kind) => sum + kind.k, 0),
    [kinds],
  );

  /* folding removes the room nobody is using, and opens it again */
  const foldedCapacity = used;
  const capacityNow = compact ? foldedCapacity : capacity;

  const owners = useMemo(
    () => [
      ownersFor(kinds, order, capacity),
      ownersFor(kinds, order, foldedCapacity),
    ],
    [kinds, order, capacity, foldedCapacity],
  );

  const ownerNow = owners[compact ? 1 : 0];
  const ownerWas = owners[compact ? 0 : 1];

  const ripple = useMemo(() => {
    const first = ownerNow.findIndex(
      (owner, index) => owner !== ownerWas[index],
    );

    if (first < 0) return ownerNow.map(() => 0);

    const last = ownerNow.reduce<number>(
      (furthest, owner, index) => (owner !== ownerWas[index] ? index : furthest),
      first,
    );
    const span = last - first || 1;

    return ownerNow.map((owner, index) =>
      owner === ownerWas[index]
        ? 0
        : 1 + Math.round(((index - first) / span) * RIPPLE),
    );
  }, [ownerNow, ownerWas]);

  /* the swap only plays once Compact has been pressed: on first paint there is
     nothing to swap from */
  const [moved, setMoved] = useState(false);

  /* the big number rolls toward whatever it is showing */
  const hotKind = hot ? kinds.findIndex((kind) => kind.id === hot) : -1;
  const target = hotKind >= 0 ? kinds[hotKind].k : used;

  /* which way the wheels turn: up for more, down for less */
  const last = useRef(target);
  const up = useRef(true);
  if (target !== last.current) {
    up.current = target > last.current;
    last.current = target;
  }

  const hotRef = useRef<string | null>(null);

  const handleHot = useCallback((id: string | null) => {
    if (id && id !== hotRef.current) playContextTick();
    hotRef.current = id;
    setHot(id);
  }, []);

  const handleLeave = useCallback(() => {
    hotRef.current = null;
    setHot(null);
  }, []);

  const handleCompact = useCallback(() => {
    playContextKnock();
    setMoved(true);
    setCompact((value) => !value);
  }, []);

  return (
    <div
      className="ctx"
      data-hot={hot || undefined}
      data-style={style}
      data-mono={colour === 'Mono' || undefined}
      style={{ ['--ctx-empty' as string]: emptyColour }}
      onPointerLeave={handleLeave}
    >
      {/* only what reads at a glance: the name, and the one action */}
      <div className="ctx-head">
        <span className="ctx-title">{labels.title}</span>
        {action}
        <button
          type="button"
          className="ctx-act"
          data-quiet={compact || undefined}
          onClick={handleCompact}
        >
          {compact ? labels.undo : labels.compact}
        </button>
      </div>

      <div className="ctx-figure" aria-live="polite">
        <span className="ctx-num">
          <span className="ctx-sr">{fmt(target)}</span>
          <Roll text={fmt(target)} up={up.current} />
        </span>
        <span className="ctx-of">
          {hotKind >= 0
            ? kinds[hotKind].name
            : labels.of(
                `${Number.isInteger(capacityNow) ? capacityNow.toFixed(0) : capacityNow.toFixed(1)}K`,
              )}
        </span>
      </div>

      <div className="ctx-stage">
        <div
          className="ctx-measure"
          /* leaving the field, not the card, is what puts the total back */
          onPointerLeave={handleHot.bind(null, null)}
        >
          {style === 'Bar' ? (
            /* the bar: one segment per kind, as wide as its share, and the
               room left as a faint tail. Compact closes the tail */
            /* ── COMPACT SQUEEZES, IT DOES NOT RESHUFFLE ──────────
               The order never changes: re-sorting made two bands cross each
               other mid-move. The widths are real flex-grow transitions rather
               than a layout scale, so the corners stay true every frame; the
               leading band gives a squeeze as it closes, and a softer one runs
               down the bar after it. `data-wave` flips a/b on every press,
               which is what restarts the keyframes. */
            <div
              className="ctx-bar"
              aria-hidden="true"
              data-wave={moved ? (compact ? 'a' : 'b') : undefined}
            >
              {order.map((ci, index) => {
                const kind = kinds[ci];

                return (
                  <i
                    key={kind.id}
                    className="ctx-seg"
                    data-dim={
                      (hot !== null && kind.id !== hot) || undefined
                    }
                    style={
                      {
                        flexGrow: kind.k,
                        background: colours[kind.id],
                        /* the bar is one rounded shape cut into pieces */
                        ...corners(index === 0, false),
                        '--ctx-wave': `${index * 55}ms`,
                        '--ctx-give': index === 0 ? 0.78 : 0.93,
                        '--ctx-grow': kind.k,
                      } as CSSProperties
                    }
                    onPointerEnter={handleHot.bind(null, kind.id)}
                  />
                );
              })}
              <i
                className="ctx-seg ctx-seg-room"
                style={
                  {
                    flexGrow: Math.max(capacityNow - used, 0),
                    ...corners(false, true),
                  } as CSSProperties
                }
                data-dim={(hot !== null && true) || undefined}
                onPointerEnter={handleHot.bind(null, null)}
              />
            </div>
          ) : (
            <div
              className="ctx-grid"
              /* the field gives under the press as the bar does, its floor on
                 the knock */
              data-wave={moved ? (compact ? 'a' : 'b') : undefined}
              style={{
                /* fixed tracks, not fractions: a fraction lands each column on
                   its own sub-pixel, and neighbouring squares round to
                   different sizes */
                gridTemplateRows: `repeat(${ROWS}, ${DOT_H}px)`,
                gridTemplateColumns: `repeat(${COLS}, ${DOT_W}px)`,
                gap: GAP,
              }}
              aria-hidden="true"
            >
              {ownerNow.map((owner, index) => {
                const kind = owner === null ? null : kinds[owner];
                const wasOwner = ownerWas[index];
                const was = wasOwner === null ? null : kinds[wasOwner];
                /* a dot that changes kind is a new element, so its swap
                   animation starts again; the rest keep theirs */
                const changed = moved && ripple[index] > 0;

                return (
                  <i
                    key={changed ? `${index}${compact ? '+' : '-'}` : index}
                    className="ctx-dot"
                    data-swap={changed ? (owner === null ? 'drain' : 'fill') : undefined}
                    data-dim={
                      (hot !== null && (kind?.id ?? null) !== hot) || undefined
                    }
                    style={
                      changed
                        ? ({
                            background: kind ? colours[kind.id] : emptyColour,
                            animationDelay: `${ripple[index]}ms`,
                            /* the ink it had before it changed */
                            '--was': was ? colours[was.id] : emptyColour,
                          } as CSSProperties)
                        : { background: kind ? colours[kind.id] : emptyColour }
                    }
                    onPointerEnter={handleHot.bind(
                      null,
                      kind ? kind.id : null,
                    )}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="ctx-chips">
          {order.map((ci) => kinds[ci]).map((kind) => (
            <button
              key={kind.id}
              type="button"
              className="ctx-chip"
              data-on={hot === kind.id || undefined}
              onPointerEnter={handleHot.bind(null, kind.id)}
              onFocus={handleHot.bind(null, kind.id)}
              onBlur={handleLeave}
            >
              <i
                className="ctx-swatch"
                style={{ background: colours[kind.id] }}
              />
              {kind.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
