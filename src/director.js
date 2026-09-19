/* WARS — the "bullet heaven" pressure curve: waves, trickles, elites, crates.
   Pure spawn logic + difficulty ramp; no drawing, no input. */
(function (W) {
  'use strict';
  const U = W.Util;
  const CFG = W.Config;
  const T = CFG.TEAM;

  class Director {
    constructor(game) {
      this.game = game;
      this.reset();
    }

    reset() {
      this.time = 0;
      this.wave = 0;
      this.waveT = CFG.DIRECTOR.startDelay;
      this.trickleT = CFG.DIRECTOR.startDelay * 0.5;
      this.eliteT = CFG.DIRECTOR.eliteEvery;
      this.crateT = CFG.PICKUP.spawnEvery * 0.6;
      this.spawned = 0;
      this.kills = 0;
    }

    /** Global difficulty scalar: 1.0 at t=0, ~2.0 at 2min, ~3.0 at 4min. */
    get difficulty() { return 1 + this.time / 120; }

    /** How many enemies we allow on the field right now — the real pressure knob. */
    get aliveCap() {
      const D = CFG.DIRECTOR;
      return Math.min(D.aliveCapMax, D.aliveCapBase + (this.time / 60) * D.aliveCapPerMin);
    }

    /** Early on enemies march from their base where you can see them coming; later
        they also drop in just off-camera, which is the bullet-heaven half. */
    get ringChance() {
      const D = CFG.DIRECTOR;
      return U.clamp(D.ringChance + (this.time / 180) * (D.ringChanceLate - D.ringChance), D.ringChance, D.ringChanceLate);
    }

    /** Type pool unlocks over time so the first 20s feel learnable. */
    pickType(rng) {
      const t = this.time;
      const pool = [['grunt', 10]];
      if (t > 25) pool.push(['runner', 5]);
      if (t > 50) pool.push(['gunner', 5]);
      if (t > 85) pool.push(['sniper', 3]);
      return rng.weighted(pool);
    }

    spawnPoint(world) {
      const rng = world.rng;
      const cam = this.game.camera;
      if (rng.chance(this.ringChance) && this.game.player && !this.game.player.dead) {
        const cx = cam.x + cam.w / 2, cy = cam.y + cam.h / 2;
        const rad = Math.hypot(cam.w, cam.h) * 0.55 + rng.range(20, 120);
        const a = rng.angle();
        return world.openSpot(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, 80, 14);
      }
      const b = world.enemyBase;
      const a = rng.range(Math.PI * 0.15, Math.PI * 0.95) + Math.PI; // lower-left hemisphere
      // Spawn well clear of their own bunker: no body-wall on top of it.
      const dist = rng.range(b.r + 150, b.r + 340);
      return world.openSpot(b.x + Math.cos(a) * dist, b.y + Math.sin(a) * dist, 60, 16);
    }

    spawnBot(type, opts) {
      const world = this.game.world;
      const alive = world.fighters.reduce((n, f) => n + (!f.dead && !f.isPlayer ? 1 : 0), 0);
      if (alive >= Math.floor(this.aliveCap) || alive >= CFG.BOT.maxAlive) return null;
      const p = this.spawnPoint(world);
      const cfg = W.AI.spawnConfig(type || this.pickType(world.rng), p.x, p.y, T.ENEMY, this.difficulty);
      const f = world.addFighter(cfg);
      if (opts && opts.elite) {
        f.maxHp *= 2.2; f.hp = f.maxHp; f.r *= 1.25; f.xpValue *= 3;
        f.type = 'brute';
      }
      this.spawned++;
      // spawn poof
      world.burst(f.x, f.y, 8, { color: CFG.COLORS.teamEnemy, spMin: 30, spMax: 150, lifeMin: .15, lifeMax: .4 });
      return f;
    }

    update(dt) {
      const world = this.game.world;
      const rng = world.rng;
      this.time += dt;
      world.difficulty = this.difficulty;   // read by AI / world for gentle early scaling

      const alive = world.fighters.reduce((n, f) => n + (!f.dead && !f.isPlayer ? 1 : 0), 0);

      // --- waves: a burst of bots all at once ---------------------------
      this.waveT -= dt;
      if (this.waveT <= 0) {
        this.wave++;
        this.waveT = Math.max(9, CFG.DIRECTOR.waveEvery - this.time * 0.02);
        const n = Math.round(CFG.DIRECTOR.waveSizeBase + this.wave * CFG.DIRECTOR.waveSizeGrowth);
        for (let i = 0; i < n; i++) this.spawnBot();
        this.game.ui?.flashBanner?.('WAVE ' + this.wave, CFG.COLORS.teamEnemy);
      }

      // --- trickle: keeps pressure on between waves ---------------------
      this.trickleT -= dt;
      if (this.trickleT <= 0) {
        // Only rush the player when the arena has already been cleared, so the
        // field never piles up beyond the aliveCap ramp.
        const boost = alive < CFG.DIRECTOR.capSoft ? 2 : 1;
        this.trickleT = Math.max(0.8, CFG.DIRECTOR.trickleEvery / (boost * (1 + this.time / 240)));
        const count = CFG.DIRECTOR.trickleBase + Math.floor(this.time / 120);
        for (let i = 0; i < count; i++) this.spawnBot();
      }

      // --- elites -------------------------------------------------------
      this.eliteT -= dt;
      if (this.eliteT <= 0) {
        this.eliteT = CFG.DIRECTOR.eliteEvery;
        this.spawnBot('brute', { elite: true });
        this.game.ui?.flashBanner?.('ELITE INBOUND', '#ffb066');
      }

      // --- weapon crates ------------------------------------------------
      this.crateT -= dt;
      if (this.crateT <= 0) {
        this.crateT = CFG.PICKUP.spawnEvery;
        if (world.pickups.length < CFG.PICKUP.maxOnField) {
          // Prefer mid-map so grabbing one is a real risk/reward choice.
          const cx = U.lerp(world.playerBase.x, world.enemyBase.x, rng.range(0.32, 0.78));
          const cy = U.lerp(world.playerBase.y, world.enemyBase.y, rng.range(0.32, 0.78));
          const p = world.openSpot(cx, cy, 240, 20);
          world.addPickup(p.x, p.y, rng.pick(W.Weapons.PICKUPS));
        }
      }
    }
  }

  W.Director = Director;
})(window.WARS || (window.WARS = {}));