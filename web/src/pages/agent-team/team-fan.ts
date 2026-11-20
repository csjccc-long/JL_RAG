/**
 * The sound the team cards make. Synthesised rather than downloaded: three
 * short blips, one per thing that happens, so the page carries no audio assets
 * and nothing plays until the pointer is actually on a card.
 *
 * Every call is wrapped: a browser that refuses to start an AudioContext (no
 * gesture yet, autoplay policy, a headless run) must not break the page, and a
 * page that is trying not to surprise anyone must not make a noise.
 */

type FanSound = 'open' | 'tick' | 'close';

const MUTE_KEY = 'ragflow.teamFanSound';

let context: AudioContext | null = null;

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const isFanSoundMuted = (): boolean => {
  try {
    return window.localStorage.getItem(MUTE_KEY) === 'off';
  } catch {
    return false;
  }
};

export const setFanSoundMuted = (muted: boolean): void => {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? 'off' : 'on');
  } catch {
    // A browser with storage turned off is not a reason to stop the page.
  }
};

const audio = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  if (context.state === 'suspended') {
    context.resume().catch(() => undefined);
  }
  return context;
};

/** One short blip: a sine that slides from `from` to `to` and dies away. */
const blip = (
  from: number,
  to: number,
  duration: number,
  gain: number,
): void => {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), now + duration);
  amp.gain.setValueAtTime(0, now);
  amp.gain.linearRampToValueAtTime(gain, now + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
};

/**
 * `step` is which button in the fan this is, so the cascade rises as it opens
 * instead of playing the same note four times.
 */
export const playFanSound = (kind: FanSound, step = 0): void => {
  if (reducedMotion() || isFanSoundMuted()) return;
  try {
    if (kind === 'open') blip(420, 620, 0.16, 0.05);
    else if (kind === 'close') blip(340, 210, 0.18, 0.04);
    else blip(640 + step * 90, 900 + step * 110, 0.09, 0.035);
  } catch {
    // Audio is a garnish; a failure here is never worth surfacing.
  }
};
