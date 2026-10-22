/* Headless smoke test: loads every src/*.js in a stubbed DOM, simulates ~40s of
   gameplay and renders frames against a mock 2D context. Catches reference errors,
   bad math and draw-path crashes without needing a browser.
   Run: node tools/smoke.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/* ------------------------------------------------------- DOM/browser stubs -- */
const noop = () => {};
const anyObj = () => ({ addColorStop: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }) });

const ctxTarget = {};
let drawCalls = 0, badArgs = [];
const mockCtx = new Proxy(ctxTarget, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return anyObj;
    if (k === 'getImageData') return () => ({ data: [] });
    if (typeof k === 'symbol') return undefined;
    // Record + validate: every numeric argument of every canvas call must be finite.
    return (...args) => {
      drawCalls++;
      for (const a of args) {
        if (typeof a === 'number' && !Number.isFinite(a) && badArgs.length < 12) badArgs.push(String(k) + '(' + args.join(',') + ')');
      }
      if ((k === 'fillRect' || k === 'strokeRect') && args.some((a) => typeof a === 'number' && Math.abs(a) > 1e6) && badArgs.length < 12) {
        badArgs.push(k + ' absurd size (' + args.join(',') + ')');
      }
    };
  },
  set(t, k, v) {
    if ((k === 'fillStyle' || k === 'strokeStyle') && typeof v === 'string' && /NaN|undefined/.test(v) && badArgs.length < 12) badArgs.push(k + '=' + v);
    if ((k === 'globalAlpha' || k === 'lineWidth') && !Number.isFinite(v) && badArgs.length < 12) badArgs.push(k + '=' + v);
    t[k] = v; return true;
  },
});

const store = {};
const sandbox = {
  console,
  Math, JSON, Date, Object, Array, String, Number, Boolean, Error, RegExp, Set, Map, Symbol, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN,
  performance: { now: () => Date.now() },
  requestAnimationFrame: noop,
  navigator: { getGamepads: () => [] },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  setTimeout, clearTimeout,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = noop;
sandbox.window.innerWidth = 1280;
sandbox.window.innerHeight = 720;
sandbox.window.devicePixelRatio = 1;
sandbox.document = {
  readyState: 'loading',                 // keeps main.js from auto-booting
  addEventListener: noop,
  getElementById: () => null,
  hidden: false,
};
sandbox.window.AudioContext = undefined;  // audio degrades to no-op

const context = vm.createContext(sandbox);
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
// config must be first (others read it at load time).
const order = ['config.js', 'util.js', 'input.js', 'audio.js', 'camera.js', 'weapons.js', 'upgrades.js',
  'entities.js', 'world.js', 'ai.js', 'director.js', 'render.js', 'ui.js', 'game.js', 'main.js'];
const sorted = order.filter((f) => files.includes(f)).concat(files.filter((f) => !order.includes(f)));

for (const f of sorted) {
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  try { vm.runInContext(code, context, { filename: path.join(SRC, f) }); }
  catch (e) { console.error('LOAD FAIL ' + f + '\n' + e.stack); process.exit(1); }
}

const W = sandbox.window.WARS;
const fail = [];
const ok = (cond, msg) => { if (cond) console.log('  ok   ' + msg); else { console.log('  FAIL ' + msg); fail.push(msg); } };

console.log('\n== load ==');
ok(!!(W.Config && W.Util && W.Input && W.Audio && W.Camera && W.Weapons && W.Upgrades &&
  W.Fighter && W.Base && W.Tree && W.World && W.AI && W.Director && W.Renderer && W.UI && W.Game),
  'all modules registered on WARS namespace');

/* ------------------------------------------------------------- simulate -- */
console.log('\n== simulate 40s ==');
const game = new W.Game({ seed: 4242 });
const input = new W.Input(null);         // no canvas -> no listeners
game.view = W.Renderer.computeView(1280, 720);
game.state = 'playing';

const DT = 1 / 120;
const STEPS = Math.round(40 / DT);
let err = null;
let maxBullets = 0, sawFruitDrop = 0, sawPickup = 0;
try {
  for (let i = 0; i < STEPS; i++) {
    // Nudge the player around so movement/aim code paths all execute.
    const t = i * DT;
    input.down.clear();
    if (Math.sin(t) > 0) input.down.add('KeyD'); else input.down.add('KeyA');
    if (Math.cos(t * 0.7) > 0) input.down.add('KeyW'); else input.down.add('KeyS');
    if (i % 900 === 0) input.pressed.add('Space');

    game.update(DT, input);
    if (game.state === 'levelup') game.takeCard(0);   // auto-pick so the loop keeps running
    maxBullets = Math.max(maxBullets, game.world.bullets.length);
    if (game.world.fruits.length) sawFruitDrop++;
    if (game.world.pickups.length) sawPickup++;
    if (i % 20 === 0) game.draw(mockCtx, game.view, 1, input);
  }
} catch (e) { err = e; }

ok(!err, 'no exception during 40s simulation' + (err ? ' -> ' + (err.stack || err) : ''));
ok(game.world.trees.length === W.Config.TREE.count, `map built ${game.world.trees.length} trees (want ${W.Config.TREE.count})`);
ok(game.world.bases.length === 2, 'two bases exist (player + enemy)');
ok(game.world.playerBase.team === 0 && game.world.enemyBase.team === 1, 'bases are on opposite teams');
ok(game.world.stats.shots > 50, `shots were fired (${game.world.stats.shots})`);
ok(game.director.spawned > 10, `director spawned bots (${game.director.spawned})`);
ok(game.world.stats.kills > 0, `player-team kills registered (${game.world.stats.kills})`);
ok(maxBullets > 5 && maxBullets <= W.Config.WORLD.MAX_BULLETS, `bullet count stayed in range (peak ${maxBullets})`);
ok(game.world.fighters.length <= W.Config.BOT.maxAlive + 2, `bot cap respected (${game.world.fighters.length} fighters incl. player)`);
ok(sawFruitDrop > 0, 'fruit dropped from trees at some point');
ok(sawPickup > 0, 'weapon crates spawned at some point');
ok(game.time > 39, `run clock advanced (${game.time.toFixed(1)}s)`);
ok(game.level >= 2, `XP/level-up path triggered (level ${game.level})`);
ok(game.player.hp > 0 || game.respawnT > 0, 'player is alive or awaiting respawn');
ok(Number.isFinite(game.player.x) && Number.isFinite(game.player.y), 'player position stayed finite');
ok(game.world.playerBase.hp > 0 && game.world.enemyBase.hp > 0, 'both bases still standing after 40s');
ok(drawCalls > 5000, `render path issued draw calls (${drawCalls})`);
ok(badArgs.length === 0, 'no NaN / absurd values reached the canvas' + (badArgs.length ? ' -> ' + badArgs.slice(0, 4).join(' | ') : ''));

/* ------------------------------------------------------------- invariants -- */
console.log('\n== invariants ==');
const inBounds = game.world.fighters.every((f) => f.x >= 0 && f.x <= game.world.w && f.y >= 0 && f.y <= game.world.h);
ok(inBounds, 'all fighters inside arena bounds');
const finite = game.world.bullets.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.dmg));
ok(finite, 'all bullets finite');
const hpOk = game.world.fighters.every((f) => f.hp <= f.maxHp && f.hp >= 0);
ok(hpOk, 'no fighter HP out of [0, maxHp]');

/* ------------------------------------------------------------- win path --- */
console.log('\n== end states ==');
game.world.enemyBase.hurt(99999, game.world, 0);
ok(game.state === 'won', 'destroying the enemy base wins the run');
game.restart();
ok(game.state === 'playing' && game.time < 1, 'restart resets the clock');
ok(game.world.stats.kills === 0 && game.world.stats.shots === 0 && game.world.stats.dmgTaken === 0, 'restart clears the run stats');
ok(game.world.fruits.length === 0 && game.level === 1, 'restart clears fruit and level');
game.world.playerBase.hurt(99999, game.world, 1);
ok(game.state === 'lost', 'losing your base ends the run');

/* --------------------------------------------------------------- trees ---- */
/* ------------------------------------------------------- swept hits ----- */
console.log('\n== swept bullet collision ==');
{
  const g3 = new W.Game({ seed: 31 });
  g3.state = 'playing';
  const victim = g3.world.fighters.find((f) => !f.isPlayer && f.team === 1) ||
    g3.world.addFighter({ team: 1, x: g3.player.x + 300, y: g3.player.y, type: 'grunt' });
  victim.iframes = 0; victim.spawnGuard = 0;
  const hp0 = victim.hp;
  // A round that travels 900px in ONE 60Hz step, starting well short of the target:
  // a point-in-circle test would tunnel straight through it.
  g3.world.addBullet({ x: victim.x - 700, y: victim.y, vx: 54000, vy: 0, dmg: 7, r: 3, life: 1, team: 0 });
  g3.world.update(1 / 60);
  ok(victim.hp < hp0, `fast round could not tunnel (hp ${hp0} -> ${victim.hp})`);
}

console.log('\n== fruit throttle ==');
{
  const g3 = new W.Game({ seed: 99 });
  g3.state = 'playing';
  // Park the player in the treeline and empty a minigun into the canopy: fruit
  // may only appear at dropPerSec, and the field may never exceed maxOnGround.
  const tree = g3.world.trees.reduce((a, b) => (b.r > a.r ? b : a), g3.world.trees[0]);
  const p = g3.player;
  p.x = tree.x - 90; p.y = tree.y; p.spawnGuard = 0;
  p.giveWeapon('minigun', 999);
  let dropped = 0;
  const origAdd = g3.world.addFruit.bind(g3.world);
  g3.world.addFruit = (...a) => { dropped++; return origAdd(...a); };
  const DT = 1 / 60;
  const perSec = [];
  let t = 0, seen = 0, peakOnGround = 0;
  for (let i = 0; i < Math.round(12 / DT); i++) {
    p.aim = Math.atan2(tree.y - p.y, tree.x - p.x);
    p.cd = 0;                                  // never rate-limited by the gun
    p.tryFire(g3.world, p.aim, g3.world.rng);
    g3.world.update(DT);
    t += DT;
    peakOnGround = Math.max(peakOnGround, g3.world.fruits.length);
    if (t - (perSec.length + 1) >= 0) { perSec.push(dropped - seen); seen = dropped; }
  }
  const maxPerSec = Math.max(...perSec);
  const D = W.Config.TREE;
  ok(perSec.length >= 8, `sampled ${perSec.length} one-second windows (${perSec.join('/')})`);
  ok(maxPerSec <= D.dropPerSec, `fruit never dropped faster than ${D.dropPerSec}/s (peak ${maxPerSec}/s)`);
  ok(peakOnGround <= D.maxOnGround, `never more than ${D.maxOnGround} fruit on the field (peak ${peakOnGround})`);
  ok(g3.player.hp <= g3.player.maxHp, 'player hp still bounded');
}

console.log('\n== dash ==');
{
  const g5 = new W.Game({ seed: 7 });
  g5.state = 'playing';
  const p = g5.player;
  p.spawnGuard = 0; p.dashCd = 0;
  const x0 = p.x, hp0 = p.hp;
  ok(p.tryDash(1, 0, g5.world), 'dash fires when off cooldown');
  ok(p.iframes > 0, 'dash grants i-frames');
  p.hurt(25, g5.world, 1);
  ok(p.hp === hp0, 'you cannot be shot out of a dash');
  for (let i = 0; i < 8; i++) g5.world.update(1 / 60);
  ok(p.x - x0 > 30, `the dash actually moved the player (${(p.x - x0).toFixed(0)}px)`);
  ok(!p.tryDash(1, 0, g5.world), 'dash is spent immediately after');
  for (let i = 0; i < 60; i++) g5.world.update(1 / 60);
  ok(p.tryDash(1, 0, g5.world), 'dash recharges after dashCd');
}

/* --------------------------------------------------- wedge / slide ------ */
console.log('\n== no wedging on cover ==');
{
  const g4 = new W.Game({ seed: 55 });
  g4.state = 'playing';
  // Park a fighter against a tree and drive it straight through the trunk.
  const tree = g4.world.trees.find((t) => g4.world.trees.every((o) => o === t || U2(g4.world, t, o) > 200)) || g4.world.trees[0];
  const f = g4.world.addFighter({ team: 0, x: tree.x - tree.r * 0.72 - 14, y: tree.y, type: 'test' });
  f.spawnGuard = 0;
  const start = { x: f.x, y: f.y };
  // Steer like the player controller does (lerp velocity toward input) rather
  // than hard-setting it, so the slide assist is not erased by the test itself.
  for (let i = 0; i < 90; i++) {
    f.vx += (240 - f.vx) * Math.min(1, (1 / 60) * 12);
    f.vy += (0 - f.vy) * Math.min(1, (1 / 60) * 12);
    g4.world.update(1 / 60);
  }
  const moved = Math.hypot(f.x - start.x, f.y - start.y);
  ok(moved > 25, `fighter slid around the tree instead of wedging (moved ${moved.toFixed(0)}px in 1.5s)`);
  ok(Math.hypot(f.x - tree.x, f.y - tree.y) >= tree.r * 0.72 + f.r - 1, 'fighter never ended up inside the canopy');
}
function U2(w, a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

console.log('\n== trees & fruit ==');
const g2 = new W.Game({ seed: 7 });
const tree = g2.world.trees[0];
const before = tree.fruit;
for (let i = 0; i < 40 && tree.fruit > 0; i++) tree.hit(2, g2.world, g2.world.rng);
ok(g2.world.fruits.length > 0, `shooting a tree dropped fruit (${g2.world.fruits.length} on ground, was ${before})`);
const healBefore = g2.player.hp;
g2.player.hp = Math.max(1, g2.player.hp - 40);
const fruit = g2.world.fruits[0];
fruit.x = g2.player.x; fruit.y = g2.player.y;
g2.state = 'playing';
g2.world.update(DT);
ok(g2.player.hp > healBefore - 40, 'touching fruit healed the player');

/* ------------------------------------------------------- squad & tanks ---- */
console.log('\n== squad & tanks ==');
{
  const g6 = new W.Game({ seed: 5 });
  g6.state = 'playing';
  const S = W.Config.SQUAD;
  ok(g6.squad.length === S.start, `start squad of ${S.start} deployed`);
  ok(g6.squad.every((f) => f && f.team === 0 && f.type === 'soldier' && !f.dead), 'soldiers are live player-team fighters');

  const f0 = g6.squad[0];
  const d0 = f0.dmgMul;
  g6.bumpSquad('dmg');
  ok(f0.dmgMul > d0, `squad damage tier applied to live soldiers (${d0} -> ${f0.dmgMul})`);

  g6._recruit();
  ok(g6.squad.length === S.start + 1, 'reinforcements recruit a third soldier');

  for (let i = 0; i < 180; i++) g6.world.update(1 / 60);
  ok(g6.squad.every((f) => Number.isFinite(f.x) && Number.isFinite(f.y)), 'soldier positions stayed finite after 3s of AI');

  // tank card: hidden below unlock level, offered at it, deploys, fires, explodes
  ok(!W.Upgrades.roll(g6.player, 99, g6.world.rng, g6).includes(W.Upgrades.byId('tank')), 'tank card hidden below unlock level');
  g6.level = W.Config.TANK.unlockLevel;
  ok(W.Upgrades.roll(g6.player, 99, g6.world.rng, g6).includes(W.Upgrades.byId('tank')), 'tank card offered at unlock level');
  ok(g6.deployTank(), 'deployTank reports success');
  ok(g6.world.tanks.length === 1, 'world holds the deployed tank');
  const tk = g6.world.tanks[0];
  const eb = g6.world.enemyBase;
  tk.x = eb.x - 500; tk.y = eb.y;           // put it in gun range of the enemy base
  let shells = 0;
  const origAddB = g6.world.addBullet.bind(g6.world);
  g6.world.addBullet = (o) => { if (o && o.sound === 'shootTank') shells++; return origAddB(o); };
  for (let i = 0; i < 300; i++) g6.world.update(1 / 60);
  ok(shells > 0, `tank turret fired shells at the enemy base (${shells} shells in 5s)`);
  const origDestroy = g6.world.onTankDestroyed;
  let destroyed = 0;
  g6.world.onTankDestroyed = (t) => { destroyed++; origDestroy(t); };
  tk.hurt(99999, g6.world, 1);
  g6.world.update(1 / 60);
  ok(destroyed === 1, 'onTankDestroyed fired exactly once for the wreck');
  ok(g6.tanks.length === 0, 'game dropped the dead tank from its roster');
  ok(g6.world.tracks.length > 0, 'tank left tread marks on the field');

  // A tank parked in the open must be targetable: bots and the base turret
  // should be able to chip it down, or it would be an unkillable unit.
  {
    const g8 = new W.Game({ seed: 77 });
    g8.view = W.Renderer.computeView(1280, 720);
    g8.state = 'playing';
    g8.level = W.Config.TANK.unlockLevel;
    g8.deployTank();
    const tank = g8.world.tanks[0];
    g8.world.enemyBase.x = tank.x + 300;   // base turret gets a clear angle
    g8.world.enemyBase.y = tank.y;
    for (let i = 0; i < 4; i++) g8.world.addFighter(W.AI.spawnConfig('grunt', tank.x + 200, tank.y + 120, 1, 3));
    const hp0 = tank.hp;
    const in8 = new W.Input(null);
    for (let i = 0; i < 60 * 12; i++) { in8.down.clear(); g8.update(1 / 120, in8); if (g8.state === 'levelup') g8.takeCard(0); }
    ok(tank.hp < hp0 * 0.98 || tank.dead, 'enemy fire can damage a tank (' + Math.round(hp0) + ' -> ' + Math.round(tank.hp) + ')');
  }
}

/* ------------------------------------------------------- level selection -- */
console.log('\n== level selection ==');
{
  const lv = W.Config.LEVELS;
  const g7 = new W.Game({ seed: 11 });
  ok(g7.world.trees.length === lv[0].trees, `default map ${lv[0].name} built with ${lv[0].trees} trees`);
  ok(g7.setLevel(lv[1].id), 'setLevel accepts a valid map id');
  g7.reset();
  ok(g7.world.levelId === lv[1].id, 'world carries the selected level id');
  ok(g7.world.trees.length === lv[1].trees, `rebuilt map ${lv[1].name} has ${lv[1].trees} trees (pattern ${lv[1].pattern})`);
  ok(!g7.setLevel('nope'), 'setLevel rejects unknown ids');
  // the layouts actually differ geometrically, not just in tree count
  const a = new W.Game({ seed: 33 }); const b = new W.Game({ seed: 33 });
  b.setLevel(lv[2].id); b.reset();
  const dist2 = (t1, t2) => (t1.x - t2.x) ** 2 + (t1.y - t2.y) ** 2;
  let different = a.world.trees.length !== b.world.trees.length;
  if (!different && a.world.trees.length === b.world.trees.length) {
    different = a.world.trees.some((t1) => !b.world.trees.some((t2) => dist2(t1, t2) < 1));
  }
  ok(different, `${lv[0].name} and ${lv[2].name} produce different tree layouts`);
}

/* --------------------------------------------------- audio (headless) ---- */
console.log('\n== audio (headless no-ops) ==');
{
  const A = new W.Audio();
  const names = ['shootPistol', 'shootSmg', 'shootShotgun', 'shootLaser', 'shootRocket', 'shootTank',
    'hit', 'clank', 'kill', 'squish', 'chunk', 'tree', 'fruit', 'pickup', 'hurt', 'dash', 'explode',
    'levelup', 'win', 'lose', 'heartbeat', 'alarm', 'wind'];
  let threw = null;
  try {
    for (const n of names) A.play(n);
    A.setIntensity(3); A.setIntensity(-2); A.ensureMusic(); A.setMuted(true); A.setMuted(false);
  } catch (e) { threw = e; }
  ok(!threw, 'all sfx names + music controls no-op safely headless' + (threw ? ' -> ' + (threw.stack || threw) : ''));
}

console.log('\n' + (fail.length ? 'SMOKE FAILED (' + fail.length + ')' : 'SMOKE PASSED') + '\n');
process.exit(fail.length ? 1 : 0);