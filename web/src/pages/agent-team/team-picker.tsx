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
import { Check, ChevronDown } from 'lucide-react';
import { IFlow } from '@/interfaces/database/agent';
import { IAgentTeamSummary } from './utils/extract-teams';
import { AgentAvatar } from './result-dial';
import { playFanSound } from './team-fan';
import './team-picker.css';

/**
 * Who is on this collaboration.
 *
 * The dots are not decoration and they are not a count: they are the agents
 * this team is made of, and pressing the pill offers the agents that already
 * exist so a team is ASSEMBLED rather than authored. There is no second place
 * to type a prompt — the agent you pick already has one.
 *
 * The faces themselves are the readout: a stack says who, in the order they
 * were added, where "3 selected" would only say how many.
 */

/* matched against the refusal thrown by use-assign-workers */
const NO_BRAIN = 'no model step';

const FACE = 38;
/* how much of each face the next one covers — with no letters on the dots the
   stack can lap hard, the way a row of avatars does */
/* 形状不是圆，压太多会把角吃掉，叠 5px 就够看出是一摞 */
const LAP = 15;
/* the rail holds three faces and then says how many are behind it */
const RAIL = 3;
const PANEL_W = 268;
const PANEL_MAX_H = 306;

interface Option {
  id: string;
  name: string;
  hint: string;
}

interface TeamPickerProps {
  team: IAgentTeamSummary;
  roster: IFlow[];
  onAssign: (workerIds: string[]) => void;
  saving?: boolean;
  /** why the last attempt to change the crew was refused */
  failure?: string;
}

const TeamPicker = ({
  team,
  roster,
  onAssign,
  saving = false,
  failure,
}: TeamPickerProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    bottom: number;
    up: boolean;
    maxH: number;
  }>();
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const picked = team.workers.map((worker) => worker.id);

  /* Agents that exist, plus anyone already on the team who is not in that list
     (a team can hold workers seeded before agents were the unit). Those stay
     visible so nothing on the team is unreachable. */
  const options = useMemo<Option[]>(() => {
    const inRoster = new Set(roster.map((agent) => agent.id));
    const extra: Option[] = team.workers
      .filter((worker) => !inRoster.has(worker.id))
      .map((worker) => ({
        id: worker.id,
        name: worker.name || worker.id,
        hint: t('flow.agentTeam.page.assignExtra'),
      }));

    const known: Option[] = roster.map((agent) => ({
      id: agent.id,
      name: agent.title || agent.id,
      hint: agent.description || t('flow.agentTeam.page.assignAgent'),
    }));

    return [...known, ...extra];
  }, [roster, team.workers, t]);

  const shown = team.workers.slice(0, RAIL);
  const behind = team.workers.length - shown.length;
  const rail = shown.length
    ? FACE + (shown.length - 1) * (FACE - LAP)
    : 0;

  /* ── where the list can actually go ──────────────────────
     A card near the bottom of the window has no room below it, so the list has
     to open upward — and it has to shrink to whatever room is there instead of
     running off the screen. The height is decided here and handed to the panel
     as max-height; the list scrolls inside it.

     Up and down are anchored on different edges (bottom / top) rather than on a
     transform: the unfold animation owns transform, and an inline translate
     would be overridden by it every frame. */
  const place = useCallback(() => {
    const rect = pillRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 8;
    const edge = 12;
    const below = window.innerHeight - rect.bottom - gap - edge;
    const above = rect.top - gap - edge;
    const up = below < PANEL_MAX_H && above > below;
    const room = up ? above : below;
    setAnchor({
      left: Math.min(
        Math.max(gap, rect.left),
        Math.max(gap, window.innerWidth - PANEL_W - gap),
      ),
      top: rect.top,
      bottom: rect.bottom,
      up,
      maxH: Math.max(96, Math.min(PANEL_MAX_H, room)),
    });
  }, []);

  const toggleOpen = useCallback(
    (event: React.MouseEvent) => {
      /* the card underneath selects the team on click; opening the crew list is
         not selecting the team */
      event.stopPropagation();
      setOpen((value) => {
        const next = !value;
        playFanSound(next ? 'open' : 'close');
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      setAnchor(undefined);
      return;
    }
    place();

    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target) ||
        pillRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    /* capture, so a scroll in the board's own column moves the list with the
       pill instead of leaving it behind */
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const toggleWorker = useCallback(
    (id: string) => {
      playFanSound('tick', 1);
      const next = picked.includes(id)
        ? picked.filter((value) => value !== id)
        : [...picked, id];
      onAssign(next);
    },
    [onAssign, picked],
  );

  return (
    <div className="pk">
      <button
        ref={pillRef}
        type="button"
        className="pk-pill"
        aria-expanded={open}
        aria-haspopup="listbox"
        data-empty={shown.length === 0 || undefined}
        onClick={toggleOpen}
      >
        <span className="pk-rail" style={{ width: rail }}>
          {shown.map((worker, i) => (
            <span
              key={worker.id}
              className="pk-face"
              title={worker.name || worker.id}
              style={
                {
                  transform: `translateX(${i * (FACE - LAP)}px)`,
                  zIndex: shown.length - i,
                  '--i': i,
                } as CSSProperties
              }
            >
              <AgentAvatar
                seed={worker.agent_id || worker.id || worker.name || ''}
                size={38}
              />
            </span>
          ))}
        </span>
        {behind > 0 && <span className="pk-say pk-behind">+{behind}</span>}
        {shown.length === 0 && (
          <span className="pk-say">
            {t('flow.agentTeam.page.assignNone')}
          </span>
        )}
        {saving && <span className="pk-say pk-saving">…</span>}
        <ChevronDown
          className="pk-chev"
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          data-open={open || undefined}
        />
      </button>

      {failure && (
        <p className="pk-note">
          {t(
            /* an orchestration canvas has no model step to lend, and that is a
               different thing to say than "it broke" */
            failure.includes(NO_BRAIN)
              ? 'flow.agentTeam.page.assignNoBrain'
              : 'flow.agentTeam.page.assignFailed',
          )}
        </p>
      )}


      {open &&
        anchor &&
        createPortal(
          <div
            ref={panelRef}
            className="pk-card"
            role="listbox"
            aria-multiselectable="true"
            data-up={anchor.up || undefined}
            style={
              anchor.up
                ? {
                    left: anchor.left,
                    /* the panel's own bottom edge sits above the pill */
                    bottom: window.innerHeight - anchor.top + 8,
                    maxHeight: anchor.maxH,
                  }
                : {
                    left: anchor.left,
                    top: anchor.bottom + 8,
                    maxHeight: anchor.maxH,
                  }
            }
            onClick={(event) => event.stopPropagation()}
          >
            <p className="pk-head">
              {t('flow.agentTeam.page.assignHint')}
            </p>
            <div className="pk-list">
              {options.length === 0 && (
                <p className="pk-empty">
                  {t('flow.agentTeam.page.assignEmptyRoster')}
                </p>
              )}
              {options.map((option, i) => {
                const on = picked.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    className="pk-row"
                    data-on={on || undefined}
                    style={{ '--i': i } as CSSProperties}
                    onClick={() => toggleWorker(option.id)}
                  >
                    <span className="pk-face pk-face--row">
                      <AgentAvatar seed={option.id} size={36} />
                    </span>
                    <span className="pk-who">
                      <span className="pk-name">{option.name}</span>
                      <span className="pk-hint">{option.hint}</span>
                    </span>
                    <span className="pk-mark">
                      {on && (
                        <span className="pk-tick">
                          <Check size={13} strokeWidth={2.4} />
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default TeamPicker;