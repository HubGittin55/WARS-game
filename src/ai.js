/* WARS — bot brain. One function: steer + aim + fire for every non-player fighter.
   Types are data (TYPES); behaviour is shared, with a couple of flags. */
(function (W) {
  'use strict';
  const U = W.Util;
  const CFG = W.Config;
  const T = CFG.TEAM;

  const TYPES = {
    grunt:  { hp: 34, speed: 136, r: 13, weapon: 'pistol',  fireRange: 430, preferred: 250, turn: 4.5, xp: 1, dmgMul: 1,   rateMul: 1.15, colorHint: '#ff5f5f' },
    runner: { hp: 22, speed: 205, r: 11, weapon: 'pistol',  fireRange: 190, preferred: 40,  turn: 6.5, xp: 1, dmgMul: 0.7, rateMul: 1.0,  contact: 1.7, chasePlayer: true },
    gunner: { hp: 58, speed: 104, r: 15, weapon: 'shotgun', fireRange: 300, preferred: 190, turn: 3.4, xp: 2, dmgMul: 1,   rateMul: 1.4 },
    brute:  { hp: 190, speed: 82, r: 22, weapon: 'minigun', fireRange: 480, preferred: 300, turn: 2.4, xp: 5, dmgMul: 0.9, rateMul: 1.1, contact: 2.2 },
    sniper: { hp: 40, speed: 96,  r: 13, weapon: 'laser',   fireRange: 640, preferred: 430, turn: 3.0, xp: 3, dmgMul: 1,   rateMul: 1.6 },
  };

  const AI = {
    TYPES,
    typeInfo(id) { return TYPES[id] || TYPES.grunt; },

    /** Build a fighter config for `type` at (x,y) on `team`. */
    spawnConfig(type, x, y, team, difficulty) {
      const t = this.typeInfo(type);
      const d = difficulty || 1;
      return {
        team, type, x, y,
        hp: t.hp * (1 + (d - 1) * 0.35),
        speed: t.speed * (1 + (d - 1) * 0.08),
        r: t.r,
        weaponId: t.weapon,
        xpValue: t.xp,
        rateMulHint: t.rateMul,
      };
    },

    update(dt, world, game) {
      const rng = world.rng;
      // One shared difficulty ramp for every bot: sloppy and slow at t=0, sharp later.
      const B = CFG.BOT;
      const k = U.clamp(((world.difficulty || 1) - 1) / 2, 0, 1);   // 0 -> 1 over ~4 min
      const rateRamp = U.lerp(B.earlyRateMul, B.lateRateMul, k);
      const spreadRamp = U.lerp(B.earlySpreadMul, B.lateSpreadMul, k);
      const dmgRamp = U.lerp(B.earlyDmgMul, B.lateDmgMul, k);
      for (const f of world.fighters) {
        if (f.dead || f.isPlayer) continue;
        const t = this.typeInfo(f.type);
        f.botRateMul = rateRamp * (t.rateMul || 1);
        f.botSpreadMul = spreadRamp;
        f.botDmgMul = dmgRamp * (t.dmgMul || 1);
        this._bot(dt, world, game, f, rng);
      }
    },

    _bot(dt, world, game, f, rng) {
      const t = this.typeInfo(f.type);
      const ai = f.ai;

      // --- retarget -----------------------------------------------------
      ai.retarget -= dt;
      if (ai.retarget <= 0 || !ai.target || ai.target.dead) {
        ai.retarget = rng.range(0.25, 0.55);
        const player = game.player && !game.player.dead ? game.player : null;
        const foeFighter = world.nearestEnemy(f, f.team, t.fireRange * 1.35);
        const foeBase = world.nearestEnemyBase(f, f.team, 4000);
        const dp = player ? U.dist2(f.x, f.y, player.x, player.y) : Infinity;
        const df = foeFighter ? U.dist2(f.x, f.y, foeFighter.x, foeFighter.y) : Infinity;
        const aggro = 800 * 800;   // hunters within this range prefer you over their siege
        let target = null;
        if (t.chasePlayer && player) target = player;
        else if (player && dp < aggro && dp < df * 1.6) target = player;
        else if (foeFighter) target = foeFighter;
        else if (player && dp < (t.fireRange * 2.2) ** 2) target = player;
        else target = foeBase || player;
        ai.target = target;
      }
      const target = ai.target;
      if (!target) return;

      const isBase = target instanceof W.Base;
      const d = U.dist(f.x, f.y, target.x, target.y);
      const want = U.angleTo(f.x, f.y, target.x, target.y);

      // --- steering -----------------------------------------------------
      // Approach to preferred range, strafe sideways, slide along obstacles.
      const pref = isBase ? Math.max(t.preferred, 150) : t.preferred;
      const radial = d > pref ? 1 : d < pref * 0.62 ? -1 : 0;
      ai.strafeT -= dt;
      if (ai.strafeT <= 0) { ai.strafeT = rng.range(1.1, 2.6); ai.strafe = -ai.strafe; }
      const tang = ai.strafe * (isBase ? 0.35 : 0.75);

      let dx = Math.cos(want) * radial + Math.cos(want + Math.PI / 2) * tang;
      let dy = Math.sin(want) * radial + Math.sin(want + Math.PI / 2) * tang;
      const m = Math.hypot(dx, dy) || 1;
      dx /= m; dy /= m;

      // Obstacle probe: if the next step is blocked, rotate the desired dir.
      const probe = f.r + 26;
      if (world.isBlocked(f.x + dx * probe, f.y + dy * probe, f.r)) {
        const alt = rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2;
        const nx = Math.cos(want + alt), ny = Math.sin(want + alt);
        dx = dx * 0.35 + nx * 0.85; dy = dy * 0.35 + ny * 0.85;
        const m2 = Math.hypot(dx, dy) || 1; dx /= m2; dy /= m2;
      }

      const sp = f.baseSpeed * f.speedMul;
      f.vx += (dx * sp - f.vx) * Math.min(1, dt * 8);
      f.vy += (dy * sp - f.vy) * Math.min(1, dt * 8);

      // --- aiming & firing ----------------------------------------------
      f.aim = U.turnToward(f.aim, want, dt * t.turn);
      const aligned = Math.abs(U.angleDiff(f.aim, want)) < 0.22;
      const range = t.fireRange * (f.isPlayer ? 1 : 1);
      if (d < range && aligned) {
        // Lead moving targets a little (cheap prediction).
        let a = want;
        if (!isBase) {
          const bulletSpeed = W.Weapons.get(f.weaponId).speed;
          const tof = d / bulletSpeed;
          const px = target.x + (target.vx || 0) * tof * 0.6;
          const py = target.y + (target.vy || 0) * tof * 0.6;
          a = U.angleTo(f.x, f.y, px, py);
        }
        f.aim = U.turnToward(f.aim, a, dt * t.turn * 1.5);
        if (Math.abs(U.angleDiff(f.aim, a)) < 0.16) {
          f.rateMul = f.botRateMul || 1;
          f.tryFire(world, f.aim, rng);
        }
      }
    },
  };

  W.AI = AI;
})(window.WARS || (window.WARS = {}));