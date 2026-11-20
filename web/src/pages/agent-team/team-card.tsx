import {
  CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Copy,
  ExternalLink,
  MousePointerClick,
  Users,
} from 'lucide-react';
import { IFlow } from '@/interfaces/database/agent';
import { cn } from '@/lib/utils';
import { IAgentTeamSummary } from './utils/extract-teams';
import { playFanSound } from './team-fan';
import TeamPicker from './team-picker';
import './team-card.css';

/**
 * One team in the left rail, built the way lab/ActionNode builds a step card:
 * the controls are the component. Everything else — the mark, the name, the
 * line about the team, the row of faces — is a card, and a card is not an
 * interaction. What this file is about is where a card's actions live when you
 * are not using them, and the answer it argues for is: just outside the corner
 * they belong to.
 *
 * THEY COME OUT OF THE CORNER, THEY DO NOT ARRIVE AT IT. The buttons are drawn
 * on a path offset from the card's own outline — straight along the top edge,
 * round the corner on an arc concentric with it, straight down the right edge —
 * and they start AT the corner with no radius, travelling out along it. Which
 * is why they scale as they travel: a thing coming out of somewhere is small
 * when it is still mostly inside it.
 *
 * THE FAN HANGS OUTSIDE THE CARD. The rail clips its children, so the fan is
 * rendered into a fixed layer anchored on the card's corner instead of inside
 * the scrolling box: same origin, same geometry, and the buttons are not cut
 * off at the panel edge.
 */

/* ── one spring, for everything that settles ───────────────
   Frames, not milliseconds. `dt` is expressed in sixtieths of a second and the
   damping is RAISED to it rather than multiplied by it, so a dropped frame
   decays the same amount of energy as the two frames it replaced. */
const springOf = (tune: number) => ({
  /* stiffness: how hard it is pulled toward the target */
  k: 0.08 + (tune / 100) * 0.16,
  /* decay, per frame: how much of the velocity survives */
  d: 0.62 + (tune / 100) * 0.2,
});

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

function useSpring(target: number, tune = 50, instant = false) {
  const [at, setAt] = useState(target);
  const cur = useRef(target);
  const vel = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    if (instant) {
      cur.current = target;
      vel.current = 0;
      setAt(target);
      return;
    }
    const { k, d } = springOf(tune);
    let prev = 0;
    const tick = (t: number) => {
      const dt = prev ? clamp((t - prev) / 16.67, 0, 2.5) : 1;
      prev = t;
      vel.current += (target - cur.current) * k * dt;
      vel.current *= Math.pow(d, dt);
      cur.current += vel.current * dt;
      if (
        Math.abs(target - cur.current) < 0.02 &&
        Math.abs(vel.current) < 0.02
      ) {
        cur.current = target;
        vel.current = 0;
        setAt(target);
        raf.current = 0;
        return;
      }
      setAt(cur.current);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    /* `tune` sits here beside `target`: the loop closes over it, so without it a
       knob turned mid-flight would do nothing until something else restarted the
       effect. Restarting picks up from the refs, so it continues rather than
       snapping. */
  }, [target, tune, instant]);

  return at;
}

/* Read once, the way the wheel and the pill nav do. A preference, not a live
   input. */
const stillness = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* the button and half of it. Everything else that has a size is measured off
   this one — the spacing, the hiding place, the air the fan keeps — so the
   buttons grow by changing this number and nothing else. */
const DOT = 36;
const R = DOT / 2;

/* centre to centre along the path. A real distance rather than an angle, which
   is the point of laying these out by arc length: twelve pixels of air between
   two buttons is twelve pixels whatever the corner is doing. */
const SPACING = DOT + 12;

/* the beat between one button and the next, at the top of the range. 90ms is
   about as long as a cascade can be before the last one reads as late rather
   than as following. */
const BEAT = 90;

/* ── they ride the card's OWN corner, offset ───────────────
   The path is the card's outline pushed out by a constant distance: straight
   along the top edge, round the corner on an arc concentric with it, straight
   down the right edge. Buttons are placed by how far along that path they are. */
function ride(s: number, corner: number, off: number) {
  const arc = Math.max(0.001, corner + off);
  const len = (arc * Math.PI) / 2;
  if (s <= 0) {
    /* along the top edge, going left */
    return { x: -corner + s, y: -off, nx: 0, ny: -1 };
  }
  if (s >= len) {
    /* down the right edge */
    return { x: off, y: corner + (s - len), nx: 1, ny: 0 };
  }
  const th = Math.PI / 2 - s / arc;
  return {
    x: -corner + arc * Math.cos(th),
    y: corner - arc * Math.sin(th),
    nx: Math.cos(th),
    ny: -Math.sin(th),
  };
}

/* ── where they hide, and it has to be PROVABLY inside ─────
   A point on the card's diagonal, far enough in that a whole button fits behind
   the card with nothing showing past the corner. Two cases, because a rounded
   corner is bitten out of the very material a square one has. */
const hideAt = (corner: number) =>
  corner >= R + 2
    ? corner * Math.SQRT2
    : Math.max(R * Math.SQRT2 + 2, corner * Math.SQRT2 + corner + 2);

/* ── the air between the card and the fan ─────────────────
   The scale is the original 0..100 one and the knob is allowed a narrow window
   of it: 20 to 40, which is 11px of gap to 16. */
const gapPx = (reach: number) => 6 + (clamp(reach, 20, 40) / 100) * 24;

interface TeamCardProps {
  team: IAgentTeamSummary;
  active: boolean;
  /** True while another card in the rail is the one being pointed at. */
  dimmed?: boolean;
  onSelect: (team: IAgentTeamSummary, key: string) => void;
  onOpenCanvas: (team: IAgentTeamSummary) => void;
  onHoverChange?: (hovered: boolean) => void;
  teamKey: (team: IAgentTeamSummary) => string;
  /** the air between the card and the buttons, 20..40 */
  reach?: number;
  /** the spring, 0..100 */
  bounce?: number;
  /** how far apart the buttons open, 0..100 */
  stagger?: number;
  /** the agents that already exist, offered as this team's crew */
  roster: IFlow[];
  /** the crew changed: put these agents on the team */
  onAssign: (workerIds: string[]) => void;
  assigning?: boolean;
  assignFailure?: string;
  /** so the rail can find and reveal this card when it becomes the selection */
  'data-team-key'?: string;
}

const TeamCard = ({
  team,
  active,
  dimmed = false,
  onSelect,
  onOpenCanvas,
  onHoverChange,
  teamKey,
  reach = 25,
  bounce = 20,
  stagger = 55,
  roster,
  onAssign,
  assigning = false,
  assignFailure,
  'data-team-key': dataTeamKey,
}: TeamCardProps) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(0);
  const still = stillness();

  const actions = useMemo(
    () => [
      {
        id: 'canvas',
        label: t('flow.agentTeam.page.viewCanvas'),
        Icon: ExternalLink,
        run: () => onOpenCanvas(team),
      },
      {
        id: 'select',
        label: t('flow.agentTeam.page.actionSelect'),
        Icon: MousePointerClick,
        run: () => onSelect(team, teamKey(team)),
      },
      {
        id: 'copy',
        label: copied
          ? t('flow.agentTeam.page.actionCopied')
          : t('flow.agentTeam.page.actionCopy'),
        Icon: copied ? Check : Copy,
        run: () => {
          void navigator.clipboard
            ?.writeText(team.agentTitle)
            .catch(() => undefined);
          setCopied(true);
          window.clearTimeout(copyTimer.current);
          copyTimer.current = window.setTimeout(() => setCopied(false), 1400);
        },
      },
    ],
    [copied, onOpenCanvas, onSelect, t, team, teamKey],
  );

  const n = clamp(actions.length, 2, 4);

  /* ── open, and then open PER BUTTON ─────────────────────
     `on` is the pointer. `lit` is what each spring is aiming at, which is the
     same thing a moment later — and the moment is the stagger. Kept as four
     flags rather than as a count, so the reverse fold is the same mechanism
     read backwards rather than a second one. */
  const [on, setOn] = useState(false);
  const [lit, setLit] = useState([false, false, false, false]);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const gap = still ? 0 : (clamp(stagger, 0, 100) / 100) * BEAT;
    for (let i = 0; i < 4; i += 1) {
      /* opening runs first to last; closing runs last to first, so the fan folds
         back into the corner in the order it came out of it */
      const place = on ? i : n - 1 - i;
      const at = gap * place;
      const set = () =>
        setLit((prev) => {
          if (prev[i] === on) return prev;
          const next = [...prev];
          next[i] = on;
          return next;
        });
      if (at <= 0) set();
      else timers.current.push(window.setTimeout(set, at));
    }
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [on, n, stagger, still]);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  /* Four, always, whatever `n` says: a hook cannot be drawn conditionally and a
     spring nobody reads costs a number that never moves. */
  const p0 = useSpring(lit[0] ? 100 : 0, bounce, still);
  const p1 = useSpring(lit[1] ? 100 : 0, bounce, still);
  const p2 = useSpring(lit[2] ? 100 : 0, bounce, still);
  const p3 = useSpring(lit[3] ? 100 : 0, bounce, still);
  const at = [p0, p1, p2, p3];

  /* one sound on the corner opening, one as each button lands */
  const ticked = useRef([false, false, false, false]);
  useEffect(() => {
    playFanSound(on ? 'open' : 'close');
    if (!on) ticked.current = [false, false, false, false];
  }, [on]);

  useEffect(() => {
    if (!on) return;
    for (let i = 0; i < n; i += 1) {
      if (!ticked.current[i] && at[i] > 55) {
        ticked.current[i] = true;
        playFanSound('tick', i);
      }
    }
  }, [at, on, n]);

  /* ── where each button ends up ──────────────────────────
     The path is offset from the card by the gap PLUS a button's own half, so
     the gap is measured from the card to the button's edge rather than to its
     middle. Centred on the corner's midpoint and spread by arc length, so the
     fan is symmetrical about the diagonal however many are on it. */
  const c = 20;
  const off = gapPx(reach) + R;
  const mid = ((c + off) * Math.PI) / 4;
  const spots = Array.from({ length: n }, (_, i) =>
    ride(mid + (i - (n - 1) / 2) * SPACING, c, off),
  );

  /* the one place they all fold back to */
  const deep = hideAt(c) / Math.SQRT2;
  const hid = { x: -deep, y: deep };

  /* ── the air between the card and the fan is a HOLE ─────
     The buttons hang outside the card, so the pixels of air belong to nothing at
     all: move the pointer toward a button and it leaves the card on the way
     across. So the fan carries a hit area: the box its own buttons occupy, bled
     a little, hung off the same corner anchor. Live only while it is open. */
  const BLEED = 6;
  const box = spots.reduce(
    (b, s) => ({
      l: Math.min(b.l, s.x - R - BLEED),
      r: Math.max(b.r, s.x + R + BLEED),
      t: Math.min(b.t, s.y - R - BLEED),
      d: Math.max(b.d, s.y + R + BLEED),
    }),
    { l: 0, r: 0, t: 0, d: 0 },
  );
  const pw = box.r - box.l;
  const ph = box.d - box.t;
  const px = -box.l;
  const py = -box.t;

  /* ── and the bite taken out of it is INSIDE the card ────
     The pad is a rectangle and the card is in one corner of it, so a piece has
     to come out or the pad lies over the card's surface. x < -c with y > c is
     card at every radius, so that is the rectangle to lose. */
  const bx = Math.max(0, px - c);
  const by = Math.min(ph, py + c);

  /* ── the corner the fan is struck from ──────────────────
     The layer is fixed to the viewport, so it is measured when the card opens
     and again if anything scrolls underneath it. */
  const cardRef = useRef<HTMLDivElement | null>(null);
  const fanRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  const aim = useCallback(() => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ x: rect.right, y: rect.top });
  }, []);

  useEffect(() => {
    if (!on) {
      setAnchor(null);
      return;
    }
    aim();
    const onScroll = () => setOn(false);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', aim);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', aim);
    };
  }, [on, aim]);

  /* ── `out` with a containment test, not `leave` ────────
     The buttons live in another layer, so leaving the card for one of them must
     not fold the fan away from under the cursor that was reaching for it. */
  const handleOut = useCallback(
    (event: React.PointerEvent) => {
      const to = event.relatedTarget as Node | null;
      if (
        !to ||
        !(
          cardRef.current?.contains(to) || fanRef.current?.contains(to)
        )
      ) {
        setOn(false);
        onHoverChange?.(false);
      }
    },
    [onHoverChange],
  );

  /* ── the crew picker is not card hover ──────────────────
     The pill and its list sit inside the card, so reaching for them used to
     count as entering the card and opened the fan underneath the thing being
     clicked. The picker is an interaction of its own, so it neither opens the
     fan nor keeps one open: pointer and focus both ask the same question. */
  const inPicker = (target: EventTarget | null) =>
    target instanceof Element && !!target.closest('.pk, .pk-card');

  const handleEnter = useCallback(
    (event: React.PointerEvent) => {
      if (inPicker(event.target)) {
        setOn(false);
        return;
      }
      setOn(true);
      onHoverChange?.(true);
    },
    [onHoverChange],
  );

  const handleFocus = useCallback(
    (event: React.FocusEvent) => {
      if (inPicker(event.target)) {
        setOn(false);
        return;
      }
      setOn(true);
      onHoverChange?.(true);
    },
    [onHoverChange],
  );

  const handleSelect = useCallback(() => {
    onSelect(team, teamKey(team));
  }, [onSelect, team, teamKey]);

  const fan =
    anchor &&
    createPortal(
      <div
        ref={fanRef}
        className="nod-fan"
        style={{ left: anchor.x, top: anchor.y }}
        onPointerOut={handleOut}
        onPointerCancel={() => setOn(false)}
      >
        <i
          className="nod-reach"
          aria-hidden="true"
          data-on={on || undefined}
          style={{
            left: box.l,
            top: box.t,
            width: pw,
            height: ph,
            clipPath: `polygon(0 0, ${pw}px 0, ${pw}px ${ph}px, ${bx}px ${ph}px, ${bx}px ${by}px, 0 ${by}px)`,
          }}
        />
        {actions.slice(0, n).map((action, i) => {
          const u = clamp(at[i] / 100, 0, 1.4);
          const spot = spots[i];
          /* out of the corner, in a straight line: from the hidden point to its
             place on the path. `u` is not clamped, so the spring's overshoot
             carries each button a little past its place and back. */
          const put = (a: number, b: number) => a + (b - a) * u;
          return (
            <button
              key={action.id}
              className="nod-act"
              type="button"
              aria-label={action.label}
              title={action.label}
              tabIndex={on ? 0 : -1}
              style={
                {
                  width: DOT,
                  height: DOT,
                  marginTop: -R,
                  marginLeft: -R,
                  translate: `${put(hid.x, spot.x)}px ${put(hid.y, spot.y)}px`,
                  '--pop': 0.82 + 0.18 * Math.min(u, 1),
                } as CSSProperties
              }
              onClick={(event) => {
                event.stopPropagation();
                action.run();
              }}
            >
              <action.Icon size={16} strokeWidth={2} />
            </button>
          );
        })}
      </div>,
      document.body,
    );

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="team-card"
      data-team-key={dataTeamKey}
      ref={cardRef}
      data-open={on || undefined}
      data-dimmed={dimmed || undefined}
      className={cn('nod', active && 'is-active')}
      onClick={handleSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleSelect();
        }
      }}
      /* over rather than enter: over names the element actually under the
         pointer, which is the only way to tell the card from its picker */
      onPointerOver={handleEnter}
      onPointerOut={handleOut}
      onPointerCancel={() => setOn(false)}
      onFocus={handleFocus}
      onBlur={() => {
        setOn(false);
        onHoverChange?.(false);
      }}
    >
      <div className="nod-card">
        <div className="nod-top">
          <span className="nod-mark" aria-hidden="true">
            <Users size={18} strokeWidth={2} />
          </span>
          <span className="nod-name" title={team.agentTitle}>
            {team.agentTitle}
          </span>
        </div>

        <p className="nod-say">
          {t(`flow.agentTeam.process.${team.process}.label`)}
          {' · '}
          {t('flow.agentTeam.page.participants', {
            count: team.workers.length,
          })}
          {' · '}
          {t('flow.agentTeam.page.tasks', { count: team.tasks.length })}
        </p>

        {/* the crew, and the only place it is decided: existing agents, picked */}
        <TeamPicker
          team={team}
          roster={roster}
          onAssign={onAssign}
          saving={assigning}
          failure={assignFailure}
        />
      </div>
      {fan}
    </div>
  );
};

export default TeamCard;
