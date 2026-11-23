import {
  ChangeEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ArrowRight, Loader2, Send } from 'lucide-react';
import './dispatch-seek.css';

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/* One spring for the width. Frames rather than milliseconds, and the
   damping is raised to dt so a dropped frame decays the same energy as
   the two it replaced — a spring that runs at a different speed on a
   busy page is the hardest kind of bug to see. */
const springOf = (tune: number) => ({
  k: 0.08 + (tune / 100) * 0.16,
  d: 0.62 + (tune / 100) * 0.2,
});

const useSpring = (target: number, tune: number, instant: boolean) => {
  const [at, setAt] = useState(target);
  const current = useRef(target);
  const velocity = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    if (instant) {
      current.current = target;
      velocity.current = 0;
      setAt(target);
      return;
    }
    const { k, d } = springOf(tune);
    let previous = 0;
    const tick = (time: number) => {
      const dt = previous ? clamp((time - previous) / 16.67, 0, 2.5) : 1;
      previous = time;
      velocity.current += (target - current.current) * k * dt;
      velocity.current *= Math.pow(d, dt);
      current.current += velocity.current * dt;
      if (
        Math.abs(target - current.current) < 0.02 &&
        Math.abs(velocity.current) < 0.02
      ) {
        current.current = target;
        velocity.current = 0;
        setAt(target);
        frame.current = 0;
        return;
      }
      setAt(current.current);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [target, tune, instant]);

  return at;
};

const stillness = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* The shut object is a circle, so its width IS its height. 36 matches
   the toolbar it sits in rather than the 48 the reference component
   used on an open card. */
const SHUT = 36;
const ICON = 18;
const INSET = (SHUT - ICON) / 2;
const WIDE = 420;
const SNUG = 240;
const PRESS = 90;
const PULL_RADIUS = 110;

interface DispatchSeekProps {
  value: string;
  placeholder: string;
  label: string;
  running?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

/**
 * 分发任务：一个圆，点开变成一条可输入的胶囊。
 *
 * 图标和输入框始终在同一个盒子里，宽度就是状态本身——所以看起来不是"一个按钮
 * 消失、一个输入框出现"，而是同一个对象被拉开。圆形时图标在正中间，拉开后
 * 同一个内缩量正好是输入框的左内边距，图标因此是"被盒子长出来留在原地"。
 */
const DispatchSeek = ({
  value,
  placeholder,
  label,
  running = false,
  disabled = false,
  onChange,
  onSubmit,
}: DispatchSeekProps) => {
  const [snug, setSnug] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 760px)').matches,
  );
  const [open, setOpen] = useState(false);
  const [press, setPress] = useState(false);
  const [lean, setLean] = useState({ x: 0, y: 0 });
  const frame = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const beat = useRef(0);
  const still = stillness();

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const room = window.matchMedia('(max-width: 760px)');
    const read = () => setSnug(room.matches);
    room.addEventListener('change', read);
    return () => room.removeEventListener('change', read);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(beat.current);
    },
    [],
  );

  const span = snug ? SNUG : WIDE;
  const target = open ? Math.max(SHUT, span) : SHUT;
  const width = useSpring(target, 32, still);
  const progress = clamp(
    (width - SHUT) / Math.max(1, Math.max(SHUT, span) - SHUT),
    0,
    1,
  );

  /* Measured from the frame, which never moves, not from the object it is
     displacing — a vector read off the thing it moves is a feedback loop,
     and at this size the loop is visible as a shiver. Off once open: a
     field that drifts while you try to click into it is fighting you. */
  useEffect(() => {
    const element = frame.current;
    if (!element || open || still || disabled) return;
    let raf = 0;
    let next = { x: 0, y: 0 };
    const publish = () => {
      raf = 0;
      setLean(next);
    };
    const read = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height / 2);
      const distance = Math.hypot(dx, dy);
      if (distance > PULL_RADIUS) {
        if (next.x || next.y) {
          next = { x: 0, y: 0 };
          if (!raf) raf = requestAnimationFrame(publish);
        }
        return;
      }
      const pull = (1 - distance / PULL_RADIUS) ** 1.4 * 4.5;
      next = {
        x: (dx / (distance || 1)) * pull,
        y: (dy / (distance || 1)) * pull,
      };
      if (!raf) raf = requestAnimationFrame(publish);
    };
    const away = () => {
      next = { x: 0, y: 0 };
      if (!raf) raf = requestAnimationFrame(publish);
    };
    document.addEventListener('pointermove', read, { passive: true });
    document.addEventListener('pointerleave', away);
    return () => {
      document.removeEventListener('pointermove', read);
      document.removeEventListener('pointerleave', away);
      cancelAnimationFrame(raf);
    };
  }, [open, still, disabled]);

  /* Compress, then expand, then focus. 90ms is long enough to read as the
     object yielding and short enough that nobody waits for it. */
  const start = () => {
    if (open || disabled || running) return;
    setPress(true);
    window.clearTimeout(beat.current);
    beat.current = window.setTimeout(() => {
      setPress(false);
      setOpen(true);
      field.current?.focus();
    }, still ? 0 : PRESS);
  };

  /* Away with nothing typed and it goes back. Away with something typed and
     it stays: the text is the reason the field exists. */
  const away = () => {
    if (value.trim()) return;
    setOpen(false);
  };

  const submit = () => {
    if (!value.trim() || disabled || running) return;
    onSubmit();
    setOpen(false);
    field.current?.blur();
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      field.current?.blur();
    }
  };

  return (
    <div
      className="dispatch-seek"
      ref={frame}
      data-open={open}
      data-press={press}
      data-running={running}
      data-disabled={disabled || undefined}
      data-flat={still || undefined}
      style={
        {
          '--w': width.toFixed(2) + 'px',
          '--say': clamp((progress - 0.55) / 0.45, 0, 1).toFixed(3),
          '--lx': lean.x.toFixed(2) + 'px',
          '--ly': lean.y.toFixed(2) + 'px',
          '--inset': INSET + 'px',
          '--icon': ICON + 'px',
          '--shut': SHUT + 'px',
        } as React.CSSProperties
      }
    >
      <div className="dispatch-seek-skin">
        <span className="dispatch-seek-mark" aria-hidden>
          {running ? (
            <Loader2 className="dispatch-seek-spin" size={ICON} />
          ) : (
            <Send size={ICON} />
          )}
        </span>

        <input
          ref={field}
          className="dispatch-seek-field"
          type="text"
          value={value}
          autoComplete="off"
          enterKeyHint="send"
          placeholder={placeholder}
          aria-label={label}
          tabIndex={open ? 0 : -1}
          onChange={handleChange}
          onBlur={away}
          onKeyDown={handleKeyDown}
        />

        {open && value.trim() ? (
          <button
            type="button"
            className="dispatch-seek-go"
            aria-label={label}
            onClick={submit}
          >
            <ArrowRight size={13} />
          </button>
        ) : null}

        {!open ? (
          <button
            type="button"
            className="dispatch-seek-hit"
            aria-label={label}
            title={label}
            disabled={disabled || running}
            onClick={start}
          />
        ) : null}
      </div>
    </div>
  );
};

export default DispatchSeek;