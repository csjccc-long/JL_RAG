import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import HoloMosaic from '@/components/holo-mosaic';

import { KbGlyph } from './kb-glyph';
import './dataset-row.css';

export type DatasetRowProps = {
  /** The knowledge base name — the first line of the card. */
  name: string;
  files: string;
  date: string;
  badge?: ReactNode;
  more?: ReactNode;
  /** Draw the knowledge base's own mark on the right of the card. */
  showGlyph?: boolean;
  onClick?: () => void;
};

/** Horizontal padding inside the card, and the band kept for its menu button. */
const CARD_PAD_X = 14;
const MENU_BAND = 30;
/** A field never rests narrower than this, even for a two-character value. */
const REST_MIN = 96;
/** How long each field waits for the one above it before it starts to move. */
const STAGGER_MS = 70;
/** A beat of quiet before the first field reacts, so the pointer has landed. */
const REACT_DELAY_MS = 80;
/** How far past its target a field may lean before it settles back. */
const OVERSHOOT = 24;
/** How far a field pops outward before it starts settling on its own text. */
const POP_OUT = 18;
/** How long that pop lasts before the settle begins. */
const POP_MS = 130;
/** Once every field has landed, the name's own box unfolds into the card. */
const UNFOLD_DELAY_MS = 1000;

type FieldMotion = {
  x: number;
  v: number;
  target: number;
  start: number;
  /** 'pop' pushes outward first, 'settle' springs onto the field's own text. */
  phase: 'pop' | 'settle';
  /** The width this field settles on once the pop is over. */
  wide: number;
};

/**
 * One knowledge base = a block of pills stacked in a column — name, file count,
 * date — inside its card. At rest every pill is as long as the name, so the
 * block reads as one column; pointing at the card makes each pill pop outward
 * first and then settle back onto the length of its own words, one after the
 * other from the top, with a small overshoot as it lands. A value longer than
 * the name is clipped at rest and grows until all of it shows.
 */
export function DatasetRow({
  name,
  files,
  date,
  badge,
  more,
  showGlyph = true,
  onClick,
}: DatasetRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const unfoldRef = useRef(0);
  const motionsRef = useRef<FieldMotion[]>([]);
  const hoveredRef = useRef(false);
  const [unfolded, setUnfolded] = useState(false);

  const stop = useCallback(() => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  const run = useCallback(() => {
    if (rafRef.current) return;
    const fields = fieldsOf(rowRef.current);
    if (!fields.length) return;
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const startLoop = (time: number) => {
      let prev = time;
      const tick = (now: number) => {
        const dt = Math.min(2.5, Math.max(0.4, (now - prev) / 16.67));
        prev = now;
        let moving = false;
        fields.forEach((field, index) => {
          const motion = motionsRef.current[index];
          if (!motion) return;
          if (motion.phase === 'pop' && now - motion.start >= POP_MS) {
            motion.phase = 'settle';
            motion.target = motion.wide;
          }
          const wide = Number(field.dataset.wide || 0);
          const rest = Number(field.dataset.rest || 0);
          if (!wide || !rest) return;
          const lower = Math.max(0, Math.min(wide, rest) - OVERSHOOT);
          const upper = Math.max(wide, rest) + OVERSHOOT;
          if (reduced) {
            motion.x = motion.target;
            motion.v = 0;
          } else if (now >= motion.start) {
            motion.v =
              (motion.v + (motion.target - motion.x) * 0.105 * dt) *
              Math.pow(0.8, dt);
            motion.x += motion.v * dt;
          }
          motion.x = Math.min(upper, Math.max(lower, motion.x));
          field.style.width = motion.x.toFixed(2) + 'px';
          if (
            Math.abs(motion.target - motion.x) > 0.25 ||
            Math.abs(motion.v) > 0.25
          ) {
            moving = true;
          }
        });
        rafRef.current = moving ? window.requestAnimationFrame(tick) : 0;
      };
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(startLoop);
  }, []);

  const measure = useCallback(() => {
    const row = rowRef.current;
    const fields = fieldsOf(row);
    if (!row || !fields.length) return;
    // The card (its column) decides the room, the words decide each field: a
    // value longer than its share gets clipped and only then has anything to
    // grow into.
    const room = Math.max(
      REST_MIN,
      row.clientWidth - CARD_PAD_X * 2 - MENU_BAND,
    );
    // Let the box size itself for one synchronous read: that is the only width
    // that accounts for the real font, the real text and the real padding — a
    // hand-computed guess drifts the moment a webfont or a translation lands.
    const fulls = fields.map((field) => {
      const previous = field.style.width;
      field.style.width = '';
      const full = Math.ceil(field.getBoundingClientRect().width);
      field.style.width = previous;
      return full;
    });
    // At rest the whole block is as long as the name — that is the shape the
    // card has when nobody points at it.
    const rest = Math.max(REST_MIN, Math.min(fulls[0] ?? REST_MIN, room));
    fields.forEach((field, index) => {
      const full = fulls[index];
      const wide = Math.min(full, room);
      field.dataset.rest = String(rest);
      field.dataset.wide = String(wide);
      field.dataset.full = String(full);
      const motion = motionsRef.current[index];
      if (motion) {
        if (hoveredRef.current) {
          motion.target = wide;
        } else {
          // A resize changes the room: settle at the new resting width at once,
          // so a smaller row never keeps a width it no longer has room for.
          motion.target = rest;
          motion.x = rest;
          motion.v = 0;
          field.style.width = rest + 'px';
        }
        return;
      }
      motionsRef.current[index] = {
        x: rest,
        v: 0,
        target: rest,
        start: 0,
        phase: 'settle',
        wide,
      };
      field.style.width = rest + 'px';
    });
  }, [more]);

  /**
   * The card is hidden at rest: all that shows is the stack of pills. Once the
   * fields have finished settling, the name's own box is the seed the card
   * unfolds from — it grows to the size of the card, which then shows, and the
   * pill's own outline goes away, leaving just its words on the card.
   */
  const seedUnfold = useCallback(() => {
    const row = rowRef.current;
    const name = row?.querySelector<HTMLElement>('.drow-field--name');
    if (!row || !name) return;
    const box = row.getBoundingClientRect();
    const pill = name.getBoundingClientRect();
    row.style.setProperty('--shell-x', (pill.left - box.left).toFixed(2) + 'px');
    row.style.setProperty('--shell-y', (pill.top - box.top).toFixed(2) + 'px');
    row.style.setProperty('--shell-w', pill.width.toFixed(2) + 'px');
    row.style.setProperty('--shell-h', pill.height.toFixed(2) + 'px');
  }, []);

  const go = useCallback(
    (expanded: boolean) => {
      const fields = fieldsOf(rowRef.current);
      if (!fields.length) return;
      const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      let step = 0;
      fields.forEach((field, index) => {
        const motion = motionsRef.current[index];
        if (!motion) return;
        const wide = Number(field.dataset.wide || 0);
        const rest = Number(field.dataset.rest || 0);
        motion.wide = wide;
        const differs = Math.abs(wide - rest) > 1;
        // Top to bottom: each field waits for the one above it, after a beat of
        // quiet so the pointer has already landed.
        motion.start =
          expanded && differs ? now + REACT_DELAY_MS + step * STAGGER_MS : now;
        if (expanded && differs) {
          step += 1;
          // Pop outward first, then settle onto the field's own words.
          motion.phase = 'pop';
          motion.target = rest + POP_OUT;
          motion.v = 0;
        } else {
          motion.phase = 'settle';
          motion.target = rest;
          motion.v = 0;
        }
      });
      run();
    },
    [run],
  );

  useEffect(() => {
    measure();
    const row = rowRef.current;
    const list = row?.parentElement;
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (list) observer?.observe(list);
    const open = () => {
      hoveredRef.current = true;
      go(true);
      seedUnfold();
      window.clearTimeout(unfoldRef.current);
      unfoldRef.current = window.setTimeout(
        () => setUnfolded(true),
        UNFOLD_DELAY_MS,
      );
    };
    const close = () => {
      hoveredRef.current = false;
      window.clearTimeout(unfoldRef.current);
      setUnfolded(false);
      go(false);
    };
    const onEnter = open;
    const onLeave = close;
    const onFocus = open;
    const onBlur = close;
    row?.addEventListener('pointerenter', onEnter);
    row?.addEventListener('pointerleave', onLeave);
    row?.addEventListener('focusin', onFocus);
    row?.addEventListener('focusout', onBlur);
    return () => {
      stop();
      window.clearTimeout(unfoldRef.current);
      observer?.disconnect();
      row?.removeEventListener('pointerenter', onEnter);
      row?.removeEventListener('pointerleave', onLeave);
      row?.removeEventListener('focusin', onFocus);
      row?.removeEventListener('focusout', onBlur);
    };
  }, [go, measure, stop]);

  useEffect(() => {
    // A late webfont or a late translation changes the words; re-measure.
    let alive = true;
    const later = [
      window.setTimeout(() => alive && measure(), 300),
      window.setTimeout(() => alive && measure(), 1200),
    ];
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(() => {
        if (alive) measure();
      });
    }
    return () => {
      alive = false;
      later.forEach((timer) => window.clearTimeout(timer));
    };
  }, [measure]);

  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      }}
      className="drow group"
      data-unfold={unfolded ? 'on' : undefined}
    >
      <div className="drow-shell" aria-hidden="true">
        {unfolded ? (
          <div className="drow-shell-fx">
            <HoloMosaic
              color="#0d1113"
              metalColor="#e8ebf1"
              spectrum="cool"
              tileSize={0.6}
              gap={0.08}
              scatter={0.3}
              tilt={0.35}
              saturation={0.1}
              intensity={1.25}
              ripple={0.6}
              glitter={0.85}
              sheen={0.8}
              grain={0.08}
              speed={0.5}
              intro
              introSeconds={1.5}
              mouseInteraction
              flipOnClick
              roundness={0.15}
              bevel={0.35}
              swirl={1}
              bands={1.3}
              softness={0.5}
              variation={0}
              filter="none"
              filterSize={1}
              fade={0}
              opacity={1}
              mouseStrength={1}
              mouseRadius={0.25}
            />
          </div>
        ) : null}
      </div>
      {showGlyph ? <KbGlyph /> : null}
      <span className="drow-field drow-field--name">
        <span className="drow-value">{name}</span>
      </span>
      <span className="drow-field drow-field--meta">
        <span className="drow-value">{files}</span>
      </span>
      <span className="drow-field drow-field--meta">
        <span className="drow-value">{date}</span>
      </span>
      {badge ? <span className="drow-badge">{badge}</span> : null}
      {more ? (
        <span
          className="drow-more"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          role="presentation"
        >
          {more}
        </span>
      ) : null}
    </div>
  );
}

function fieldsOf(row: HTMLDivElement | null) {
  if (!row) return [];
  return Array.from(row.querySelectorAll<HTMLElement>('.drow-field'));
}

export default DatasetRow;
