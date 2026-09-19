/*
  tools/pressure.js — difficulty curve probe.

  Prints how many enemies exist, how many are actually on screen, how fast the
  player is taking damage and how the two bases are doing, sampled every 20s.
  This is the tool to reach for when the game feels too hot or too tame:

      node tools/pressure.js               # 4 minutes, seeds 11 and 44
      node tools/pressure.js 300 11 22 33  # custom window + seeds

  The opening columns are the ones that matter most for a first-time player.
*/
'use strict';
const { W, makeInput, newMem, step } = require('./harness');

const LIMIT = Number(process.argv[2] || 240);
const SEEDS = process.argv.slice(3).map(Number).filter((n) => !Number.isNaN(n));
const seeds = SEEDS.length ? SEEDS : [11, 44];
const DT = 1 / 60;
const EVERY = 20; // seconds per sample

for (const seed of seeds) {
  const g = new W.Game({ seed });
  g.state = 'playing';
  const input = makeInput();
  const mem = newMem(g.player.x, g.player.y);
  const rows = [];
  let nextAt = 0, lastDmg = 0, lastShot = 0, lastBody = 0, lastKills = 0, maxAlive = 0, maxOnScreen = 0, lowHp = 0;

  const steps = Math.round(LIMIT / DT);
  for (let i = 0; i < steps; i++) {
    step(g, input, DT, mem);

    let alive = 0, onScreen = 0;
    for (const f of g.world.fighters) {
      if (f.dead || f.isPlayer) continue;
      alive++;
      if (f.x > g.camera.x - 30 && f.x < g.camera.x + g.camera.w + 30 &&
          f.y > g.camera.y - 30 && f.y < g.camera.y + g.camera.h + 30) onScreen++;
    }
    maxAlive = Math.max(maxAlive, alive);
    maxOnScreen = Math.max(maxOnScreen, onScreen);
    if (g.player.hp < g.player.maxHp * 0.3) lowHp += DT;

    if (g.time >= nextAt) {
      const s = g.world.stats;
      rows.push({
        t: Math.round(nextAt), alive, onScreen,
        hp: Math.round(g.player.hp), lvl: g.level,
        intake: Math.round(s.dmgTaken - lastDmg), kills: s.kills - lastKills,
        bullets: Math.round(s.dmgShot - lastShot), bodies: Math.round(s.dmgBody - lastBody),
        deaths: g.deaths || 0,
        foeBase: Math.round(g.world.enemyBase.hp), yourBase: Math.round(g.world.playerBase.hp),
        gun: g.player.weapon.id,
      });
      lastDmg = s.dmgTaken; lastKills = s.kills; lastShot = s.dmgShot; lastBody = s.dmgBody; nextAt += EVERY;
    }
    if (g.state === 'won' || g.state === 'lost') break;
  }

  console.log(`\n=== seed ${seed} — ${g.state} at ${g.time.toFixed(0)}s | peak alive ${maxAlive}, peak on screen ${maxOnScreen}, ${lowHp.toFixed(0)}s under 30% HP ===`);
  console.log('   t  alive onScr  pHp  dmg/' + EVERY + "s  (bullets/body) kills lvl gun      foeBase yourBase");
  for (const r of rows) {
    console.log('  ' + String(r.t).padStart(4) + String(r.alive).padStart(6) + String(r.onScreen).padStart(6) +
      String(r.hp).padStart(6) + String(r.intake).padStart(8) + String(r.bullets + '/' + r.bodies).padStart(15) +
      String(r.kills).padStart(6) + String(r.lvl).padStart(4) +
      ' ' + r.gun.padEnd(8) + String(r.foeBase).padStart(8) + String(r.yourBase).padStart(9));
  }
}
console.log('\nTarget feel: opening rows ~6-10 alive / <=5 on screen, damage intake falling as the\nplayer levels, and a win only once foeBase hits 0.\n');