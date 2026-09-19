/*
  tools/playtest.js — pacing / balance probe.

  Runs headless matches driven by the "decent human" bot from tools/harness.js
  and reports how long runs last, whether they end in a win, base HP, accuracy
  and fruit pickups. Use it after any balance change:

      node tools/playtest.js            # 8 seeds, 7 minute cap
      node tools/playtest.js 300        # 5 minute cap
      node tools/playtest.js 300 12     # 5 minute cap, 12 seeds

  The bot never dodges bullets, so its death counts are pessimistic.
*/
'use strict';
const { W, makeInput, humanish, newMem, step } = require('./harness');

const LIMIT = Number(process.argv[2] || 420);
const NSEEDS = Number(process.argv[3] || 8);
const SEEDS = Array.from({ length: NSEEDS }, (_, i) => 11 + i * 11);
const DT = 1 / 120;

const results = [];
for (const seed of SEEDS) {
  const g = new W.Game({ seed });
  g.state = 'playing';
  const input = makeInput();
  let deaths = 0, picks = 0;
  const mem = newMem(g.player.x, g.player.y);
  const steps = Math.round(LIMIT / DT);
  for (let i = 0; i < steps; i++) {
    step(g, input, DT, mem);
    const s = g.world.stats;
    if (g.player.dead && g.respawnT > 0 && g.respawnT < DT * 2) deaths++;
    if (g.world.stats.fruit > picks) picks = g.world.stats.fruit;
    if (g.state === 'won' || g.state === 'lost') break;
  }
  const s = g.world.stats;
  results.push({
    seed, state: g.state, t: +g.time.toFixed(1), lvl: g.level, kills: s.kills, deaths,
    acc: s.shots ? Math.round((s.hits / s.shots) * 100) : 0,
    yourBase: Math.ceil(g.world.playerBase.hp), foeBase: Math.ceil(g.world.enemyBase.hp),
    fruit: s.fruit, dmg: Math.round(s.dmgDealt), taken: Math.round(s.dmgTaken),
    minBase: Math.round(mem.minBase), atBase: +mem.atBase.toFixed(1), crates: s.crates,
  });
}

const pad = (v, n) => String(v).padStart(n);
console.log('\n seed  result      time  lvl kills dth acc  yourBase foeBase fruit dmg  taken  nearBase  timeAtBase crates');
for (const r of results) {
  console.log(' ' + pad(r.seed, 6) + pad(r.state, 12) + pad(r.t, 7) + pad(r.lvl, 5) + pad(r.kills, 7) + pad(r.deaths, 5) +
    pad(r.acc + '%', 6) + pad(r.yourBase, 10) + pad(r.foeBase, 9) + pad(r.fruit, 7) + pad(r.dmg, 6) + pad(r.taken, 7) +
    pad(r.minBase, 9) + pad(r.atBase, 11) + pad(r.crates, 7));
}
const wins = results.filter((r) => r.state === 'won').length;
const avg = (k) => (results.reduce((a, r) => a + r[k], 0) / results.length).toFixed(0);
console.log('\n wins ' + wins + '/' + results.length +
  '   avg run ' + avg('t') + 's   avg enemy base left ' + avg('foeBase') +
  '   avg your base left ' + avg('yourBase') +
  '   avg deaths ' + avg('deaths') + '   avg crates ' + avg('crates') + '\n');