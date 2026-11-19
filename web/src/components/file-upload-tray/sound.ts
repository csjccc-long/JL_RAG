/* The drop box makes four small noises and nothing else: the file being pulled
 * in, the box swallowing it, the tick when it lands, and a flat refusal when it
 * does not fit. They are synthesised here rather than shipped as audio files —
 * a handful of oscillators is smaller than one mp3 and there is nothing to
 * cache-bust. Every entry point is wrapped: a browser that refuses to start an
 * AudioContext must cost the effect, never the upload. */

type SoundName = 'suck' | 'gulp' | 'tick' | 'refuse' | 'drop';

const STORAGE_KEY = 'ragflow.uploadSound';

let context: AudioContext | null = null;
let muted: boolean | null = null;
let noise: AudioBuffer | null = null;

const audioClass = (): typeof AudioContext | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
};

const readMuted = (): boolean => {
  if (muted !== null) return muted;
  try {
    muted = window.localStorage.getItem(STORAGE_KEY) === 'off';
  } catch {
    muted = false;
  }
  return muted;
};

export const isSoundMuted = (): boolean => readMuted();

export const setSoundMuted = (value: boolean): void => {
  muted = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? 'off' : 'on');
  } catch {
    // A blocked storage only costs the preference, never the sound.
  }
};

const engine = (): AudioContext | null => {
  if (readMuted()) return null;
  const Ctor = audioClass();
  if (!Ctor) return null;
  try {
    if (!context) context = new Ctor();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
};

const tone = (
  ctx: AudioContext,
  options: {
    type: OscillatorType;
    from: number;
    to?: number;
    duration: number;
    gain: number;
    delay?: number;
  },
): void => {
  const start = ctx.currentTime + (options.delay ?? 0);
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = options.type;
  osc.frequency.setValueAtTime(options.from, start);
  if (options.to && options.to !== options.from) {
    osc.frequency.exponentialRampToValueAtTime(options.to, start + options.duration);
  }
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(options.gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + options.duration + 0.02);
};

const noiseBuffer = (ctx: AudioContext): AudioBuffer => {
  if (noise) return noise;
  const length = Math.floor(ctx.sampleRate * 0.4);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  noise = buffer;
  return noise;
};

const whoosh = (ctx: AudioContext): void => {
  const start = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.1;
  band.frequency.setValueAtTime(1400, start);
  band.frequency.exponentialRampToValueAtTime(260, start + 0.28);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(0.06, start + 0.04);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
  source.connect(band).connect(amp).connect(ctx.destination);
  source.start(start);
  source.stop(start + 0.32);
};

export const playSound = (name: SoundName): void => {
  const ctx = engine();
  if (!ctx) return;
  try {
    switch (name) {
      case 'suck':
        whoosh(ctx);
        break;
      case 'gulp':
        tone(ctx, { type: 'sine', from: 190, to: 82, duration: 0.18, gain: 0.09 });
        break;
      case 'tick':
        tone(ctx, { type: 'sine', from: 1320, duration: 0.08, gain: 0.045 });
        tone(ctx, {
          type: 'sine',
          from: 1760,
          duration: 0.1,
          gain: 0.04,
          delay: 0.06,
        });
        break;
      case 'refuse':
        tone(ctx, { type: 'square', from: 150, to: 118, duration: 0.15, gain: 0.035 });
        break;
      case 'drop':
        tone(ctx, { type: 'triangle', from: 620, to: 420, duration: 0.07, gain: 0.04 });
        break;
    }
  } catch {
    // A missing node type or a closed context is not worth reporting.
  }
};
