/*
 * The dashboard has three sounds and no audio files: a knock when the token
 * window folds, a tick when a band is picked up, and a tick per reading as a
 * line is read back. All three are synthesised, so they cost nothing to load
 * and cannot arrive late.
 *
 * ELASTICITY IS FEEDBACK, NEVER LATENCY — the same rule the motion follows.
 * Every sound here reports something that has already happened: the fold is
 * decided, the band is chosen, the pointer is over that reading.
 */

let context: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

const audioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!Ctor) return null;

  context = context ?? new Ctor();
  /* a hover can arrive before the page has had a gesture, and a refused
     resume is not a failure worth surfacing */
  if (context.state === 'suspended') context.resume().catch(() => undefined);

  return context;
};

/* a few milliseconds of noise, for the click of the press */
const noise = (audio: AudioContext) => {
  if (noiseBuffer) return noiseBuffer;

  const length = Math.floor(audio.sampleRate * 0.05);
  noiseBuffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;

  return noiseBuffer;
};

/** A soft body drop with a click on top: the window settling. */
export const playContextKnock = () => {
  const audio = audioContext();
  if (!audio) return;

  const now = audio.currentTime;

  const body = audio.createOscillator();
  const bodyGain = audio.createGain();
  body.type = 'sine';
  body.frequency.setValueAtTime(210, now);
  body.frequency.exponentialRampToValueAtTime(78, now + 0.18);
  bodyGain.gain.setValueAtTime(0.0001, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.13, now + 0.012);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  body.connect(bodyGain);
  bodyGain.connect(audio.destination);
  body.start(now);
  body.stop(now + 0.26);

  const click = audio.createBufferSource();
  const clickFilter = audio.createBiquadFilter();
  const clickGain = audio.createGain();
  click.buffer = noise(audio);
  clickFilter.type = 'highpass';
  clickFilter.frequency.value = 1400;
  clickGain.gain.setValueAtTime(0.06, now);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
  click.connect(clickFilter);
  clickFilter.connect(clickGain);
  clickGain.connect(audio.destination);
  click.start(now);
  click.stop(now + 0.04);
};

/** The smallest sound that still reads as a touch: a band picked up. */
export const playContextTick = () => {
  const audio = audioContext();
  if (!audio) return;

  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1400, now);
  osc.frequency.exponentialRampToValueAtTime(900, now + 0.03);
  gain.gain.setValueAtTime(0.02, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.05);
};

/* ── the line, heard ──────────────────────────────────────
   One tick per READING, and that is the one thing here that rounds. The
   position and the figure are continuous; the note is not, because a sound
   that fired on every pointer move is a hiss rather than a scrub. Counting off
   the readings you cross is what running along a chart should sound like.

   The pitch rides the VALUE — a fifth either way around the base — so a climb
   sounds like a climb. The rate limit is the second guard, for a flick fast
   enough to cross several readings at once. */
const ScrubBase = 1040;
const ScrubGap = 28;
let lastScrub = 0;

/** One note, nought to one across the reading it belongs to. */
export const playScrubTick = (at: number) => {
  const audio = audioContext();
  if (!audio) return;

  const clock = typeof performance === 'undefined' ? 0 : performance.now();
  if (clock - lastScrub < ScrubGap) return;
  lastScrub = clock;

  const now = audio.currentTime;
  const ratio = Number.isFinite(at) ? Math.min(1, Math.max(0, at)) : 0.5;
  const pitch = ScrubBase * Math.pow(1.5, (ratio - 0.5) * 2);

  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(pitch, now);
  osc.frequency.exponentialRampToValueAtTime(pitch * 0.94, now + 0.04);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.026, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.07);
};
