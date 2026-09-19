/* WARS — central tuning. Every gameplay number lives here so we can iterate fast. */
(function (W) {
  'use strict';

  const CFG = W.Config = {
    // Fixed logical resolution. The canvas is letterboxed to the window, so the
    // visible slice of the world is always VIEW.W x VIEW.H world-units.
    VIEW: { W: 960, H: 540 },

    WORLD: {
      W: 2400, H: 1600,   // total arena size in world units
      PAD: 26,            // wall thickness used for movement clamping
      GRID_CELL: 140,     // broadphase cell size
      MAX_BULLETS: 900,
      MAX_PARTICLES: 700,
    },

    // Team ids
    TEAM: { PLAYER: 0, ENEMY: 1 },

    COLORS: {
      bg: '#0b1014',
      grid: '#141d24',
      gridMajor: '#1a262f',
      wall: '#22303a',
      teamPlayer: '#57c8ff',
      teamPlayerDim: '#2b6f96',
      teamEnemy: '#ff5f5f',
      teamEnemyDim: '#8f3535',
      base: '#8ea9bd',
      canopy: '#2f7d4f',
      canopyDark: '#215c3a',
      trunk: '#6b4a2b',
      fruit: '#ff7aa2',
      pickup: '#ffd166',
      bulletPlayer: '#c9f0ff',
      bulletEnemy: '#ffb0a0',
      hp: '#7ee787',
      hpLow: '#ffb020',
      text: '#dbe7ef',
      textDim: '#7f97a8',
      accent: '#ffd166',
    },

    PLAYER: {
      r: 14,
      speed: 232,
      accel: 2600,       // px/s^2 toward desired velocity (feels snappy but not instant)
      friction: 12,
      hp: 130,
      iframes: 0.55,     // invulnerable seconds after taking a hit
      respawn: 2.6,      // seconds to respawn at own base
      aimAssist: 0.22,   // radians of forgiveness when snapping to nearest target
      targetRange: 620,  // auto-aim search radius
      // Dash: a short burst with i-frames. This is the dodge that keeps a run
      // alive when the swarm closes in — Shift / B / left bumper.
      dashSpeed: 660,
      dashTime: 0.14,    // seconds of dash velocity before normal control returns
      dashCd: 0.62,      // seconds between dashes
      dashIframes: 0.22, // invulnerable seconds granted by the dash itself
      // Auto-fire is ON by default ("shoots automatically"). Toggle with F.
      autoFire: true,
    },

    BASE: {
      half: 46,          // half-size of the square bunker footprint
      hp: 1600,          // both bases (symmetric — the run is a base race)
      r: 62,             // collision radius (bullets + bodies)
      dmgTakenMul: 0.5,  // bases soak 50% of bullet damage: killing bots matters more
      regenIdle: 9,      // hp/s regained while no enemy is inside idleRange
      idleRange: 430,
      turretRange: 470,  // deliberately short: you can approach without being sniped
      turretRate: 0.9,
      turretBurst: 3,
      turretBurstGap: 0.1,
      turretDmg: 10,
      turretSpeed: 780,
      regen: 0,          // flat per-second base regen (0 = none; tuning knob)
    },

    BOT: {
      // Base stats; per-type overrides live in AI.TYPES.
      r: 13,
      hp: 34,
      speed: 118,
      fireRange: 420,
      preferredRange: 260,
      contactDmg: 7,
      contactCd: 0.9,
      iframes: 0.1,
      maxAlive: 16,      // absolute ceiling (the live cap ramps up to this)
      // Early-game forgiveness: bots are slower, sloppier and softer at t=0 and
      // tighten up as `difficulty` grows (see Director.difficulty / AI.update).
      earlyRateMul: 1.8,     // 1.8 = fires 80% slower than their card rate
      lateRateMul: 1.0,
      earlySpreadMul: 2.6,   // shotgun-tier aim at t=0
      lateSpreadMul: 1.25,   // ...and never outright precise
      earlyDmgMul: 0.5,
      lateDmgMul: 0.9,
    },

    TREE: {
      count: 74,
      canopyR: 30,       // base radius, scaled per-tree
      canopyRVar: 12,
      trunkR: 8,
      hp: 60,            // canopy HP; each bullet hit does its damage here too
      fruitMax: 3,
      fruitRegrow: 22,   // seconds per fruit regrown once picked clean
      dropChance: 0.18,  // chance a canopy hit knocks a fruit loose
      dropCd: 1.0,       // per-tree cooldown between drops (seconds)
      // Hard throttle: however much lead you pour into the treeline, fruit can
      // only appear at this rate and this deep (no apple oceans).
      dropPerSec: 2,     // global fruit-per-second cap
      maxOnGround: 10,   // total fruit allowed on the field at once
      blockMove: true,   // canopy blocks walking (tactical cover)
      blockBullet: true, // canopy eats bullets (also protects enemies behind it)
    },

    FRUIT: {
      r: 8,
      heal: 20,
      life: 18,          // despawn timer once dropped
      popSpeed: 150,     // initial scatter velocity
      settle: 6,         // ground friction factor
    },

    PICKUP: {
      life: 26,
      spawnEvery: 9,     // seconds between weapon crate spawns
      maxOnField: 4,
      duration: 20,      // seconds a picked-up weapon lasts (then back to pistol)
    },

    DIRECTOR: {
      // Escalating "bullet heaven" pressure curve. The opening is deliberately
      // sparse: ~8 enemies alive at t=0, creeping to the ceiling by ~4 minutes.
      startDelay: 6,
      aliveCapBase: 7,     // simultaneous enemies allowed at t=0
      aliveCapPerMin: 3.5, // +cap per minute of run
      aliveCapMax: 16,
      ringChance: 0.22,    // share of spawns dropping just off-camera (rest march from their base)
      ringChanceLate: 0.6, // ...rising to this after ~3 min
      waveEvery: 22,       // seconds between waves
      waveSizeBase: 2,
      waveSizeGrowth: 0.7,
      trickleEvery: 3.6,   // continuous spawns between waves
      trickleBase: 1,
      capSoft: 6,          // below this, trickle is doubled (catch-up, not pile-on)
      eliteEvery: 75,      // seconds between brute spawns
    },

    XP: {
      perKill: 1,
      perSecond: 0.5,    // passive drip so you always level a little (VS-style)
      perBaseHit: 0,
      levelBase: 6,      // xp needed for level 2 = levelBase * 1.6^(lvl-1)
      levelGrowth: 1.55,
      cards: 3,          // choices offered per level-up
    },

    DEBUG: { showHitboxes: false, showGrid: false },
  };

  // Small derived constants (kept out of the tunables above).
  CFG.DERIVED = {
    viewAspect: CFG.VIEW.W / CFG.VIEW.H,
  };
})(window.WARS || (window.WARS = {}));