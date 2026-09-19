/* WARS — procedural SFX via WebAudio. Zero asset files = zero portability risk.
   Context is created lazily on the first user gesture (browser autoplay rules). */
(function (W) {
  'use strict';

  class Audio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this.enabled = true;
      this._failed = false;
      this._last = {};      // per-sound rate limiter
      this._musicTimer = 0;
    }

    /** Safe to call repeatedly; call from a real user gesture. */
    unlock() {
      if (this.ctx || this._failed) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this._failed = true; return; }
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
      } catch (e) { this._failed = true; this.ctx = null; }
    }

    setMuted(m) {
      this.muted = !!m;
      if (this.master) this.master.gain.value = m ? 0 : 0.5;
    }

    _ok(name, minGap) {
      if (!this.enabled || this.muted || !this.ctx) return false;
      const t = this.ctx.currentTime;
      if (minGap && this._last[name] && t - this._last[name] < minGap) return false;
      this._last[name] = t;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }

    /** One noise/tone blip. */
    _blip(o) {
      const ctx = this.ctx;
      const t0 = ctx.currentTime + (o.delay || 0);
      const g = ctx.createGain();
      g.connect(this.master);
      const peak = Math.max(0.0001, o.gain);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.01, o.dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

      let src;
      if (o.noise) {
        const len = Math.max(1, Math.floor(ctx.sampleRate * o.dur));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        src = ctx.createBufferSource();
        src.buffer = buf;
        const f = ctx.createBiquadFilter();
        f.type = o.filter || 'bandpass';
        f.frequency.value = o.freq;
        f.Q.value = o.q || 1;
        src.connect(f); f.connect(g);
      } else {
        src = ctx.createOscillator();
        src.type = o.type || 'square';
        src.frequency.setValueAtTime(o.freq, t0);
        if (o.freq2) src.frequency.exponentialRampToValueAtTime(Math.max(20, o.freq2), t0 + o.dur);
        src.connect(g);
      }
      src.start(t0);
      src.stop(t0 + o.dur + 0.02);
    }

    play(name, opts) {
      if (this._failed || !this.ctx || !this.enabled || this.muted) return;
      const v = (opts && opts.vol) || 1;
      switch (name) {
        case 'shootPistol': if (this._ok(name, 0.03)) this._blip({ type: 'square', freq: 720, freq2: 240, dur: 0.07, gain: 0.12 * v }); break;
        case 'shootSmg':    if (this._ok(name, 0.02)) this._blip({ type: 'square', freq: 900, freq2: 380, dur: 0.05, gain: 0.08 * v }); break;
        case 'shootShotgun':if (this._ok(name, 0.05)) this._blip({ noise: true, freq: 900, q: 0.7, dur: 0.16, gain: 0.2 * v }); break;
        case 'shootLaser':  if (this._ok(name, 0.03)) this._blip({ type: 'sawtooth', freq: 1500, freq2: 500, dur: 0.09, gain: 0.1 * v }); break;
        case 'shootRocket': if (this._ok(name, 0.08)) this._blip({ noise: true, freq: 420, dur: 0.22, gain: 0.2 * v }); break;
        case 'hit':         if (this._ok(name, 0.02)) this._blip({ noise: true, freq: 2600, q: 2, dur: 0.05, gain: 0.07 * v }); break;
        case 'kill':        if (this._ok(name, 0.04)) this._blip({ type: 'triangle', freq: 320, freq2: 70, dur: 0.2, gain: 0.16 * v }); break;
        case 'tree':        if (this._ok(name, 0.03)) this._blip({ noise: true, freq: 520, q: 1.4, dur: 0.09, gain: 0.09 * v }); break;
        case 'fruit':       if (this._ok(name, 0.02)) this._blip({ type: 'sine', freq: 880, freq2: 1500, dur: 0.11, gain: 0.16 * v }); break;
        case 'pickup':      if (this._ok(name, 0.05)) { this._blip({ type: 'square', freq: 640, dur: 0.08, gain: 0.14 * v }); this._blip({ type: 'square', freq: 960, dur: 0.1, gain: 0.13 * v, delay: 0.07 }); } break;
        case 'hurt':        if (this._ok(name, 0.05)) this._blip({ type: 'sawtooth', freq: 220, freq2: 90, dur: 0.18, gain: 0.2 * v }); break;
        case 'explode':     if (this._ok(name, 0.05)) this._blip({ noise: true, freq: 180, filter: 'lowpass', dur: 0.45, gain: 0.3 * v }); break;
        case 'levelup':     { this._blip({ type: 'triangle', freq: 520, dur: 0.12, gain: 0.16 * v }); this._blip({ type: 'triangle', freq: 780, dur: 0.12, gain: 0.16 * v, delay: 0.1 }); this._blip({ type: 'triangle', freq: 1040, dur: 0.18, gain: 0.16 * v, delay: 0.2 }); } break;
        case 'win':         { this._blip({ type: 'square', freq: 523, dur: 0.16, gain: 0.18 }); this._blip({ type: 'square', freq: 659, dur: 0.16, gain: 0.18, delay: 0.16 }); this._blip({ type: 'square', freq: 1046, dur: 0.4, gain: 0.2, delay: 0.32 }); } break;
        case 'lose':        { this._blip({ type: 'sawtooth', freq: 300, freq2: 70, dur: 0.7, gain: 0.22 }); } break;
        default: break;
      }
    }
  }

  W.Audio = Audio;
})(window.WARS || (window.WARS = {}));