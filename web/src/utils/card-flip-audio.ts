// 翻牌的拟音：全部用 Web Audio 现场合成，不加载音频文件。
// 一整串"疯疯疯"：纸牌被拇指连续拨开时的密接翻页声——6 段几乎相连的
// 气流"唰"（带通噪声，逐段压低、逐渐变短）叠着 6 下指腹拨牌的脆响（三角波 tick），
// 收尾一声很轻的落桌"嗒"。
// 与液体音效共用同一个静音开关：localStorage.setItem('liquid-flow-sound', 'off')

const STORAGE_KEY = 'liquid-flow-sound';

class CardFlipAudio {
  private ctx: AudioContext | null = null;

  private master: GainNode | null = null;

  private noise: AudioBuffer | null = null;

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
  }

  /**
   * 一记翻牌拟音。
   * @param strength 音量倍数。
   * @param spanMs 这次翻牌在画面上占的时长：开场翻牌要把整张牌翻过来，串音就
   *   拉开到同样长，否则声音早在画面前头跑完了。不传则用默认的一串 6 下。
   */
  flip(strength = 1, spanMs?: number) {
    try {
      this.playFlip(strength, spanMs);
    } catch {
      // 音效不该影响翻牌动画
    }
  }

  private playFlip(strength: number, spanMs?: number) {
    this.unlock();
    const ctx = this.ctx;
    const master = this.master;
    const noise = this.noise;
    if (!ctx || !master || !noise || this.muted) return;
    const now = ctx.currentTime;
    const gain = Math.min(1, Math.max(0, strength));

    // 一串牌被连续拨开：多段几乎首尾相接的"唰"，每段都比上一段略低、略短，
    // 间隔几十毫秒（比单张翻牌快得多），叠起来就是"疯疯疯"的连续感。
    // 牌翻得越久，拨的次数就越多，让这串声音正好铺满那次翻牌。
    const RIFLE = 6;
    const STEP = 0.066;
    const span = spanMs && spanMs > 0 ? Math.min(1.8, Math.max(0.18, spanMs / 1000)) : 0;
    const rifle = span ? Math.min(14, Math.max(RIFLE, Math.round(span / 0.072))) : RIFLE;
    const step = span ? span / rifle : STEP;
    // 拉长以后每下要轻一点，否则一串下来比原来响得多
    const density = Math.sqrt(RIFLE / rifle);
    for (let i = 0; i < rifle; i += 1) {
      const share = rifle > 1 ? i / (rifle - 1) : 0;
      const start = now + i * step;
      const strengthHere = gain * density * (1 - share * 0.34);

      const air = ctx.createBufferSource();
      air.buffer = noise;
      air.loop = true;
      const lift = ctx.createBiquadFilter();
      lift.type = 'highpass';
      lift.frequency.value = 900 + i * 90;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 1.35;
      const centre = 3100 - i * 170;
      band.frequency.setValueAtTime(centre, start);
      band.frequency.exponentialRampToValueAtTime(centre * 0.52, start + 0.058);
      const airGain = ctx.createGain();
      airGain.gain.setValueAtTime(0.0001, start);
      airGain.gain.exponentialRampToValueAtTime(0.055 * strengthHere, start + 0.004);
      airGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.072);
      air.connect(lift).connect(band).connect(airGain).connect(master);
      air.start(start);
      air.stop(start + 0.08);

      // 指腹拨过牌角的一下脆响，给"疯"一个硬起头
      const tick = ctx.createOscillator();
      tick.type = 'triangle';
      const pitch = 1180 + i * 65;
      tick.frequency.setValueAtTime(pitch, start);
      tick.frequency.exponentialRampToValueAtTime(pitch * 0.72, start + 0.024);
      const tickGain = ctx.createGain();
      tickGain.gain.setValueAtTime(0.0001, start);
      tickGain.gain.exponentialRampToValueAtTime(0.018 * strengthHere, start + 0.002);
      tickGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.03);
      tick.connect(tickGain).connect(master);
      tick.start(start);
      tick.stop(start + 0.036);
    }

    // 收尾：最后一张落在桌面上，很轻的一声"嗒"
    const landing = now + rifle * step + 0.012;
    [660, 990].forEach((frequency, index) => {
      const start = landing + index * 0.006;
      const tick = ctx.createOscillator();
      tick.type = 'triangle';
      tick.frequency.setValueAtTime(frequency, start);
      tick.frequency.exponentialRampToValueAtTime(frequency * 0.86, start + 0.05);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(
        (0.03 - index * 0.009) * gain,
        start + 0.004,
      );
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.08);
      tick.connect(env).connect(master);
      tick.start(start);
      tick.stop(start + 0.1);
    });
  }

  private createNoise(ctx: AudioContext) {
    const frames = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < frames; i += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.3 + white * 0.7;
      data[i] = previous;
    }
    return buffer;
  }
}

export const cardFlipAudio = new CardFlipAudio();
