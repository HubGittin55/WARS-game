/* WARS — weapon definitions + firing. Data-driven: add an entry, get a powerup.
   A "weapon" is pure data; `fire()` only needs a shooter position + team + angle. */
(function (W) {
  'use strict';
  const U = W.Util;

  const DEF = {
    pistol: {
      id: 'pistol', name: 'Pistol', sound: 'shootPistol', tier: 0,
      rate: 0.26, dmg: 15, speed: 660, spread: 0.03, pellets: 1,
      life: 1.1, r: 3.6, color: '#c9f0ff', pierce: 0, splash: 0, knock: 30,
      desc: 'Reliable sidearm. Infinite.',
    },
    smg: {
      id: 'smg', name: 'SMG', sound: 'shootSmg', tier: 1,
      rate: 0.075, dmg: 8, speed: 760, spread: 0.14, pellets: 1,
      life: 0.85, r: 3.0, color: '#a8ffd0', pierce: 0, splash: 0, knock: 12,
      desc: 'Spray and pray. High rate, low dmg.',
    },
    shotgun: {
      id: 'shotgun', name: 'Scattergun', sound: 'shootShotgun', tier: 2,
      rate: 0.72, dmg: 10, speed: 660, spread: 0.34, pellets: 8,
      life: 0.42, r: 3.4, color: '#ffd7a0', pierce: 1, splash: 0, knock: 60,
      desc: '8 pellets, short range, shreds up close.',
    },
    laser: {
      id: 'laser', name: 'Lance', sound: 'shootLaser', tier: 2,
      rate: 0.16, dmg: 15, speed: 1500, spread: 0.005, pellets: 1,
      life: 0.55, r: 2.6, color: '#c7a8ff', pierce: 3, splash: 0, knock: 8,
      desc: 'Fast piercing beams. Cuts through a crowd.',
    },
    rocket: {
      id: 'rocket', name: 'RL-8', sound: 'shootRocket', tier: 3,
      rate: 1.05, dmg: 34, speed: 420, spread: 0.02, pellets: 1,
      life: 1.6, r: 6, color: '#ffb066', pierce: 0, splash: 78, knock: 120,
      desc: 'Splash damage. Careful, it is not aimed for you.',
    },
    minigun: {
      id: 'minigun', name: 'Buzzsaw', sound: 'shootSmg', tier: 3,
      rate: 0.045, dmg: 6, speed: 880, spread: 0.2, pellets: 1,
      life: 0.7, r: 2.8, color: '#fff08a', pierce: 0, splash: 0, knock: 6,
      desc: 'Absurd rate. Wild spread.',
    },
  };

  const PICKUPS = ['smg', 'shotgun', 'laser', 'rocket', 'minigun'];

  const Weapons = {
    DEF,
    PICKUPS,
    get(id) { return DEF[id] || DEF.pistol; },
    tier(id) { return (DEF[id] || DEF.pistol).tier; },

    /** Spawn this weapon's bullets into `world` from (x,y) heading `angle`. */
    fire(world, w, x, y, angle, team, dmgMul, rng) {
      rng = rng || Math;
      const out = [];
      const n = w.pellets;
      for (let i = 0; i < n; i++) {
        // Fan pellets symmetrically, then jitter.
        const fan = n > 1 ? (i / (n - 1) - 0.5) * w.spread * 2 : 0;
        const jitter = (rng.next ? rng.next() : Math.random()) * 2 - 1;
        const a = angle + fan + jitter * w.spread * 0.45;
        const b = world.addBullet({
          x: x + Math.cos(a) * 16, y: y + Math.sin(a) * 16,
          vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
          dmg: w.dmg * (dmgMul || 1),
          r: w.r, life: w.life, team,
          pierce: w.pierce, splash: w.splash, knock: w.knock,
          color: w.color, kind: w.id,
        });
        if (b) out.push(b);
      }
      return out;
    },

    /** Utility: does a shot fit in the world (cheap early-out for AI). */
    inRange(shooter, target, range) {
      return U.dist2(shooter.x, shooter.y, target.x, target.y) <= range * range;
    },
  };

  W.Weapons = Weapons;
})(window.WARS || (window.WARS = {}));