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
    // Your own unit: same body rules as the bots, but the brain is _soldier().
    soldier: { hp: 46, speed: 150, r: 12, weapon: 'smg', fireRange: 420, preferred: 180, turn: 5.5, xp: 0, dmgMul: 1, rateMul: 1.0, colorHint: '#9fd4ff' },
  };

  const AI = {
    TYPES,
    typeInfo(id) { return TYPES[id] || TYPES.grunt; },

    /** Build a fighter config for `type` at (x,y) on `team`.
        `mode` (Config.MODES) scales bot stats: easy = paper tigers, hacker = monsters. */
    spawnConfig(type, x, y, team, difficulty, mode) {
      const t = this.typeInfo(type);
      const d = difficulty || 1;
      const m = mode || CFG.MODES[CFG.MODE_DEFAULT];
      return {
        team, type, x, y,
        hp: t.hp * (1 + (d - 1) * 0.35) * m.botHp,
        speed: t.speed * (1 + (d - 1) * 0.08) * (m.botSpeed || 1),
        r: t.r,
        weaponId: t.weapon,
        xpValue: t.xp,
        rateMulHint: t.rateMul,
      };
    },

    update(dt, world, game) {
      const rng = world.rng;
      // One shared difficulty ramp for every bot: sloppy and slow at t=0, sharp later.
      // The selected mode (Config.MODES) scales the whole ramp up or down.
      const B = CFG.BOT;
      const m = world.modeCfg;
      const k = U.clamp(((world.difficulty || 1) - 1) / 2, 0, 1);   // 0 -> 1 over ~4 min
      // botRate is a cooldown multiplier (higher = slower); invert it into a rate scale.
      const sloppy = m.botRate > 1.2 ? 1.3 : 1;   // easy-mode bots wobble their aim more
      const rateRamp = U.lerp(B.earlyRateMul, B.lateRateMul, k) / m.botRate;
      const spreadRamp = U.lerp(B.earlySpreadMul, B.lateSpreadMul, k) * sloppy;
      const dmgRamp = U.lerp(B.earlyDmgMul, B.lateDmgMul, k) * m.botDmg;
      for (const f of world.fighters) {
        if (f.dead || f.isPlayer) continue;
        if (f.type === 'soldier') { this._soldier(dt, world, game, f, rng); continue; }
        const t = this.typeInfo(f.type);
        f.botRateMul = rateRamp * (t.rateMul || 1);
        f.botSpreadMul = spreadRamp;
        f.botDmgMul = dmgRamp * (t.dmgMul || 1);
        this._bot(dt, world, game, f, rng);
      }
    },

    /** Your soldiers: hold a loose orbit around you (or your base when you are
        down), engage the nearest enemy in their gun range, and fall back to
        the orbit when the target leaves it. They never chase off their own
        base, so they cannot accidentally abandon the bunker to you. */
    _soldier(dt, world, game, f, rng) {
      const t = this.typeInfo('soldier');
      const S = CFG.SQUAD;
      const ai = f.ai;
      const player = game.player && !game.player.dead ? game.player : null;
      const anchor = player || (world.playerBase && world.playerBase.alive ? world.playerBase : null);
      if (!anchor) return;

      // formation slot: a slowly wandering orbit angle, one lane per soldier
      if (ai.slotAngle == null) ai.slotAngle = rng.range(0, U.TAU);
      ai.slotAngle += dt * 0.35 * (ai.slot % 2 === 0 ? 1 : -1);
      const orbitR = anchor === player ? S.formationR : 190;
      const slotX = anchor.x + Math.cos(ai.slotAngle) * orbitR;
      const slotY = anchor.y + Math.sin(ai.slotAngle) * orbitR;

      // --- target: nearest enemy in (extended) gun range ---------------
      ai.retarget -= dt;
      if (ai.retarget <= 0 || !ai.target || ai.target.dead) {
        ai.retarget = rng.range(0.3, 0.6);
        const foe = world.nearestEnemy(f, f.team, S.fireRange);
        if (foe) ai.target = foe;
        else if (world.enemyBase && world.enemyBase.alive && U.dist2(f.x, f.y, world.enemyBase.x, world.enemyBase.y) < (S.baseRange) ** 2) ai.target = world.enemyBase;
        else ai.target = null;
      }
      const target = ai.target && !ai.target.dead ? ai.target : null;

      // --- steering ------------------------------------------------------
      let dx, dy;
      if (target) {
        const d = U.dist(f.x, f.y, target.x, target.y);
        const inGunRange = d < (target instanceof W.Base ? S.baseRange : S.fireRange * 0.92);
        if (inGunRange) {
          // hold ground: drift toward the formation slot, strafe around target
          const toSlot = U.angleTo(f.x, f.y, slotX, slotY);
          const toTgt = U.angleTo(f.x, f.y, target.x, target.y);
          ai.strafeT -= dt;
          if (ai.strafeT <= 0) { ai.strafeT = rng.range(0.9, 2.2); ai.strafe = -ai.strafe; }
          dx = Math.cos(toSlot) * 0.5 + Math.cos(toTgt + Math.PI / 2) * 0.55 * ai.strafe;
          dy = Math.sin(toSlot) * 0.5 + Math.sin(toTgt + Math.PI / 2) * 0.55 * ai.strafe;
        } else {
          // close in, but never outrun the leash from home
          const home = world.playerBase;
          const homeR2 = (S.baseRange) ** 2;
          dx = Math.cos(U.angleTo(f.x, f.y, target.x, target.y));
          dy = Math.sin(U.angleTo(f.x, f.y, target.x, target.y));
          if (home && !home.dead) {
            const dh = U.dist2(f.x, f.y, home.x, home.y);
            if (dh > homeR2) { dx = Math.cos(U.angleTo(f.x, f.y, home.x, home.y)); dy = Math.sin(U.angleTo(f.x, f.y, home.x, home.y)); }
          }
        }
      } else {
        dx = Math.cos(U.angleTo(f.x, f.y, slotX, slotY));
        dy = Math.sin(U.angleTo(f.x, f.y, slotX, slotY));
      }
      const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;

      // obstacle probe, same trick as the bots
      const probe = f.r + 26;
      if (world.isBlocked(f.x + dx * probe, f.y + dy * probe, f.r)) {
        const alt = rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2;
        const want = target ? U.angleTo(f.x, f.y, target.x, target.y) : U.angleTo(f.x, f.y, slotX, slotY);
        dx = dx * 0.35 + Math.cos(want + alt) * 0.85;
        dy = dy * 0.35 + Math.sin(want + alt) * 0.85;
        const m2 = Math.hypot(dx, dy) || 1; dx /= m2; dy /= m2;
      }

      const sp = f.baseSpeed * f.speedMul;
      f.vx += (dx * sp - f.vx) * Math.min(1, dt * 8);
      f.vy += (dy * sp - f.vy) * Math.min(1, dt * 8);

      // --- aiming & firing ----------------------------------------------
      if (target) {
        const want = U.angleTo(f.x, f.y, target.x, target.y);
        f.aim = U.turnToward(f.aim, want, dt * t.turn);
        const d = U.dist(f.x, f.y, target.x, target.y);
        const range = target instanceof W.Base ? S.baseRange : S.fireRange;
        if (d < range && Math.abs(U.angleDiff(f.aim, want)) < 0.18) {
          // squad upgrade tier -> a constant rate, immune to bot-sloppiness ramps
          f.rateMul = 1 / (1 + 0.1 * (game.squadUp ? game.squadUp.rate : 0));
          f.tryFire(world, f.aim, rng);
        }
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