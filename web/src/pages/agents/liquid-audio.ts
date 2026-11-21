// 液体流动的音效：全部用 Web Audio 现场合成，不加载音频文件。
// 三个声音：从卡面抽出（pull）、持续流动（flow）、落进去溅开（splash）。
// 想关掉：localStorage.setItem('liquid-flow-sound', 'off')

type Flow = {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
};

const STORAGE_KEY = 'liquid-flow-sound';

class LiquidAudio {
  private ctx: AudioContext | null = null;

  private master: GainNode | null = null;

  private noise: AudioBuffer | null = null;

  private stream: Flow | null = null;

  private level = 0;

  private muted = false;

  constructor() {
    try {
      this.muted = window.localStorage.getItem(STORAGE_KEY) === 'off';
    } catch {
      this.muted = false;
    }
  }

  /** 浏览器要求音频先由一次用户操作唤醒；没有声卡/被策略拦下时静默降级 */
  unlock() {
    if (this.muted) return;
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        const ctx = new Ctor();
        const master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
        this.noise = this.createNoise(ctx);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      // 音效是锦上添花，出问题就当没有
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    try {
      window.localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on');
    } catch {
      // 存不了就只影响这次
    }
    if (muted) {
      this.flow(0);
      this.suspend();
    }
  }

  /** 从卡片液面抽出液体：低频“啵”一下，带一点被吸进去的气流声 */
  pull(strength = 1) {
    try {
      this.playPull(strength);
    } catch {
      // 音效不该影响液体动画
    }
  }

  private playPull(strength: number) {
    this.unlock();
    const ctx = this.ctx;
    const master = this.master;
    const noise = this.noise;
    if (!ctx || !master || !noise || this.muted) return;
    const now = ctx.currentTime;
    const gain = clamp01(strength) * 0.5;

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3.5;
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(420, now + 0.2);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.16 * gain, now + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    src.connect(filter).connect(env).connect(master);
    src.start(now);
    src.stop(now + 0.3);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(220, now);
    thump.frequency.exponentialRampToValueAtTime(78, now + 0.22);
    const thumpEnv = ctx.createGain();
    thumpEnv.gain.setValueAtTime(0.0001, now);
    thumpEnv.gain.exponentialRampToValueAtTime(0.11 * gain, now + 0.015);
    thumpEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    thump.connect(thumpEnv).connect(master);
    thump.start(now);
    thump.stop(now + 0.32);
  }

  /** 落进卡片：一声短促的溅落 */
  splash(strength = 1) {
    try {
      this.playSplash(strength);
    } catch {
      // 同上
    }
  }

  private playSplash(strength: number) {
    this.unlock();
    const ctx = this.ctx;
    const master = this.master;
    const noise = this.noise;
    if (!ctx || !master || !noise || this.muted) return;
    const now = ctx.currentTime;
    const gain = clamp01(strength);

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(2600, now);
    filter.frequency.exponentialRampToValueAtTime(900, now + 0.16);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.14 * gain, now + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    src.connect(filter).connect(env).connect(master);
    src.start(now);
    src.stop(now + 0.22);

    const plop = ctx.createOscillator();
    plop.type = 'sine';
    plop.frequency.setValueAtTime(540, now);
    plop.frequency.exponentialRampToValueAtTime(150, now + 0.18);
    const plopEnv = ctx.createGain();
    plopEnv.gain.setValueAtTime(0.0001, now);
    plopEnv.gain.exponentialRampToValueAtTime(0.1 * gain, now + 0.01);
    plopEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    plop.connect(plopEnv).connect(master);
    plop.start(now);
    plop.stop(now + 0.24);
  }

  /** 拖动时持续的水流声：音量与音色都跟着滑动速度走 */
  flow(level: number) {
    try {
      this.playFlow(level);
    } catch {
      // 同上
    }
  }

  private playFlow(level: number) {
    const target = this.muted ? 0 : clamp01(level);
    if (Math.abs(target - this.level) < 0.004) return;
    this.level = target;
    const ctx = this.ctx;
    const master = this.master;
    const noise = this.noise;
    if (!ctx || !master || !noise) return;
    if (target <= 0.005) {
      this.stopFlow();
      return;
    }
    if (!this.stream) {
      const source = ctx.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.1;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      source.connect(filter).connect(gain).connect(master);
      source.start();
      this.stream = { source, filter, gain };
    }
    const now = ctx.currentTime;
    this.stream.gain.gain.setTargetAtTime(0.045 * target, now, 0.08);
    this.stream.filter.frequency.setTargetAtTime(620 + 900 * target, now, 0.12);
  }

  private stopFlow() {
    const ctx = this.ctx;
    const stream = this.stream;
    if (!ctx || !stream) return;
    const now = ctx.currentTime;
    stream.gain.gain.setTargetAtTime(0.0001, now, 0.05);
    stream.source.stop(now + 0.3);
    this.stream = null;
  }

  suspend() {
    this.level = 0;
    this.stopFlow();
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  private createNoise(ctx: AudioContext) {
    const frames = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // 用一点低通的白噪声，听起来是水而不是“沙沙”的电流声
    let previous = 0;
    for (let i = 0; i < frames; i += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.55 + white * 0.45;
      data[i] = previous;
    }
    return buffer;
  }
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const liquidAudio = new LiquidAudio();
