/* WARS — procedural audio: a panned SFX bus, a generative music engine and a
   wind bed. Zero asset files — everything is synthesized with WebAudio at
   runtime, so the game stays a single portable file tree. */
(function (W) {
  'use strict';
  const U = W.Util;
  const A = W.Config.AUDIO;

  class Audio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.sfxBus = null;
      this.musicBus = null;
      this.muted = false;
      this.enabled = true;
      this._failed = false;
      this._last = {};          // per-sound rate limiter
      this._intensity = 0;      // music intensity 0..3
      this._schedTimer = null;
      this._step = 0;
      this._nextT = 0;
      this._delay = null;
      this._wind = null;
    }

    /** Safe to call repeatedly; call from a real user gesture (autoplay rules). */
    unlock() {
      if (this.ctx || this._failed) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this._failed = true; return; }
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : A.master;
        this.master.connect(this.ctx.destination);
        this.sfxBus = this.ctx.createGain();
        this.sfxBus.gain.value = A.sfx;
        this.sfxBus.connect(this.master);
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = A.music;
        this.musicBus.connect(this.master);
        // echo send: music notes are also routed through a feedback delay
        if (this.ctx.createDelay) {
          this._delay = this.ctx.createDelay(0.8);
          this._delay.delayTime.value = 0.29;
          const fb = this.ctx.createGain(); fb.gain.value = 0.28;
          const wet = this.ctx.createGain(); wet.gain.value = 0.2;
          this._delay.connect(fb); fb.connect(this._delay);
          this._delay.connect(wet); wet.connect(this.musicBus);
        }
        this._startWind();
        this.ensureMusic();
      } catch (e) { this._failed = true; this.ctx = null; }
    }

    setMuted(m) {
      this.muted = !!m;
      if (this.master) this.master.gain.value = m ? 0 : A.master;
    }

    /* ------------------------------------------------------ routing ----- */
    /** Panner (when the browser has one) feeding the SFX bus. */
    _pan(pan) {
      if (this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = U.clamp(pan, -1, 1);
        p.connect(this.sfxBus);
        return p;
      }
      return this.sfxBus;
    }

    /** A fresh gain node with a percussive envelope; sources connect into it. */
    _layer(p, t0, dur, peak, atk) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t0 + (atk || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      g.connect(p);
      return g;
    }

    /** Distance attenuation: near sounds are full, far ones fade but never vanish. */
    _attenuate(o) {
      if (!o || o.dist == null) return 1;
      return U.clamp(1 - o.dist / A.atten, 0.18, 1);
    }

    _tone(layer, t0, dur, o) {
      const osc = this.ctx.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(Math.max(20, o.f), t0);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + dur);
      let head = osc;
      if (o.lp != null || o.hp != null || o.bp != null) {
        const f = this.ctx.createBiquadFilter();
        f.type = o.lp != null ? 'lowpass' : o.bp != null ? 'bandpass' : 'highpass';
        f.frequency.setValueAtTime(o.lp != null ? o.lp : o.bp != null ? o.bp : o.hp, t0);
        if (o.lpEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.lpEnd), t0 + dur);
        if (o.bpEnd) f.frequency.linearRampToValueAtTime(o.bpEnd, t0 + dur);
        f.Q.value = o.q || 0.8;
        osc.connect(f);
        head = f;
      }
      head.connect(layer);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    /** Pre-rendered noise burst through an (optionally swept) filter. */
    _noise(layer, t0, dur, o) {
      const ctx = this.ctx;
      const len = Math.max(32, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      let head = src;
      if (o.lp != null || o.hp != null || o.bp != null) {
        const f = ctx.createBiquadFilter();
        f.type = o.lp != null ? 'lowpass' : o.bp != null ? 'bandpass' : 'highpass';
        f.frequency.setValueAtTime(o.lp != null ? o.lp : o.bp != null ? o.bp : o.hp, t0);
        if (o.lpEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.lpEnd), t0 + dur);
        if (o.bpEnd) f.frequency.linearRampToValueAtTime(o.bpEnd, t0 + dur);
        f.Q.value = o.q || 0.8;
        src.connect(f);
        head = f;
      }
      head.connect(layer);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    }

    /** Brownish looping noise through a slowly wobbling lowpass: the wind bed. */
    _startWind() {
      if (this._wind || !this.ctx) return;
      const ctx = this.ctx;
      const len = Math.floor(ctx.sampleRate * 2.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let l = 0;
      for (let i = 0; i < len; i++) { l = l * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = l * 3; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240; f.Q.value = 0.5;
      const g = ctx.createGain(); g.gain.value = A.wind;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
      const lfoG = ctx.createGain(); lfoG.gain.value = 120;
      lfo.connect(lfoG); lfoG.connect(f.frequency);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(); lfo.start();
      this._wind = { src, lfo };
    }

    _ok(name, minGap) {
      if (!this.enabled || this.muted || !this.ctx) return false;
      const t = this.ctx.currentTime;
      if (minGap && this._last[name] && t - this._last[name] < minGap) return false;
      this._last[name] = t;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }

    /* ------------------------------------------------------------ SFX ---- */
    /** Play a named effect. `o.vol` scales it, `o.pan` is -1..1 (listener at the
        player), `o.dist` is world-px from the player (attenuation). */
    play(name, o) {
      if (this._failed || !this.ctx || !this.enabled || this.muted) return;
      o = o || {};
      if (o.minGap != null && !this._ok(name, o.minGap)) return;
      const vol = (o.vol || 1) * this._attenuate(o);
      if (vol <= 0.01) return;
      const t0 = this.ctx.currentTime + (o.delay || 0);
      const p = this._pan(o.pan || 0);
      const L = (dur, peak, atk) => this._layer(p, t0, dur, peak * vol, atk);

      switch (name) {
        case 'shootPistol':
          this._noise(L(0.05, 0.55), t0, 0.05, { bp: 2400, bpEnd: 700, q: 0.9 });   // crack
          this._tone(L(0.07, 0.4), t0, 0.07, { type: 'square', f: 640, f2: 170 }); // body
          this._tone(L(0.03, 0.16), t0, 0.03, { type: 'square', f: 1400 });        // click
          break;
        case 'shootSmg':
          this._noise(L(0.035, 0.38), t0, 0.035, { bp: 3000, bpEnd: 1200, q: 0.8 });
          this._tone(L(0.05, 0.3), t0, 0.05, { type: 'square', f: 900, f2: 320 });
          break;
        case 'shootShotgun':
          this._noise(L(0.16, 0.8), t0, 0.16, { lp: 900, lpEnd: 250, q: 0.7 });    // blast
          this._tone(L(0.12, 0.5), t0, 0.12, { type: 'sine', f: 160, f2: 55 });    // thump
          break;
        case 'shootLaser':
          this._tone(L(0.1, 0.3), t0, 0.1, { type: 'sawtooth', f: 1900, f2: 320 });
          this._tone(L(0.05, 0.18), t0, 0.05, { type: 'sine', f: 2600 });
          break;
        case 'shootRocket':
          this._noise(L(0.28, 0.45), t0, 0.28, { lp: 300, lpEnd: 1400, q: 0.5 });  // whoosh out
          this._tone(L(0.18, 0.4), t0, 0.18, { type: 'sine', f: 130, f2: 40 });    // launch
          break;
        case 'shootTank':
          this._tone(L(0.3, 0.9), t0, 0.3, { type: 'sine', f: 95, f2: 32 });       // cannon
          this._noise(L(0.35, 0.6), t0, 0.35, { lp: 220, lpEnd: 80, q: 0.6 });     // boom body
          this._tone(L(0.12, 0.3), t0, 0.12, { type: 'triangle', f: 210, f2: 140 }); // shell ring
          break;
        case 'hit':
          this._noise(L(0.045, 0.3), t0, 0.045, { bp: 800, q: 1 });                // flesh
          this._tone(L(0.05, 0.25), t0, 0.05, { type: 'sine', f: 170, f2: 90 });
          break;
        case 'clank':
          this._noise(L(0.03, 0.28), t0, 0.03, { hp: 3000 });                      // metal tick
          this._tone(L(0.09, 0.32), t0, 0.09, { type: 'triangle', f: 620, f2: 300 });
          break;
        case 'kill':
          this._tone(L(0.22, 0.5), t0, 0.22, { type: 'triangle', f: 300, f2: 70 });
          this._noise(L(0.12, 0.3), t0, 0.12, { lp: 400 });
          break;
        case 'squish':
          this._noise(L(0.09, 0.45), t0, 0.09, { lp: 500, q: 1 });                 // wet flesh
          this._tone(L(0.08, 0.3), t0, 0.08, { type: 'sine', f: 120, f2: 60 });
          break;
        case 'chunk':
          this._noise(L(0.07, 0.6), t0, 0.07, { lp: 200, q: 1 });                  // heavy thud
          this._tone(L(0.1, 0.5), t0, 0.1, { type: 'sine', f: 80, f2: 40 });
          break;
        case 'tree':
          this._noise(L(0.06, 0.4), t0, 0.06, { bp: 700, q: 2 });                  // wood crack
          this._tone(L(0.05, 0.3), t0, 0.05, { type: 'square', f: 180, f2: 90 });
          break;
        case 'fruit':
          this._tone(L(0.1, 0.4), t0, 0.1, { type: 'sine', f: 880, f2: 1320 });
          this._tone(L(0.08, 0.2), t0 + 0.06, 0.08, { type: 'sine', f: 1760 });
          break;
        case 'pickup':
          this._tone(L(0.06, 0.35), t0, 0.06, { type: 'square', f: 660 });
          this._tone(L(0.06, 0.32), t0 + 0.06, 0.06, { type: 'square', f: 880 });
          this._tone(L(0.1, 0.3), t0 + 0.12, 0.1, { type: 'square', f: 1100 });
          break;
        case 'hurt':
          this._tone(L(0.22, 0.6), t0, 0.22, { type: 'sawtooth', f: 200, f2: 70 });
          this._noise(L(0.15, 0.3), t0, 0.15, { lp: 300 });
          break;
        case 'dash':
          this._noise(L(0.18, 0.35), t0, 0.18, { bp: 1200, bpEnd: 400, q: 0.6 });  // swish
          break;
        case 'explode':
          this._tone(L(0.55, 1.0), t0, 0.55, { type: 'sine', f: 110, f2: 28 });    // sub
          this._noise(L(0.6, 0.8), t0, 0.6, { lp: 600, lpEnd: 60, q: 0.7 });       // body
          this._noise(L(0.08, 0.3), t0, 0.08, { bp: 2000, q: 0.8 });               // crackle
          break;
        case 'levelup':
          this._tone(L(0.12, 0.4), t0, 0.12, { type: 'triangle', f: 523 });
          this._tone(L(0.12, 0.4), t0 + 0.1, 0.12, { type: 'triangle', f: 659 });
          this._tone(L(0.12, 0.4), t0 + 0.2, 0.12, { type: 'triangle', f: 784 });
          this._tone(L(0.26, 0.45), t0 + 0.3, 0.26, { type: 'triangle', f: 1046 });
          break;
        case 'win': {
          const notes = [523, 659, 784, 1046, 784, 1046, 1318];
          notes.forEach((f, i) => this._tone(L(i === notes.length - 1 ? 0.6 : 0.15, 0.4), t0 + i * 0.15, i === notes.length - 1 ? 0.6 : 0.15, { type: 'square', f }));
          break;
        }
        case 'lose':
          this._tone(L(1.2, 0.6), t0, 1.2, { type: 'sawtooth', f: 220, f2: 40 });
          this._tone(L(1.0, 0.22), t0, 1.0, { type: 'triangle', f: 233 });        // dissonant drone
          break;
        case 'heartbeat':
          this._tone(L(0.09, 0.8), t0, 0.09, { type: 'sine', f: 55 });             // lub
          this._tone(L(0.09, 0.55), t0 + 0.16, 0.09, { type: 'sine', f: 50 });     // dub
          break;
        case 'alarm': {
          for (let i = 0; i < 2; i++) {
            this._tone(L(0.22, 0.2), t0 + i * 0.48, 0.22, { type: 'square', f: 620 });
            this._tone(L(0.22, 0.2), t0 + i * 0.48 + 0.24, 0.22, { type: 'square', f: 470 });
          }
          break;
        }
        default: break;
      }
    }

    /* ----------------------------------------------------------- music --- */
    /* A generative loop in A minor: bass pulse, arpeggio, noise percussion.
       Intensity scales density, tempo and layer count:
         0 title bed · 1 combat · 2 heat is on · 3 base under fire (104bpm). */

    setIntensity(n) { this._intensity = U.clamp(n | 0, 0, 3); }

    ensureMusic() {
      if (!this.ctx || this._schedTimer) return;
      if (typeof setInterval === 'undefined') return;   // headless environments
      this._step = 0;
      this._nextT = this.ctx.currentTime + 0.1;
      this._schedTimer = setInterval(() => this._musicTick(), 30);
    }

    _musicTick() {
      if (!this.ctx) return;
      const bpm = [72, 92, 92, 104][this._intensity];
      const stepDur = 60 / bpm / 4;
      const horizon = this.ctx.currentTime + 0.15;
      while (this._nextT < horizon) {
        this._scheduleStep(this._step, this._nextT);
        this._nextT += stepDur;
        this._step = (this._step + 1) % 64;
      }
    }

    _mNote(t0, dur, freq, o) {
      const g = this._layer(this.musicBus, t0, dur, o.peak, 0.006);
      const osc = this.ctx.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(Math.max(20, freq), t0);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + dur);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = o.lp || 2000; f.Q.value = 0.6;
      osc.connect(f); f.connect(g);
      if (this._delay && o.echo) {
        const s = this.ctx.createGain(); s.gain.value = o.echo;
        f.connect(s); s.connect(this._delay);
      }
      osc.start(t0); osc.stop(t0 + dur + 0.03);
    }

    _mHit(t0, dur, o) {
      const g = this._layer(this.musicBus, t0, dur, o.peak, 0.002);
      if (o.f) {   // kick: sine drop
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(o.f, t0);
        osc.frequency.exponentialRampToValueAtTime(Math.max(25, o.f2 || o.f * 0.4), t0 + dur);
        osc.connect(g);
        osc.start(t0); osc.stop(t0 + dur + 0.02);
      } else {      // noise hit: snare / hat
        const len = Math.max(32, Math.floor(this.ctx.sampleRate * dur));
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = ctx_noise(this, buf);
        let head = src;
        if (o.bp != null || o.hp != null) {
          const f = this.ctx.createBiquadFilter();
          f.type = o.bp != null ? 'bandpass' : 'highpass';
          f.frequency.value = o.bp || o.hp;
          f.Q.value = o.q || 0.8;
          src.connect(f); head = f;
        }
        head.connect(g);
        src.start(t0); src.stop(t0 + dur + 0.02);
      }
    }

    _scheduleStep(step, t) {
      const I = this._intensity;
      const bar = (step / 16) | 0;        // 0..3
      const s = step % 16;
      const BASS  = [55, 43.65, 65.41, 49];               // A1 F1 C2 G1
      const FIFTH = [82.41, 65.41, 98, 73.42];
      const CHORDS = [
        [220, 261.63, 329.63],        // Am
        [174.61, 220, 261.63],        // F
        [261.63, 329.63, 392],        // C
        [196, 246.94, 293.66],        // G
      ];

      // bass: title = one long root per bar; otherwise an eighth-note pulse
      const e = (step / 2) % 8;
      if (I === 0) {
        if (e === 0) this._mNote(t, 1.8, BASS[bar], { peak: 0.5, lp: 300, echo: 0.5 });
      } else {
        const n = e % 2 === 0 ? BASS[bar] : FIFTH[bar];
        this._mNote(t, 0.2, n, { peak: 0.34, lp: 320, echo: 0.18 });
      }

      // arpeggio: density and octave span grow with intensity
      const MASKS = [
        [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
        [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1],
        [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1],
        [1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1],
      ];
      if (MASKS[I][s] && !(I < 3 && Math.random() < 0.15)) {
        const chord = CHORDS[bar];
        let n = chord[(s * 3 + bar * 2) % 3];
        if (I >= 2 && s % 4 < 2) n *= 2;
        this._mNote(t, I === 0 ? 1.0 : 0.16, n, {
          type: 'square',
          peak: I === 0 ? 0.14 : 0.19,
          lp: I >= 3 ? 2600 : 1500,
          echo: 0.5,
        });
      }

      // percussion
      if (I >= 1 && (s === 0 || s === 8)) this._mHit(t, 0.13, { peak: 0.5, f: 120, f2: 38 });
      if (I === 3 && (s === 4 || s === 12)) this._mHit(t, 0.13, { peak: 0.38, f: 110, f2: 36 });
      if (I >= 2 && (s === 4 || s === 12)) this._mHit(t, 0.12, { peak: 0.3, bp: 1800, q: 0.8 });
      if (I >= 1 && (s === 2 || s === 6 || s === 10 || s === 14)) this._mHit(t, 0.04, { peak: I >= 2 ? 0.13 : 0.07, hp: 7000 });
      if (I === 3 && (s === 1 || s === 3 || s === 11 || s === 13)) this._mHit(t, 0.03, { peak: 0.05, hp: 8000 });
    }
  }

  function ctx_noise(self, buf) {
    const src = self.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  W.Audio = Audio;
})(window.WARS || (window.WARS = {}));
