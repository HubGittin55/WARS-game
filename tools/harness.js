/*
  tools/harness.js — headless bootstrap shared by the dev tools.

  Loads the game's browser scripts into Node with just enough DOM stubs to run
  the simulation (no canvas, no audio). Same script list as index.html, so a
  load-order mistake here is a load-order mistake in the browser.
*/
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// Single source of truth for load order: whatever index.html actually loads.
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SCRIPTS = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]
  .map((m) => m[1].replace(/^\.?\/?src\//, '').replace(/\.js$/, ''));
for (const required of ['config', 'game', 'main']) {
  if (!SCRIPTS.includes(required)) throw new Error('index.html does not load src/' + required + '.js');
}

global.window = global;
// Node exposes a read-only `navigator`, so define rather than assign.
Object.defineProperty(global, 'navigator', { value: { maxTouchPoints: 0, userAgent: 'node', getGamepads: () => [] }, configurable: true, writable: true });
global.addEventListener = () => {};
global.devicePixelRatio = 1;
global.innerWidth = 1280;
global.innerHeight = 720;
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = () => 0;
global.localStorage = {
  _s: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
  setItem(k, v) { this._s[k] = String(v); },
};
global.AudioContext = undefined;
global.document = {
  createElement: () => ({
    style: {}, classList: { add() {}, remove() {} }, addEventListener() {}, appendChild() {},
    getContext: () => ({ canvas: {}, save() {}, restore() {}, translate() {}, scale() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {}, fillRect() {}, strokeRect() {}, fillText() {}, setTransform() {}, createRadialGradient() { return { addColorStop() {} }; } }),
  }),
  getElementById: () => null,
  addEventListener() {},
};

for (const f of SCRIPTS) require(path.join(ROOT, 'src', f + '.js'));

const W = global.WARS;
if (!W || !W.Game) throw new Error('WARS.Game missing — check src load order');

/** A synthetic InputState; `moveMode: 'auto'` keeps auto-aim on, like a gamepad. */
function makeInput() {
  const input = {
    down: new Set(),
    mouse: { x: 480, y: 270, down: false, inside: true, rmb: false },
    moveMode: 'auto', aimMode: 'auto', pads: [], gamepad: null, enabled: true,
    // Mirrors Input.moveVector / Input.aimAngle for keyboard-only input.
    moveVector() {
      let x = 0, y = 0;
      if (this.down.has('KeyA') || this.down.has('ArrowLeft')) x -= 1;
      if (this.down.has('KeyD') || this.down.has('ArrowRight')) x += 1;
      if (this.down.has('KeyW') || this.down.has('ArrowUp')) y -= 1;
      if (this.down.has('KeyS') || this.down.has('ArrowDown')) y += 1;
      const m = Math.hypot(x, y);
      return m > 1 ? { x: x / m, y: y / m, mag: 1 } : { x, y, mag: Math.min(1, m) };
    },
    aimAngle() { return null; },   // auto-aim
    // Mirrors the Input.pad getter (merged gamepad + keyboard action state).
    get pad() {
      const d = this.down;
      return {
        fire: d.has('KeyJ') || d.has('Space') ? 1 : 0,
        dash: d.has('ShiftLeft') ? 1 : 0,
        pause: 0, start: 0, back: 0, upgrade: 0, ax: 0, ay: 0,
      };
    },
    action() { return false; },
    pressedAction() { return false; },
    consume() { return false; },
    toWorld(view, camera) {
      const s = view.scale || 1;
      return { x: camera.x + (this.mouse.x - (view.offsetX || 0)) / s, y: camera.y + (this.mouse.y - (view.offsetY || 0)) / s };
    },
  };
  return input;
}

/** Hold WASD so the player walks toward (tx,ty). */
function steer(input, p, tx, ty) {
  input.down.clear();
  const dx = tx - p.x, dy = ty - p.y;
  const m = Math.hypot(dx, dy);
  if (m < 24) return;
  const nx = dx / m, ny = dy / m;
  if (nx > 0.35) input.down.add('KeyD'); else if (nx < -0.35) input.down.add('KeyA');
  if (ny > 0.35) input.down.add('KeyS'); else if (ny < -0.35) input.down.add('KeyW');
}

/**
 * A "determined human" driver: pushes the enemy base, grabs fruit when badly
 * hurt, grabs a crate if one is right there, and only turns back when our own
 * bunker is about to fall. It never dodges bullets, so its deaths are
 * pessimistic — but its *progress* is a fair proxy for a player who commits.
 */
function humanish(g, input, mem, dt) {
  const p = g.player;
  if (!p || p.dead) { input.down.clear(); return; }
  mem.t += dt;
  const enemy = g.world.enemyBase, home = g.world.playerBase;

  /* ---- unstick bookkeeping ---- */
  mem.sinceMove += Math.hypot(p.x - mem.lastX, p.y - mem.lastY);
  if (mem.t - mem.lastUnstick > 0.6) {
    if (mem.sinceMove < 18 && mem.detour <= 0) mem.detour = 1.1;
    mem.sinceMove = 0; mem.lastX = p.x; mem.lastY = p.y; mem.lastUnstick = mem.t;
  }
  if (mem.detour > 0) mem.detour -= dt;

  /* ---- what are we walking toward this frame? ---- */
  let target = null, why = '';
  if (mem.detour > 0) {
    // Wedged on a tree or a body wall: slide around it.
    const a = Math.atan2(p.y - enemy.y, p.x - enemy.x) + (mem.side || 1) * Math.PI / 2;
    target = { x: p.x + Math.cos(a) * 200, y: p.y + Math.sin(a) * 200 };
  } else if (p.hp < p.maxHp * 0.4) {
    let best = null, bd = 460 * 460;
    for (const fr of g.world.fruits) { const d = (fr.x - p.x) ** 2 + (fr.y - p.y) ** 2; if (d < bd) { bd = d; best = fr; } }
    if (best) { target = best; }
  }
  if (!target && home.hp < home.maxHp * 0.4) {
    let sieging = 0;
    for (const f of g.world.fighters) if (!f.dead && f.team !== 0 && Math.hypot(f.x - home.x, f.y - home.y) < 520) sieging++;
    if (sieging >= 3) { target = { x: home.x + 90, y: home.y - 60 }; }
  }
  if (!target) {
    let crate = null, cd = 190 * 190;
    for (const k of g.world.pickups) { const d = (k.x - p.x) ** 2 + (k.y - p.y) ** 2; if (d < cd) { cd = d; crate = k; } }
    if (crate) target = crate;
  }
  if (!target) {
    const dBase = Math.hypot(p.x - enemy.x, p.y - enemy.y);
    mem.minBase = Math.min(mem.minBase === undefined ? 1e9 : mem.minBase, dBase);
    if (dBase < 420) mem.atBase = (mem.atBase || 0) + dt;
    if (dBase < 260) {
      // On top of the bunker: orbit so their turret has to lead us.
      const a = Math.atan2(p.y - enemy.y, p.x - enemy.x) + 0.85;
      target = { x: enemy.x + Math.cos(a) * 215, y: enemy.y + Math.sin(a) * 215 };
    } else target = enemy;
  }

  /* ---- spend the dash when hurt, but keep the heading ---- */
  if (p.dashCd <= 0 && p.hp < p.maxHp * 0.6) {
    let threat = null, td = 130 * 130;
    for (const f of g.world.fighters) {
      if (f.dead || f.team === 0) continue;
      const d = (f.x - p.x) ** 2 + (f.y - p.y) ** 2;
      if (d < td) { td = d; threat = f; }
    }
    if (threat) {
      // Dodge *through*: dash along where we were already going rather than
      // backing off, so dodging never undoes the push on the objective.
      p.tryDash(target.x - p.x, target.y - p.y, g.world);
    }
  }

  steer(input, p, target.x, target.y);
}

function newMem(x, y) {
  return { t: 0, lastX: x, lastY: y, sinceMove: 0, lastUnstick: 0, detour: 0, side: 1, minBase: 1e9, atBase: 0 };
}

/** Drive one frame: pilot the bot, take a level-up card if offered, step the sim. */
function step(g, input, dt, mem, cardPick) {
  if (g.state === 'levelup') {
    const i = typeof cardPick === 'function' ? cardPick(g) : 0;
    g.takeCard(i);
  }
  humanish(g, input, mem, dt);
  g.update(dt, input);
}

module.exports = { W, ROOT, SCRIPTS, makeInput, steer, humanish, newMem, step };