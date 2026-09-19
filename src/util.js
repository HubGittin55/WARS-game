/* WARS — math + RNG helpers. Pure, no dependencies, safe to unit test. */
(function (W) {
  'use strict';

  const TAU = Math.PI * 2;
  const U = {};

  U.TAU = TAU;
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  // Frame-rate independent exponential smoothing.
  U.damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
  U.sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

  U.dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
  U.dist = (ax, ay, bx, by) => Math.sqrt(U.dist2(ax, ay, bx, by));
  U.angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);

  U.wrapAngle = (a) => {
    a = a % TAU;
    if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU;
    return a;
  };
  U.angleDiff = (from, to) => U.wrapAngle(to - from);
  U.turnToward = (cur, target, maxStep) => {
    const d = U.angleDiff(cur, target);
    if (Math.abs(d) <= maxStep) return target;
    return U.wrapAngle(cur + U.sign(d) * maxStep);
  };

  U.circleHit = (ax, ay, ar, bx, by, br) => U.dist2(ax, ay, bx, by) <= (ar + br) * (ar + br);

  /** Squared distance from point P to segment AB — used for swept bullet hits. */
  U.segDist2 = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + dx * t, cy = ay + dy * t;
    return U.dist2(px, py, cx, cy);
  };
  /** Closest point on segment AB to P (the impact point). */
  U.segClosest = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return { x: ax + dx * t, y: ay + dy * t };
  };

  // Move `p` toward `target` by at most `maxDelta` (per-axis, for velocities).
  U.approach = (p, target, maxDelta) =>
    p < target ? Math.min(p + maxDelta, target) : Math.max(p - maxDelta, target);

  U.rectContains = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

  U.formatTime = (s) => {
    s = Math.max(0, s | 0);
    const m = (s / 60) | 0, r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  };

  /** Deterministic PRNG (mulberry32). Returns an object with convenience samplers. */
  U.makeRng = function (seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const rng = {
      next,
      seed: () => s,
      range: (a, b) => a + next() * (b - a),
      int: (n) => (next() * n) | 0,
      chance: (p) => next() < p,
      sign: () => (next() < 0.5 ? -1 : 1),
      angle: () => next() * TAU,
      pick: (arr) => arr[(next() * arr.length) | 0],
      weighted: (entries) => {
        // entries: [[value, weight], ...]
        let total = 0;
        for (const e of entries) total += e[1];
        let r = next() * total;
        for (const e of entries) { r -= e[1]; if (r <= 0) return e[0]; }
        return entries[entries.length - 1][0];
      },
      shuffle: (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = (next() * (i + 1)) | 0;
          const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
      },
    };
    return rng;
  };

  /** Simple AABB struct used by UI layout. */
  U.box = (x, y, w, h) => ({ x, y, w, h });
  U.boxHit = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

  W.Util = U;
})(window.WARS || (window.WARS = {}));