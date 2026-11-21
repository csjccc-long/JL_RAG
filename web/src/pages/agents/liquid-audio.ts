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
        master.gain.value = 0.42;
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

  /** 从卡片液面抽出液体：一声清亮的水珠“嗒”加一线高频气流 */
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
    const gain = clamp01(strength);

    // 水珠：两个八度以上的短滑音，尾巴只有 90ms，听起来是“嗒”而不是“咕”
    [1720, 2680].forEach((frequency, index) => {
      const start = now + index * 0.035;
      const ping = ctx.createOscillator();
      ping.type = 'triangle';
      ping.frequency.setValueAtTime(frequency, start);
      ping.frequency.exponentialRampToValueAtTime(frequency * 1.35, start + 0.05);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(0.085 * gain, start + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
      ping.connect(env).connect(master);
      ping.start(start);
      ping.stop(start + 0.12);
    });

    // 气流：只留 1.4kHz 以上，衰减极快，避免浑厚的“噗”
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 1400;
    high.Q.value = 0.7;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 3200;
    band.Q.value = 1.2;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.075 * gain, now + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    src.connect(high).connect(band).connect(env).connect(master);
    src.start(now);
    src.stop(now + 0.15);
  }

  /** 落进卡片：几颗水珠依次溅开，短、亮、干脆 */
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

    const drops = [2860, 2380, 3420];
    drops.forEach((frequency, index) => {
      const start = now + index * 0.026;
      const drop = ctx.createOscillator();
      drop.type = 'triangle';
      drop.frequency.setValueAtTime(frequency, start);
      drop.frequency.exponentialRampToValueAtTime(frequency * 1.18, start + 0.035);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime((0.07 - index * 0.012) * gain, start + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.085);
      drop.connect(env).connect(master);
      drop.start(start);
      drop.stop(start + 0.1);
    });

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 3200;
    high.Q.value = 0.7;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.055 * gain, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    src.connect(high).connect(env).connect(master);
    src.start(now);
    src.stop(now + 0.14);
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
      filter.Q.value = 1.6;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      source.connect(filter).connect(gain).connect(master);
      source.start();
      this.stream = { source, filter, gain };
    }
    const now = ctx.currentTime;
    this.stream.gain.gain.setTargetAtTime(0.028 * target, now, 0.08);
    this.stream.filter.frequency.setTargetAtTime(1650 + 1900 * target, now, 0.12);
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
    // 保留更多高频，声音才清脆；只做很轻的平滑去掉生硬的电流感
    let previous = 0;
    for (let i = 0; i < frames; i += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.28 + white * 0.72;
      data[i] = previous;
    }
    return buffer;
  }
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const liquidAudio = new LiquidAudio();
