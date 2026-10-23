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
      MAX_BULLETS: 1200,
      MAX_PARTICLES: 1000,
      MAX_GORE: 130,       // blood/splatter decals on the ground at once
      MAX_SCORCH: 70,      // bullet-scorch dots at once
      MAX_CORPSES: 24,     // bodies lying on the field before they fade away
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
      canopyLight: '#46a06b',
      trunk: '#6b4a2b',
      apple: '#d94a33',
      fruit: '#ff7aa2',
      pickup: '#ffd166',
      bulletPlayer: '#c9f0ff',
      bulletEnemy: '#ffb0a0',
      hp: '#7ee787',
      hpLow: '#ffb020',
      text: '#dbe7ef',
      textDim: '#7f97a8',
      accent: '#ffd166',
      // Violence palette (see GORE + entities).
      bloodEnemy: '#8a2020',
      bloodPlayer: '#c2453a',
      bloodDark: '#4d1210',
      scorch: '#100d0b',
      leaf: '#3f8f52',
      smoke: '#797f85',
      fire: '#ff9a3d',
    },

    /* ------------------------------------------------------ difficulty ---- */
    /* Every multiplier is applied ON TOP of the base numbers in the table
       below, so `hard` is close to the classic curve and the others fan out
       from it. Pick a mode on the title screen (arrows or 1-5); it is saved.
       Your squad (soldiers, later tanks) fights beside you on every mode, so
       the higher modes are a swarm problem, not a numbers problem. */
    MODES: {
      easy: {
        label: 'EASY',   desc: 'Sparse and soft. The carnage is for the atmosphere.',
        diff: 0.7,   // time-curve scale: how fast the pressure escalates
        spawn: 0.6,   // how fast waves/trickles arrive
        cap: 0.55,    // simultaneous enemies allowed
        botDmg: 0.5,  // damage bots deal (to you, your base, each other)
        botRate: 1.9, // their fire-rate cooldown multiplier (higher = slower)
        botHp: 0.55,  // bot hit points
        botSpeed: 0.9, // bot move speed
        playerSpeed: 1.05,
        elite: 1.8,   // elite interval multiplier (higher = rarer)
        eliteHp: 0.7,
        baseDmg: 0.4, // how much damage both bases soak
        playerHp: 40, // flat HP bonus on your spawn
        xp: 1.5,      // XP multiplier (levels come faster)
        ring: 0.7,    // share of spawns dropping in off-camera
        violence: 0.7, // shake / gore / sound intensity
      },
      medium: {
        label: 'MEDIUM', desc: 'The balanced brawl — your squad carries its weight here.',
        diff: 0.8, spawn: 0.85, cap: 0.7, botDmg: 0.6, botRate: 1.5, botHp: 0.7,
        botSpeed: 0.95, playerSpeed: 1.03,
        elite: 1.5, eliteHp: 0.85, baseDmg: 0.4, playerHp: 20, xp: 1.15, ring: 0.85, violence: 1.0,
      },
      hard: {
        label: 'HARD',   desc: 'Close to the classic curve. Keep your squad alive.',
        diff: 0.95, spawn: 0.9, cap: 0.9, botDmg: 0.85, botRate: 1.1, botHp: 0.9,
        botSpeed: 1.0, playerSpeed: 1.0,
        elite: 1.2, eliteHp: 1.0, baseDmg: 0.45, playerHp: 5, xp: 1.0, ring: 1.0, violence: 1.2,
      },
      harder: {
        label: 'HARDER', desc: 'The swarm wants you dead. Your squad holds the line.',
        diff: 1.25, spawn: 1.2, cap: 1.1, botDmg: 1.05, botRate: 1.0, botHp: 1.05,
        botSpeed: 1.03, playerSpeed: 0.97,
        elite: 0.8, eliteHp: 1.5, baseDmg: 0.6, playerHp: -15, xp: 0.6, ring: 1.3, violence: 1.4,
      },
      hacker: {
        label: 'HACKER', desc: 'Precise, fast, inescapable. Only you and your tanks between it and your base.',
        diff: 1.7, spawn: 1.7, cap: 1.3, botDmg: 1.5, botRate: 0.7, botHp: 1.3,
        botSpeed: 1.08, playerSpeed: 0.92,
        elite: 0.5, eliteHp: 2.2, baseDmg: 0.8, playerHp: -30, xp: 0.45, ring: 1.7, violence: 1.8,
      },
    },
    MODE_ORDER: ['easy', 'medium', 'hard', 'harder', 'hacker'],
    MODE_DEFAULT: 'medium',

    /* --------------------------------------------------------- controls -- */
    /* Control scheme, picked on the title screen (click or C); it is saved.
       keys:  WASD/arrows move, mouse (or auto-aim) aims.
       mouse: left-click a spot to walk there, hold left-click to keep
              guiding; movement is mouse-driven and the gun auto-aims. */
    CONTROLS: [
      { id: 'keys',  label: 'KEYBOARD', desc: 'WASD moves · mouse aims, auto-aim when idle' },
      { id: 'mouse', label: 'MOUSE',    desc: 'Click to move there · hold to guide · gun auto-aims' },
    ],
    CONTROL_DEFAULT: 'keys',

    /* ------------------------------------------------------- levels/maps -- */
    /* Five arena layouts, picked per run (seeded). Same arena size, different
       tree geometry — scatter / ring / lanes / forest / quarters. */
    LEVELS: [
      { id: 'meadow',   name: 'MEADOW FLATS', pattern: 'scatter',  trees: 74,  desc: 'Open ground, scattered cover.' },
      { id: 'hollow',   name: 'THE HOLLOW',   pattern: 'ring',     trees: 80,  desc: 'A wall of trees around the center.' },
      { id: 'lances',   name: 'KILL LANCES',  pattern: 'lanes',    trees: 86,  desc: 'Rows of cover, lanes between.' },
      { id: 'forest',   name: 'DEEP FOREST',  pattern: 'forest',   trees: 112, desc: 'Dense center woods, open flanks.' },
      { id: 'quarters', name: 'FOUR WARDS',   pattern: 'quarters', trees: 98,  desc: 'Four tree blocks, cross corridors.' },
    ],

    /* ----------------------------------------------------------- squad ---- */
    /* Your soldiers: deployed at start, follow in formation, auto-engage.
       Level-up cards upgrade the whole squad (and can recruit more). */
    SQUAD: {
      start: 2,         // soldiers beside you when the run starts
      max: 5,           // Reinforcements can grow the squad to this
      respawn: 8,       // seconds until a downed soldier returns to the fight
      formationR: 52,   // orbit radius around you
      fireRange: 480,   // they open fire on enemies out to here
      baseRange: 950,   // ...and will chip the enemy base when it is this close
    },

    /* ------------------------------------------------------------ tank ---- */
    /* Deployed by a level-up card (level gate). A slow armored hull with a
       tracking turret; advances on the enemy base and holds the line. */
    TANK: {
      hp: 1100,
      r: 30,
      speed: 62,
      turretRange: 660,
      turretTurn: 2.2,
      shellRate: 1.5,    // seconds between shells
      shellDmg: 34,
      shellSpeed: 640,
      shellR: 7,
      splash: 55,
      max: 2,
      unlockLevel: 4,    // card is only offered from this level on
      holdRange: 430,    // stop advancing this far from the enemy base
    },

    /* ------------------------------------------------------------ audio --- */
    AUDIO: {
      master: 0.9,     // master volume (0..1) — was 0.5; the mix was too quiet
      sfx: 0.95,       // SFX bus
      music: 0.3,      // music bus (kept under SFX so shots still pop)
      wind: 0.1,       // ambient wind bed
      panRange: 900,   // world-px over which a sound fully pans L->R
      atten: 2400,     // distance attenuation scale for world sounds
    },

    PLAYER: {
      r: 14,
      speed: 232,
      accel: 2600,       // px/s^2 toward desired velocity (feels snappy but not instant)
      friction: 12,
      hp: 130,          // base value; difficulty modes add MODES[*].playerHp on top
      iframes: 0.55,     // invulnerable seconds after taking a hit
      respawn: 2.6,      // seconds to respawn at own base
      aimAssist: 0.22,   // radians of forgiveness when snapping to nearest target
      autoAimSnapDeg: 10, // auto-aim only snaps to a target within +/- this many
                          // degrees of the current aim line (no cross-screen yanks)
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
      dmgTakenMul: 0.5,  // classic value; the difficulty mode overrides it at reset
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
      maxAlive: 24,      // absolute ceiling; the live cap ramps toward it, scaled by the mode
      // Early-game forgiveness: bots are slower, sloppier and softer at t=0 and
      // tighten up as `difficulty` grows (see Director.difficulty / AI.update).
      earlyRateMul: 1.8,     // 1.8 = fires 80% slower than their card rate
      lateRateMul: 1.0,
      earlySpreadMul: 2.6,   // shotgun-tier aim at t=0
      lateSpreadMul: 1.25,   // ...and never outright precise
      earlyDmgMul: 0.5,
      lateDmgMul: 0.9,
    },

    /* ---------------------------------------------------------- violence -- */
    /* Blood, gore, scorch and bodies. All purely cosmetic — the numbers only
       cap how much of it the screen can hold before the oldest fades. */
    GORE: {
      decalLife: 26,    // seconds a blood stain soaks into the ground
      decalFade: 8,     // ...then this many seconds to fade out
      corpseLife: 7,    // seconds a body lies there before it fades
      chunkMin: 3,      // torn-off chunks per kill
      chunkMax: 7,
      dripMin: 4,       // fast blood droplets per kill
      dripMax: 9,
    },

    TREE: {
      count: 74,
      canopyR: 30,       // base radius, scaled per-tree
      canopyRVar: 12,
      trunkR: 8,
      hp: 60,            // canopy HP; each bullet hit does its damage here too
      fruitMax: 3,
      fruitRegrow: 30,   // seconds per fruit regrown once picked clean (slow)
      dropChance: 0.12,  // chance a canopy hit knocks a fruit loose (lowered —
                         // fruit is scarce now, so each one you land matters)
      dropCd: 1.5,       // per-tree cooldown between drops (seconds)
      // Hard throttle: however much lead you pour into the treeline, fruit can
      // only appear at this rate and this deep (no apple oceans).
      dropPerSec: 1,     // global fruit-per-second cap (was 2 — half the apples)
      maxOnGround: 7,    // total fruit allowed on the field at once (was 10)
      blockMove: true,   // canopy blocks walking (tactical cover)
      blockBullet: true, // canopy eats bullets (also protects enemies behind it)
    },

    FRUIT: {
      r: 8,
      heal: 30,          // scarcer, but juicier: each apple is worth more
      life: 15,          // despawn timer once dropped
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
      startDelay: 4.5,
      aliveCapBase: 7,     // simultaneous enemies allowed at t=0
      aliveCapPerMin: 3.5, // +cap per minute of run
      aliveCapMax: 16,
      ringChance: 0.22,    // share of spawns dropping just off-camera (rest march from their base)
      ringChanceLate: 0.6, // ...rising to this after ~3 min
      waveEvery: 18,       // seconds between waves (divided by the mode's spawn rate)
      waveSizeBase: 2,
      waveSizeGrowth: 0.7,
      trickleEvery: 3.6,   // continuous spawns between waves
      trickleBase: 1,
      capSoft: 6,          // below this, trickle is doubled (catch-up, not pile-on)
      eliteEvery: 75,      // seconds between brute spawns (multiplied by the mode's elite rate)
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