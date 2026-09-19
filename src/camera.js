/* WARS — camera: smoothed follow, look-ahead toward aim, shake, world clamping. */
(function (W) {
  'use strict';
  const U = W.Util;

  class Camera {
    constructor(worldW, worldH, viewW, viewH) {
      this.w = viewW; this.h = viewH;
      this.worldW = worldW; this.worldH = worldH;
      this.x = 0; this.y = 0;
      this.tx = 0; this.ty = 0;
      this.shake = 0;
      this.shakeX = 0; this.shakeY = 0;
      this.zoom = 1;
      this._t = 0;
    }

    setView(viewW, viewH) { this.w = viewW; this.h = viewH; this._clamp(); }

    snapTo(target) {
      this.x = U.clamp(target.x - this.w / 2, 0, Math.max(0, this.worldW - this.w));
      this.y = U.clamp(target.y - this.h / 2, 0, Math.max(0, this.worldH - this.h));
      this.tx = this.x; this.ty = this.y;
    }

    /** target: {x,y}; aim: optional world point to bias the view toward. */
    update(dt, target, aim) {
      this._t += dt;
      let px = target.x, py = target.y;
      if (aim) {
        // Pull the view up to 22% toward where the player is shooting.
        const k = 0.22;
        px = U.lerp(target.x, target.x + (aim.x - target.x) * 0.5, k);
        py = U.lerp(target.y, target.y + (aim.y - target.y) * 0.5, k);
      }
      this.tx = U.clamp(px - this.w / 2, 0, Math.max(0, this.worldW - this.w));
      this.ty = U.clamp(py - this.h / 2, 0, Math.max(0, this.worldH - this.h));
      this.x = U.damp(this.x, this.tx, 7.5, dt);
      this.y = U.damp(this.y, this.ty, 7.5, dt);
      this._clamp();

      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - dt * (2.2 + this.shake * 4));
        const a = this._t * 60;
        this.shakeX = Math.sin(a * 2.1) * this.shake * 6;
        this.shakeY = Math.cos(a * 2.7) * this.shake * 6;
      } else { this.shakeX = this.shakeY = 0; }
    }

    addShake(v) { this.shake = Math.min(1.4, this.shake + v); }

    _clamp() {
      this.x = U.clamp(this.x, 0, Math.max(0, this.worldW - this.w));
      this.y = U.clamp(this.y, 0, Math.max(0, this.worldH - this.h));
    }

    /** Apply camera transform to a 2D context (call after DPR/view transform). */
    apply(ctx) {
      ctx.translate(-Math.round(this.x - this.shakeX), -Math.round(this.y - this.shakeY));
    }

    visible(x, y, pad) {
      pad = pad || 40;
      return x > this.x - pad && x < this.x + this.w + pad && y > this.y - pad && y < this.y + this.h + pad;
    }
  }

  W.Camera = Camera;
})(window.WARS || (window.WARS = {}));