import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import "./thought-line.css";

const EMPTY_STEPS: string[] = [];

const fmt = (ds: number) =>
  ds < 600
    ? `${(ds / 10).toFixed(1)}s`
    : `${Math.floor(ds / 600)}m ${((ds % 600) / 10).toFixed(1)}s`;

const spoken = (ds: number) =>
  ds < 600
    ? `${(ds / 10).toFixed(1)} seconds`
    : `${Math.floor(ds / 600)} minutes ${((ds % 600) / 10).toFixed(1)} seconds`;

function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <path
        d="M12 2.6l1.9 5.3a3 3 0 0 0 1.8 1.8l5.3 1.9-5.3 1.9a3 3 0 0 0-1.8 1.8L12 20.6l-1.9-5.3a3 3 0 0 0-1.8-1.8L3 11.6l5.3-1.9a3 3 0 0 0 1.8-1.8z"
        fill="currentColor"
      />
    </svg>
  );
}

export interface ThoughtLineProps {
  label?: string;
  doneLabel?: string;
  glyph?: "sparkle" | "dot" | "none";
  steps?: string[];
  collapsible?: boolean;
  collapseOnSettle?: boolean;
  color?: string;
  glyphColor?: string;
  fontSize?: number;
  breathPeriod?: number;
  breathDepth?: number;
  settleDuration?: number;
  settleBlur?: number;
  working?: boolean;
  showTimer?: boolean;
  /** Seconds after settling before the line takes itself away. Zero keeps it. */
  lingerAfterSettle?: number;
  onSettle?: (seconds: number) => void;
  className?: string;
}

/**
 * The thinking line above an answer: a breathing glyph and label with a live timer while the
 * model works, settling into "Thought for 3.2s" once the first token lands. Self-contained (CSS
 * animations only) so it adds no runtime dependency to the chat bundle.
 */
export function ThoughtLine({
  label = "Thinking…",
  doneLabel = "Thought for",
  glyph = "sparkle",
  steps = EMPTY_STEPS,
  collapsible = true,
  collapseOnSettle = true,
  color,
  glyphColor,
  fontSize = 14,
  breathPeriod = 1.6,
  breathDepth = 0.45,
  settleDuration = 350,
  settleBlur = 2,
  working = true,
  showTimer = true,
  lingerAfterSettle = 0,
  onSettle,
  className,
}: ThoughtLineProps) {
  const [ds, setDs] = useState(0);
  const [open, setOpen] = useState(true);
  const [gone, setGone] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const previous = useRef(working);
  const hasTrace = steps.length > 0;

  useEffect(() => {
    if (!working) return undefined;
    const startedAt = performance.now() - ds * 100;
    const id = window.setInterval(() => {
      setDs(Math.floor((performance.now() - startedAt) / 100));
    }, 100);
    return () => window.clearInterval(id);
    // The timer restarts only when the line starts working.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working]);

  useEffect(() => {
    if (working) {
      setOpen(true);
      setGone(false);
      setLeaving(false);
      previous.current = true;
      return undefined;
    }
    if (previous.current) {
      previous.current = false;
      onSettle?.(ds / 10);
      if (collapseOnSettle) setOpen(false);
      if (!lingerAfterSettle) return undefined;
      // Fade out instead of blinking away once the line has had its time on screen.
      const fade = window.setTimeout(
        () => setLeaving(true),
        lingerAfterSettle * 1000,
      );
      const drop = window.setTimeout(
        () => setGone(true),
        lingerAfterSettle * 1000 + 240,
      );
      return () => {
        window.clearTimeout(fade);
        window.clearTimeout(drop);
      };
    }
    return undefined;
    // Settling should fire once per transition, not on every tick of the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working, collapseOnSettle, lingerAfterSettle]);

  if (gone) return null;

  const doneText = doneLabel || "Done thinking";
  const toggle = hasTrace && collapsible;

  const head = (
    <>
      {glyph === "none" ? null : (
        <span className="thought-line__glyph" aria-hidden="true">
          {glyph === "sparkle" ? (
            <Sparkle />
          ) : (
            <span className="thought-line__pulse" />
          )}
        </span>
      )}
      <span className="thought-line__label" aria-hidden="true">
        {/* One label at a time: the two strings swap places with a blur-in, so the
            hidden one can never ghost through the visible one. */}
        <span key={working ? "working" : "done"} className="thought-line__text">
          <span
            className={
              working
                ? "thought-line__breath"
                : "thought-line__text-inner thought-line__text--done"
            }
          >
            {working ? label : doneText}
          </span>
        </span>
      </span>
      {showTimer ? (
        <span
          className="thought-line__timer"
          data-done={working ? undefined : ""}
          aria-hidden="true"
        >
          {fmt(ds)}
        </span>
      ) : null}
      {collapsible ? (
        <span
          className="thought-line__chevron"
          data-on={hasTrace ? "" : undefined}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" width="100%" height="100%">
            <path
              d="M6 9l6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : null}
      <span className="thought-line__sr" role="status">
        {working ? label : `${doneText} ${spoken(ds)}`}
      </span>
    </>
  );

  return (
    <div
      className={cn(
        "thought-line",
        working && "thought-line--working",
        open && hasTrace && "thought-line--open",
        leaving && "thought-line--leaving",
        className,
      )}
      style={
        {
          "--tl-font": `${fontSize}px`,
          "--tl-color": color ?? "currentColor",
          "--tl-glyph": glyphColor ?? color ?? "currentColor",
          "--tl-settle": `${settleDuration}ms`,
          "--tl-blur": `${settleBlur}px`,
          "--tl-trough": String(1 - breathDepth),
          "--tl-period": `${breathPeriod}s`,
        } as React.CSSProperties
      }
    >
      {collapsible ? (
        <button
          type="button"
          className="thought-line__head"
          data-toggle={toggle ? "" : undefined}
          aria-expanded={toggle ? open : undefined}
          tabIndex={toggle ? 0 : -1}
          onClick={() => {
            if (toggle) setOpen((value) => !value);
          }}
        >
          {head}
        </button>
      ) : (
        <div className="thought-line__head">{head}</div>
      )}
      {hasTrace ? (
        <div className="thought-line__steps" aria-hidden={!open}>
          {steps.map((text, i) => {
            const done = !working || i < steps.length - 1;
            return (
              <div
                key={`${i}-${text}`}
                className="thought-line__step"
                data-done={done ? "" : undefined}
              >
                <span className="thought-line__mark" aria-hidden="true">
                  {done ? (
                    <svg viewBox="0 0 24 24" width="100%" height="100%">
                      <path
                        d="M5 13l4 4L19 7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <i className="thought-line__pulse" />
                  )}
                </span>
                <span className="thought-line__step-text">{text}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
