/* WARS — input: keyboard, mouse (with view->world conversion), gamepad.
   Exposes a single `WARS.Input` singleton created with attach(canvas). */
(function (W) {
  'use strict';
  const U = () => W.Util;

  const KEY_ALIASES = {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    fire: ['Space', 'KeyJ'],
    dash: ['ShiftLeft', 'ShiftRight'],
    toggleAuto: ['KeyF'],
    pause: ['KeyP', 'Escape'],
    restart: ['KeyR'],
    mute: ['KeyM'],
    debug: ['Backquote'],
    card1: ['Digit1'], card2: ['Digit2'], card3: ['Digit3'],
    start: ['Enter', 'Space'],
    modeLeft: ['ArrowLeft'],
    modeRight: ['ArrowRight'],
    mode1: ['Digit1'], mode2: ['Digit2'], mode3: ['Digit3'], mode4: ['Digit4'], mode5: ['Digit5'],
    levelLeft: ['KeyQ'],
    levelRight: ['KeyE'],
    cycleControl: ['KeyC'],
  };

  class Input {
    constructor(canvas) {
      this.canvas = canvas || null;
      this.down = new Set();        // raw event.code values
      this.pressed = new Set();     // consumed-once edge set (this frame)
      this.mouse = { x: 0, y: 0, inside: false, moved: 0, lastMove: -999, left: false, right: false };
      this.moveMode = 'mouse';      // 'mouse' | 'keys' | 'pad'  (drives auto-aim behaviour)
      this.pad = { connected: false, mx: 0, my: 0, ax: 0, ay: 0, fire: 0, dash: false };
      this._anyInput = false;
      this._time = 0;
      if (canvas) this._bind();
    }

    _bind() {
      const el = window;
      el.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (this._shouldBlock(e)) e.preventDefault();
        this.down.add(e.code);
        this.pressed.add(e.code);
        this._anyInput = true;
      }, { passive: false });
      el.addEventListener('keyup', (e) => this.down.delete(e.code));
      el.addEventListener('blur', () => { this.down.clear(); this.mouse.left = false; });

      const c = this.canvas;
      c.addEventListener('mousemove', (e) => {
        const r = c.getBoundingClientRect();
        this.mouse.x = e.clientX - r.left;
        this.mouse.y = e.clientY - r.top;
        this.mouse.inside = true;
        this.mouse.moved++;
        this.mouse.lastMove = this._time;
        this.moveMode = 'mouse';
      });
      c.addEventListener('mouseleave', () => { this.mouse.inside = false; this.mouse.left = false; });
      c.addEventListener('mousedown', (e) => {
        if (e.button === 0) this.mouse.left = true;
        if (e.button === 2) this.mouse.right = true;
        this._anyInput = true;
      });
      el.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; });
      c.addEventListener('contextmenu', (e) => e.preventDefault());

      el.addEventListener('gamepadconnected', () => { this.pad.connected = true; });
      el.addEventListener('gamepaddisconnected', () => { this.pad.connected = false; });
    }

    _shouldBlock(e) {
      // Stop the page from scrolling / triggering browser find while playing.
      const blocked = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Slash', 'Quote'];
      return blocked.includes(e.code);
    }

    isDown(code) { return this.down.has(code); }
    anyDown(codes) { for (const c of codes) if (this.down.has(c)) return true; return false; }
    action(name) { return this.anyDown(KEY_ALIASES[name] || []); }
    pressedAction(name) {
      for (const c of (KEY_ALIASES[name] || [])) if (this.pressed.has(c)) return true;
      return false;
    }
    consume(name) {
      let hit = false;
      for (const c of (KEY_ALIASES[name] || [])) if (this.pressed.has(c)) { hit = true; this.pressed.delete(c); }
      return hit;
    }
    get anyInput() { return this._anyInput; }

    /** Convert a canvas-space (CSS px) point into world space. */
    toWorld(view, camera) {
      const sx = view.scale || 1, ox = view.offsetX || 0, oy = view.offsetY || 0;
      const vx = (this.mouse.x - ox) / sx;
      const vy = (this.mouse.y - oy) / sy_safe(view);
      return { x: vx + camera.x, y: vy + camera.y };
    }

    /** Called once per frame BEFORE logic: polls pads, advances timers. */
    frame(dt, now) {
      this._time = now;
      this._pollPad();
    }

    /** Called once per frame AFTER logic: clears the edge-triggered set. */
    endFrame() { this.pressed.clear(); }

    _pollPad() {
      const p = this.pad;
      p.mx = p.my = p.ax = p.ay = 0; p.fire = 0; p.dash = false;
      if (!navigator || !navigator.getGamepads) return;
      const pads = navigator.getGamepads();
      let gp = null;
      for (const g of pads) if (g) { gp = g; break; }
      if (!gp) { p.connected = false; return; }
      p.connected = true;
      const dz = 0.22;
      const dzk = (v) => (Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz));
      p.mx = dzk(gp.axes[0] || 0); p.my = dzk(gp.axes[1] || 0);
      p.ax = dzk(gp.axes[2] || 0); p.ay = dzk(gp.axes[3] || 0);
      const btn = (i) => gp.buttons[i] && gp.buttons[i].value > 0.35;
      p.fire = btn(7) || btn(5) || btn(0) ? 1 : 0;   // RT / RB / A
      p.dash = btn(6) || btn(1);                     // LT / B
      if (Math.hypot(p.mx, p.my) > 0 || p.fire) this.moveMode = 'pad';
    }

    /** Normalized movement vector from keys + pad (does not include mouse aiming). */
    moveVector() {
      let x = 0, y = 0;
      if (this.action('left')) x -= 1;
      if (this.action('right')) x += 1;
      if (this.action('up')) y -= 1;
      if (this.action('down')) y += 1;
      if (x === 0 && y === 0 && (this.pad.mx || this.pad.my)) { x = this.pad.mx; y = this.pad.my; }
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      if (m > 0) this.moveMode = this.pad.mx || this.pad.my ? 'pad' : 'keys';
      return { x, y, m: Math.min(1, m) };
    }
  }

  // helper: guard against a zero-height view scale
  function sy_safe(view) { return view.scale || 1; }

  W.Input = Input;
  W.KEY_ALIASES = KEY_ALIASES;
})(window.WARS || (window.WARS = {}));