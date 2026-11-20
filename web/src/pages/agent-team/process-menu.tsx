import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronDown,
  Columns3,
  Handshake,
  ListOrdered,
  Lock,
  LucideIcon,
  MessagesSquare,
  Network,
  Vote,
} from 'lucide-react';
import { AgentTeamProcess } from '@/interfaces/database/agent';
import { AGENT_TEAM_PROCESSES } from '@/pages/agent/form/agent-team-form/interface';
import { cn } from '@/lib/utils';
import { playFanSound } from './team-fan';
import './process-menu.css';

/**
 * How this run will be organised, chosen before it starts.
 *
 * A pill that is also the panel's own header: press it and the shape it sits in
 * grows to hold the six processes, one row each, the current one ticked. Press a
 * row and the team's collaboration mode is rewritten on its canvas.
 *
 * The shape is one opaque body, and the rows are laid out INSIDE it: the body
 * clips, so rows that start arriving while it is still growing are revealed by
 * the growth instead of drawn over the page. Two numbers animate — width and
 * height — plus the corner radius.
 *
 * Once a run is under way the mode is a fact, not a choice: the control locks
 * and says so instead of pretending it can still be changed.
 */

const PILL_H = 38;
const MENU_W = 246;
const ROW_H = 34;

export const PROCESS_ICONS: Record<AgentTeamProcess, LucideIcon> = {
  sequential: ListOrdered,
  hierarchical: Network,
  parallel: Columns3,
  vote: Vote,
  debate: MessagesSquare,
  consensus: Handshake,
};

interface ProcessMenuProps {
  value: AgentTeamProcess;
  /** a run is in flight: the mode cannot change under it */
  locked?: boolean;
  saving?: boolean;
  onChange: (process: AgentTeamProcess) => void;
}

const ProcessMenu = ({
  value,
  locked = false,
  saving = false,
  onChange,
}: ProcessMenuProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pillW, setPillW] = useState(148);
  const stage = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const pill = useRef<HTMLButtonElement | null>(null);

  /* the shut pill is as wide as its own label, so the body can be told where to
     start from — measured rather than guessed, and measured again when the label
     or the icon changes */
  useLayoutEffect(() => {
    const el = pill.current;
    if (!el) return;
    const measure = () => setPillW(el.offsetWidth + 1);
    measure();
    document.fonts?.ready.then(measure).catch(() => undefined);
    const watcher =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    watcher?.observe(el);
    return () => watcher?.disconnect();
  }, [value, locked]);

  useEffect(() => {
    if (!open) return;

    /* a press by somebody, anywhere off the panel, puts it away. Trusted only:
       a scripted press dispatched by another demo is not a decision to leave.

       Hit-tested against the BODY, not the stage: the stage is only as tall as
       the shut pill, so asking it would count every row — the part that grew —
       as outside, and a press on a row would shut the panel before the row's
       own click arrived. */
    const away = (event: PointerEvent) => {
      if (!event.isTrusted) return;
      const box = body.current?.getBoundingClientRect();
      const inside =
        !!box &&
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      if (!inside) setOpen(false);
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const toggle = useCallback(() => {
    if (locked || saving) return;
    const next = !open;
    setOpen(next);
    playFanSound(next ? 'open' : 'close');
  }, [locked, saving, open]);

  const pick = useCallback(
    (process: AgentTeamProcess, index: number) => {
      playFanSound('tick', index);
      setOpen(false);
      if (process !== value) onChange(process);
    },
    [onChange, value],
  );

  const rows = AGENT_TEAM_PROCESSES;
  const height = open ? PILL_H + rows.length * ROW_H + 14 : PILL_H;
  const Icon = PROCESS_ICONS[value] ?? Network;

  return (
    <div
      ref={stage}
      className="pml"
      data-open={open || undefined}
      data-locked={locked || undefined}
    >
      {/* Rows live INSIDE the body, which clips them: they can start arriving
          while the body is still growing and are revealed by it rather than
          drawn on top of the page. */}
      <div
        ref={body}
        className="pml-body"
        style={{
          width: open ? MENU_W : pillW,
          height,
          borderRadius: open ? 16 : PILL_H / 2,
        }}
      >
        {open && (
          <div
            className="pml-menu"
            role="menu"
            aria-label={t('flow.agentTeam.page.processLabel')}
          >
            {rows.map((process, index) => {
              const RowIcon = PROCESS_ICONS[process] ?? Network;
              const current = process === value;
              return (
                <button
                  key={process}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  className={cn('pml-row', current && 'is-current')}
                  style={{ animationDelay: `${24 + index * 22}ms` }}
                  onClick={() => pick(process, index)}
                >
                  <RowIcon size={15} strokeWidth={2} className="pml-row-glyph" />
                  <span className="pml-row-label">
                    {t(`flow.agentTeam.process.${process}.label`)}
                  </span>
                  {current && (
                    <Check size={14} strokeWidth={2.4} className="pml-tick" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* above the body, so the label stays legible while the panel grows */}
      <button
        ref={pill}
        type="button"
        className="pml-pill"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={locked}
        title={
          locked
            ? t('flow.agentTeam.page.processLocked')
            : t('flow.agentTeam.page.processHint')
        }
        onClick={toggle}
      >
        <Icon size={15} strokeWidth={2} className="pml-glyph" />
        <span className="pml-say">
          {t(`flow.agentTeam.process.${value}.label`)}
        </span>
        {locked ? (
          <Lock size={13} strokeWidth={2} className="pml-tail" />
        ) : (
          <ChevronDown size={14} strokeWidth={2} className="pml-tail pml-chev" />
        )}
      </button>
    </div>
  );
};

export default ProcessMenu;
