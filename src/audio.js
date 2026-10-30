import { config, getMuted, setMuted } from './config.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.engine = null;
    this.wind = null;
    this.muted = getMuted();
    this.warningTimer = 0;
    this.engineActive = false;
    this.blocked = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      this.ctx = null;
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(this.ctx.destination);

    this.noiseBuffer = this.makeNoiseBuffer(2);

    // 引擎：两个振荡器 + 低通
    const o1 = this.ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = 52;
    const o2 = this.ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = 78;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 2.5;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    o1.connect(filter);
    o2.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    o1.start();
    o2.start();
    this.engine = { o1, o2, filter, gain };

    // 风噪
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.7;
    const ng = this.ctx.createGain();
    ng.gain.value = 0;
    noise.connect(bp);
    bp.connect(ng);
    ng.connect(this.master);
    noise.start();
    this.wind = { noise, bp, gain: ng };
  }

  makeNoiseBuffer(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buffer = this.ctx.createBuffer(1, len, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  toggleMute() {
    this.muted = !this.muted;
    setMuted(this.muted);
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : 0.55,
        t,
        0.03
      );
    }
  }

  update(game, dt, uiBlocked) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.blocked = uiBlocked || game.paused;
    const active =
      game.mode === 'playing' &&
      !this.blocked &&
      (game.state === 'driving' ||
        game.state === 'roof' ||
        game.state === 'hijack');
    this.engineActive = active;

    const speed =
      game.playerCar && game.playerCar.speedEffective != null
        ? game.playerCar.speedEffective
        : game.lastPlayerSpeed || 0;
    const ratio = Math.min(1.4, Math.max(0, speed / 6));

    if (this.engine) {
      const e = this.engine;
      const inBullet = !active ? 0 : game.state === 'roof' ? 1 : 0;
      const targetGain = active ? 0.028 + ratio * 0.018 : 0;
      const targetFreq = 42 + ratio * 48;
      const targetFilt = active ? (inBullet ? 240 : 460 + ratio * 620) : 260;
      e.gain.gain.setTargetAtTime(targetGain, t, 0.12);
      e.filter.frequency.setTargetAtTime(targetFilt, t, 0.1);
      e.o1.frequency.setTargetAtTime(targetFreq, t, 0.12);
      e.o2.frequency.setTargetAtTime(targetFreq * 1.5, t, 0.12);
    }
    if (this.wind) {
      const w = this.wind;
      w.gain.gain.setTargetAtTime(active ? 0.006 + ratio * 0.014 : 0, t, 0.15);
      w.bp.frequency.setTargetAtTime(480 + ratio * 1000, t, 0.15);
    }

    // 低耐久警告
    if (active && game.playerCar) {
      const car = game.playerCar;
      if (car.durability <= config.durabilityWarnTime) {
        this.warningTimer -= dt;
        if (this.warningTimer <= 0) {
          this.warningTimer = 0.55;
          this.beep();
        }
      } else {
        this.warningTimer = 0;
      }
    }
  }

  // ---------------------------------------------------------------- 基础音色

  tone(opts = {}) {
    if (!this.ctx) return;
    const {
      freq = 440,
      endFreq = null,
      type = 'sine',
      dur = 0.2,
      gain = 0.15,
      delay = 0,
      attack = 0.006,
    } = opts;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (endFreq != null) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, endFreq),
        t0 + dur
      );
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  noise(opts = {}) {
    if (!this.ctx || !this.noiseBuffer) return;
    const {
      dur = 0.2,
      gain = 0.12,
      freq = 900,
      endFreq = null,
      q = 1,
      type = 'bandpass',
      delay = 0,
      attack = 0.005,
    } = opts;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (endFreq != null) {
      f.frequency.exponentialRampToValueAtTime(
        Math.max(20, endFreq),
        t0 + dur
      );
    }
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  beep() {
    this.tone({ freq: 880, dur: 0.07, gain: 0.06, type: 'square' });
  }

  // ---------------------------------------------------------------- 游戏音效

  startRun() {
    if (!this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.tone({
        freq: f,
        dur: 0.16,
        gain: 0.1,
        delay: i * 0.07,
        type: 'triangle',
      });
    });
    this.noise({ dur: 0.35, gain: 0.06, freq: 400, endFreq: 1600, q: 1.4 });
  }

  bulletTimeEnter() {
    this.tone({
      freq: 620,
      endFreq: 90,
      dur: 0.42,
      gain: 0.13,
      type: 'sine',
    });
    this.noise({
      dur: 0.4,
      gain: 0.05,
      freq: 1600,
      endFreq: 180,
      q: 1.2,
    });
    this.tone({ freq: 80, endFreq: 48, dur: 0.3, gain: 0.12, type: 'sine' });
  }

  bulletTimeExit() {
    this.tone({
      freq: 160,
      endFreq: 440,
      dur: 0.18,
      gain: 0.08,
      type: 'triangle',
    });
  }

  bulletTimeEnd() {
    this.tone({ freq: 660, dur: 0.08, gain: 0.08, type: 'square' });
    this.tone({
      freq: 520,
      dur: 0.1,
      gain: 0.08,
      delay: 0.1,
      type: 'square',
    });
  }

  dive() {
    this.noise({
      dur: 0.3,
      gain: 0.12,
      freq: 300,
      endFreq: 2000,
      q: 2,
    });
    this.tone({
      freq: 700,
      endFreq: 220,
      dur: 0.22,
      gain: 0.07,
      type: 'triangle',
    });
  }

  hijack(combo = 1) {
    this.tone({ freq: 95, endFreq: 48, dur: 0.18, gain: 0.18, type: 'sine' });
    this.noise({ dur: 0.14, gain: 0.1, freq: 1200, endFreq: 300, q: 1.2 });
    const base = 523.25 * (1 + Math.min(8, combo - 1) * 0.045);
    const notes = [base, base * 1.25, base * 1.5, base * 2];
    notes.forEach((f, i) => {
      this.tone({
        freq: f,
        dur: 0.16,
        gain: 0.11,
        delay: 0.04 + i * 0.055,
        type: 'triangle',
      });
    });
    this.noise({
      dur: 0.3,
      gain: 0.04,
      freq: 4000,
      q: 4,
      delay: 0.02,
    });
  }

  bump() {
    this.tone({ freq: 90, endFreq: 45, dur: 0.14, gain: 0.16, type: 'sine' });
    this.noise({ dur: 0.18, gain: 0.1, freq: 700, endFreq: 260, q: 0.9 });
  }

  wrongWay() {
    this.tone({ freq: 659, dur: 0.09, gain: 0.08, type: 'square' });
    this.tone({
      freq: 880,
      dur: 0.1,
      gain: 0.08,
      delay: 0.1,
      type: 'square',
    });
  }

  laneShrink() {
    // 道路收窄：低频震动 + 两声提示
    this.noise({ dur: 0.9, gain: 0.07, freq: 360, endFreq: 80, q: 0.7 });
    this.tone({
      freq: 220,
      endFreq: 110,
      dur: 0.55,
      gain: 0.06,
      type: 'triangle',
    });
    this.tone({ freq: 523.25, dur: 0.1, gain: 0.07, delay: 0.18, type: 'square' });
    this.tone({ freq: 659.25, dur: 0.12, gain: 0.07, delay: 0.3, type: 'square' });
  }

  crash(reason) {
    if (reason === 'explosion') {
      this.explosion();
      return;
    }
    if (reason === 'dive_miss') {
      this.tone({
        freq: 620,
        endFreq: 90,
        dur: 0.55,
        gain: 0.16,
        type: 'triangle',
      });
      this.noise({
        dur: 0.3,
        gain: 0.14,
        freq: 900,
        endFreq: 180,
        q: 1,
      });
      this.tone({
        freq: 120,
        endFreq: 50,
        dur: 0.25,
        gain: 0.14,
        delay: 0.06,
        type: 'sine',
      });
      return;
    }
    this.noise({ dur: 0.45, gain: 0.22, freq: 1800, endFreq: 180, q: 0.8 });
    this.tone({
      freq: 180,
      endFreq: 42,
      dur: 0.5,
      gain: 0.18,
      type: 'sawtooth',
    });
    this.tone({ freq: 70, endFreq: 30, dur: 0.4, gain: 0.16, type: 'sine' });
  }

  explosion() {
    this.noise({ dur: 0.8, gain: 0.28, freq: 600, endFreq: 60, q: 0.6 });
    this.tone({
      freq: 70,
      endFreq: 22,
      dur: 0.7,
      gain: 0.22,
      type: 'sine',
    });
    this.noise({
      dur: 1.1,
      gain: 0.08,
      freq: 220,
      endFreq: 40,
      q: 0.6,
      delay: 0.08,
    });
  }

  gameOver() {
    const notes = [392, 329.63, 261.63];
    notes.forEach((f, i) => {
      this.tone({
        freq: f,
        dur: 0.3,
        gain: 0.1,
        delay: i * 0.16,
        type: 'triangle',
      });
    });
    this.tone({
      freq: 130.81,
      endFreq: 65.41,
      dur: 0.8,
      gain: 0.09,
      delay: 0.2,
      type: 'sine',
    });
  }
}
