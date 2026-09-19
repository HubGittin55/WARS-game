/* WARS — entity types. Each owns its own draw(); physics/collisions live in world.js. */
(function (W) {
  'use strict';
  const U = W.Util;
  const CFG = W.Config;
  const C = CFG.COLORS;

  /* -------------------------------------------------------------- Bullet ---- */
  class Bullet {
    constructor(o) {
      this.x = o.x; this.y = o.y;
      this.vx = o.vx; this.vy = o.vy;
      this.dmg = o.dmg; this.r = o.r || 3;
      this.life = o.life || 1; this.maxLife = this.life;
      this.team = o.team;
      this.pierce = o.pierce || 0;
      this.splash = o.splash || 0;
      this.knock = o.knock || 0;
      this.color = o.color || C.bulletPlayer;
      this.kind = o.kind || 'pistol';
      this.dead = false;
      this.counted = false;          // has this round already scored an accuracy hit
      this.hits = null;              // lazily-created set for pierce bookkeeping
      this.px = o.x; this.py = o.y;  // previous pos -> motion trail
    }
    update(dt) {
      this.px = this.x; this.py = this.y;
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.life -= dt;
      if (this.life <= 0) this.dead = true;
    }
    draw(ctx) {
      const len = this.kind === 'laser' ? 3.2 : 2.2;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.r * 2;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(this.px, this.py);
      ctx.lineTo(this.px + (this.x - this.px) * len, this.py + (this.y - this.py) * len);
      ctx.stroke();
      if (this.kind === 'rocket') {
        ctx.fillStyle = '#fff2c2';
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r * 0.7, 0, U.TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* -------------------------------------------------------------- Fighter --- */
  class Fighter {
    constructor(o) {
      const P = CFG.PLAYER, B = CFG.BOT;
      this.team = o.team;
      this.isPlayer = !!o.isPlayer;
      this.type = o.type || (this.isPlayer ? 'player' : 'grunt');
      this.label = o.label || (this.isPlayer ? 'YOU' : o.type || 'BOT');

      this.x = o.x; this.y = o.y;
      this.vx = 0; this.vy = 0;
      this.r = o.r || (this.isPlayer ? P.r : B.r);
      this.maxHp = o.hp || (this.isPlayer ? P.hp : B.hp);
      this.hp = this.maxHp;
      this.baseSpeed = o.speed || (this.isPlayer ? P.speed : B.speed);
      this.speedMul = 1;

      // weapon state
      this.weaponId = o.weaponId || 'pistol';
      this.weaponTime = o.weaponTime || 0;   // >0 = timed powerup remaining
      this.cd = 0;
      this.dashCd = 0;
      this.dashT = 0;

      // per-level stat multipliers (see upgrades.js)
      this.dmgMul = 1; this.rateMul = 1; this.lifeMul = 1;
      this.pierceBonus = 0; this.pelletBonus = 0;
      this.magnet = this.isPlayer ? 1 : 0;
      this.armor = 0;
      this.aimRange = this.isPlayer ? P.targetRange : B.fireRange;
      this.stacks = {};

      this.iframes = 0;
      this.contactCd = 0;
      this.aim = o.aim || 0;
      this.dead = false;
      this.flash = 0;
      this.walkPhase = Math.random() * 10;
      this.spawnGuard = o.spawnGuard || (this.isPlayer ? 1.2 : 0.6);

      // AI scratchpad (see ai.js)
      this.ai = { target: null, strafe: U.sign(Math.random() - 0.5) || 1, strafeT: 0, retarget: 0, lostT: 0 };
      this.xpValue = o.xpValue || 1;
      this.dmgTakenDealt = 0;
    }

    get weapon() { return W.Weapons.get(this.weaponId); }
    get alive() { return !this.dead; }

    recompute() { /* hook for subclasses / future stat re-derivation */ }

    giveWeapon(id, seconds) {
      this.weaponId = id;
      this.weaponTime = seconds;
    }

    /** Tick timers that are not movement. Movement is written by the controller/AI. */
    update(dt, world) {
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.vx *= Math.exp(-6 * dt); this.vy *= Math.exp(-6 * dt); // knockback decay
      this.cd = Math.max(0, this.cd - dt);
      this.dashCd = Math.max(0, this.dashCd - dt);
      this.dashT = Math.max(0, this.dashT - dt);
      this.iframes = Math.max(0, this.iframes - dt);
      this.spawnGuard = Math.max(0, this.spawnGuard - dt);
      this.contactCd = Math.max(0, this.contactCd - dt);
      this.flash = Math.max(0, this.flash - dt * 5);
      if (this.weaponTime > 0) {
        this.weaponTime -= dt;
        if (this.weaponTime <= 0) { this.weaponTime = 0; this.weaponId = 'pistol'; }
      }
      const sp = Math.hypot(this.vx, this.vy);
      this.walkPhase += dt * (2 + sp * 0.05);
    }

    /** Burst of speed + a moment of invulnerability. Player only, but harmless
        for bots to call. Returns false when the dash is still recharging. */
    tryDash(dx, dy, world) {
      if (this.dead || this.dashCd > 0) return false;
      const m = Math.hypot(dx, dy);
      if (m < 0.001) { dx = Math.cos(this.aim); dy = Math.sin(this.aim); }
      else { dx /= m; dy /= m; }
      this.dashCd = CFG.PLAYER.dashCd;
      this.dashT = CFG.PLAYER.dashTime;
      this.iframes = Math.max(this.iframes, CFG.PLAYER.dashIframes);
      this.vx = dx * CFG.PLAYER.dashSpeed;
      this.vy = dy * CFG.PLAYER.dashSpeed;
      world?.burst(this.x, this.y, 8, { color: CFG.COLORS.accent, spMin: 60, spMax: 220, lifeMin: .12, lifeMax: .3, rMin: 1.5, rMax: 3.5 });
      return true;
    }

    hurt(dmg, world, srcTeam) {
      if (this.dead || this.iframes > 0 || this.spawnGuard > 0) return 0;
      const real = dmg * (1 - this.armor);
      this.hp -= real;
      this.iframes = this.isPlayer ? CFG.PLAYER.iframes : CFG.BOT.iframes;
      this.flash = 1;
      if (this.hp <= 0) { this.hp = 0; this.dead = true; world.onKill?.(this, srcTeam); }
      else world.onHit?.(this, real, srcTeam);
      return real;
    }

    /** Try to discharge the current weapon at `angle`. Returns true if it fired. */
    tryFire(world, angle, rng) {
      if (this.dead || this.cd > 0 || this.spawnGuard > 0) return false;
      const w = this.weapon;
      const cd = Math.max(0.02, w.rate * this.rateMul);
      this.cd = cd;
      const pellets = w.pellets + (this.isPlayer ? this.pelletBonus : 0);
      const shot = Object.assign({}, w, {
        pellets,
        pierce: w.pierce + (this.isPlayer ? this.pierceBonus : 0),
        life: w.life * (this.isPlayer ? this.lifeMul : 1),
        // Bots are deliberately sloppy early on (see AI.update).
        spread: w.spread * (this.isPlayer ? 1 : (this.botSpreadMul || 1)),
      });
      const dmgMul = this.isPlayer ? this.dmgMul : (this.botDmgMul === undefined ? 1 : this.botDmgMul);
      const out = W.Weapons.fire(world, shot, this.x, this.y, angle, this.team, dmgMul, rng);
      if (this.isPlayer) {
        world.stats.shots += pellets;
        for (const b of out) b.fromPlayer = true;   // accuracy is *your* trigger discipline
      }
      world.onShot?.(this, w);
      // muzzle flash particle
      world.addParticle(this.x + Math.cos(angle) * 16, this.y + Math.sin(angle) * 16, {
        vx: Math.cos(angle) * 40, vy: Math.sin(angle) * 40, life: 0.09, r: 5, color: '#fff6cc', glow: true,
      });
      return true;
    }

    draw(ctx, game) {
      const isP = this.team === CFG.TEAM.PLAYER;
      const body = isP ? C.teamPlayer : C.teamEnemy;
      const dim = isP ? C.teamPlayerDim : C.teamEnemyDim;
      const bob = Math.sin(this.walkPhase) * 1.6;

      // shadow
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.ellipse(this.x + 2, this.y + 5, this.r * 0.95, this.r * 0.6, 0, 0, U.TAU); ctx.fill();

      // body
      ctx.save();
      ctx.translate(this.x, this.y + bob * 0.3);
      ctx.rotate(this.aim);
      // gun barrel
      ctx.fillStyle = '#2b3944';
      ctx.fillRect(this.r * 0.4, -2.6, this.r * 1.25, 5.2);
      ctx.fillStyle = this.flash > 0.4 ? '#fff3b0' : '#4a5c6b';
      ctx.fillRect(this.r * 1.4, -3.4, 4, 6.8);
      ctx.restore();

      ctx.beginPath();
      ctx.arc(this.x, this.y + bob * 0.3, this.r, 0, U.TAU);
      ctx.fillStyle = this.flash > 0.25 ? '#ffffff' : body;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = dim;
      ctx.stroke();

      // inner dot / facing pip
      ctx.beginPath();
      ctx.arc(this.x + Math.cos(this.aim) * this.r * 0.42, this.y + Math.sin(this.aim) * this.r * 0.42 + bob * 0.3, this.r * 0.32, 0, U.TAU);
      ctx.fillStyle = dim; ctx.fill();

      if (this.spawnGuard > 0 || this.iframes > 0) {
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(this.spawnGuard * 30);
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 5, 0, U.TAU);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // hp bar (skip for player: it lives in the HUD)
      if (!this.isPlayer && this.hp < this.maxHp) {
        const w = this.r * 2.2, h = 3;
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(this.x - w / 2, this.y - this.r - 9, w, h);
        const f = this.hp / this.maxHp;
        ctx.fillStyle = f > 0.4 ? C.hp : C.hpLow;
        ctx.fillRect(this.x - w / 2, this.y - this.r - 9, w * f, h);
      }
    }
  }

  /* ---------------------------------------------------------------- Base ---- */
  class Base {
    constructor(o) {
      this.team = o.team;
      this.x = o.x; this.y = o.y;
      this.half = CFG.BASE.half;
      this.r = CFG.BASE.r;
      this.maxHp = o.hp || CFG.BASE.hp;
      this.hp = this.maxHp;
      this.rateMul = 1;
      this.cd = 0.6;
      this.burst = 0;
      this.burstCd = 0;
      this.turretAim = o.team === CFG.TEAM.PLAYER ? -Math.PI / 2 : Math.PI / 2;
      this.dead = false;
      this.flash = 0;
      this.pulse = Math.random() * 6;
    }
    get alive() { return this.hp > 0; }

    hurt(dmg, world, srcTeam) {
      if (this.dead) return 0;
      const real = dmg * CFG.BASE.dmgTakenMul;
      this.hp -= real; this.flash = 1;
      if (this.hp <= 0) { this.hp = 0; this.dead = true; world.onBaseDestroyed?.(this, srcTeam); }
      else world.onBaseHit?.(this, real, srcTeam);
      return real;
    }

    update(dt, world, game) {
      this.pulse += dt;
      this.flash = Math.max(0, this.flash - dt * 4);
      this.hp = Math.min(this.maxHp, this.hp + CFG.BASE.regen * dt);
      // Repair only when the bunker is not in contact — rewards clearing your patch.
      if (this.hp < this.maxHp && !world.nearestEnemy(this, this.team, CFG.BASE.idleRange)) {
        this.hp = Math.min(this.maxHp, this.hp + CFG.BASE.regenIdle * dt);
        this.repairFx = (this.repairFx || 0) + dt;
        if (this.repairFx > 0.5) { this.repairFx = 0; world.addParticle(this.x + (Math.random() - .5) * 60, this.y + (Math.random() - .5) * 60, { life: .5, r: 3, color: CFG.COLORS.hp, glow: true, vy: -30 }); }
      }
      const foe = world.nearestEnemy(this, this.team, CFG.BASE.turretRange);
      if (!foe) { this.burst = 0; return; }
      const want = U.angleTo(this.x, this.y, foe.x, foe.y);
      this.turretAim = U.turnToward(this.turretAim, want, dt * 3.4);
      this.cd -= dt;
      if (this.burst > 0) {
        this.burstCd -= dt;
        if (this.burstCd <= 0 && Math.abs(U.angleDiff(this.turretAim, want)) < 0.22) {
          this.burstCd = CFG.BASE.turretBurstGap;
          this.burst--;
          const tx = this.x + Math.cos(this.turretAim) * (this.r + 6);
          const ty = this.y + Math.sin(this.turretAim) * (this.r + 6);
          world.addBullet({
            x: tx, y: ty,
            vx: Math.cos(this.turretAim) * CFG.BASE.turretSpeed,
            vy: Math.sin(this.turretAim) * CFG.BASE.turretSpeed,
            dmg: CFG.BASE.turretDmg, r: 3.4, life: CFG.BASE.turretRange / CFG.BASE.turretSpeed + 0.1,
            team: this.team, color: this.team === CFG.TEAM.PLAYER ? C.bulletPlayer : C.bulletEnemy,
            kind: 'turret', knock: 10,
          });
          world.onShot?.({ x: tx, y: ty, team: this.team, isBase: true }, { sound: 'shootSmg' });
        }
        return;
      }
      if (this.cd <= 0 && Math.abs(U.angleDiff(this.turretAim, want)) < 0.2) {
        this.cd = CFG.BASE.turretRate * this.rateMul;
        this.burst = CFG.BASE.turretBurst;
        this.burstCd = 0;
      }
    }

    draw(ctx) {
      const isP = this.team === CFG.TEAM.PLAYER;
      const h = this.half;
      const col = this.flash > 0.2 ? '#ffffff' : (isP ? C.teamPlayer : C.teamEnemy);
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fillRect(this.x - h + 4, this.y - h + 6, h * 2, h * 2);

      ctx.fillStyle = C.wall;
      ctx.fillRect(this.x - h, this.y - h, h * 2, h * 2);
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.strokeRect(this.x - h, this.y - h, h * 2, h * 2);

      // inner core, pulses
      const p = 0.5 + 0.5 * Math.sin(this.pulse * 2);
      ctx.fillStyle = col; ctx.globalAlpha = 0.25 + p * 0.35;
      ctx.fillRect(this.x - h * 0.5, this.y - h * 0.5, h, h);
      ctx.globalAlpha = 1;

      // turret
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.turretAim);
      ctx.fillStyle = '#33454f';
      ctx.fillRect(0, -6, this.r + 4, 12);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, U.TAU); ctx.fill();
      ctx.restore();

      // hp bar
      const w = h * 2.4, f = this.hp / this.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(this.x - w / 2, this.y - h - 18, w, 7);
      ctx.fillStyle = f > 0.35 ? (isP ? C.hp : C.teamEnemy) : C.hpLow;
      ctx.fillRect(this.x - w / 2, this.y - h - 18, w * f, 7);
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1;
      ctx.strokeRect(this.x - w / 2, this.y - h - 18, w, 7);
    }
  }

  /* ---------------------------------------------------------------- Tree ---- */
  class Tree {
    constructor(o) {
      this.x = o.x; this.y = o.y;
      this.r = o.r || CFG.TREE.canopyR;
      this.trunkR = CFG.TREE.trunkR;
      this.maxHp = CFG.TREE.hp; this.hp = this.maxHp;
      this.fruitMax = o.fruitMax || CFG.TREE.fruitMax;
      this.fruit = o.fruit !== undefined ? o.fruit : this.fruitMax;
      this.regrow = 0;
      this.dropT = 0;          // per-tree fruit cooldown
      this.sway = Math.random() * 10;
      this.flash = 0;
      this.seed = Math.random();
      this.dead = false;
    }
    get blocksMove() { return CFG.TREE.blockMove && !this.dead; }
    get blocksBullet() { return CFG.TREE.blockBullet && !this.dead; }

    /** A bullet smacked the canopy: take damage, maybe drop a fruit. */
    hit(dmg, world, rng) {
      if (this.dead) return;
      this.hp -= dmg; this.flash = 1;
      const unlucky = this.dropT <= 0 && this.fruit > 0 && (rng.next() < CFG.TREE.dropChance || this.hp <= 0);
      if (unlucky && this.dropFruit(world, rng)) this.dropT = CFG.TREE.dropCd;
      if (this.hp <= 0) {
        // A felled tree gives up one last fruit at most — the rest is bruised.
        this.dropFruit(world, rng);
        this.dead = true;
        this.hp = 0;
        world.onTreeDestroyed?.(this);
      }
    }
    dropFruit(world, rng) {
      if (this.fruit <= 0 || !world.fruitAllowed()) return null;
      this.fruit--;
      const a = rng.angle();
      return world.addFruit(this.x + Math.cos(a) * this.r * 0.6, this.y + Math.sin(a) * this.r * 0.6, a, rng);
    }
    update(dt) {
      this.sway += dt;
      this.dropT = Math.max(0, this.dropT - dt);
      this.flash = Math.max(0, this.flash - dt * 3);
      if (this.dead) {
        this.reviveT = (this.reviveT || CFG.TREE.fruitRegrow * 1.5) - dt;
        if (this.reviveT <= 0) { this.dead = false; this.hp = this.maxHp; this.fruit = this.fruitMax; }
        return;
      }
      if (this.fruit < this.fruitMax) {
        this.regrow += dt;
        if (this.regrow >= CFG.TREE.fruitRegrow) { this.regrow = 0; this.fruit++; }
      }
    }
    draw(ctx) {
      const s = Math.sin(this.sway * 1.1 + this.seed) * 2.2;
      const r = this.r * (this.dead ? 0.55 : 1);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,.32)';
      ctx.beginPath(); ctx.ellipse(this.x + 4, this.y + 7, r * 0.95, r * 0.6, 0, 0, U.TAU); ctx.fill();
      // trunk
      ctx.fillStyle = C.trunk;
      ctx.fillRect(this.x - this.trunkR * 0.5, this.y - 2, this.trunkR, this.trunkR * 1.6);
      // canopy: three lobes
      const green = this.dead ? '#3a4a3f' : (this.flash > 0.3 ? '#baffd0' : C.canopy);
      const dark = this.dead ? '#2a3630' : C.canopyDark;
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(this.x - r * 0.45 + s, this.y + r * 0.15, r * 0.62, 0, U.TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(this.x + r * 0.45 + s, this.y + r * 0.1, r * 0.6, 0, U.TAU); ctx.fill();
      ctx.fillStyle = green;
      ctx.beginPath(); ctx.arc(this.x + s, this.y - r * 0.18, r * 0.72, 0, U.TAU); ctx.fill();
      // fruit dots
      if (this.fruit > 0 && !this.dead) {
        ctx.fillStyle = C.fruit;
        for (let i = 0; i < this.fruit; i++) {
          const a = this.seed * 6 + i * (U.TAU / this.fruitMax) + this.sway * 0.05;
          ctx.beginPath();
          ctx.arc(this.x + Math.cos(a) * r * 0.62 + s, this.y + Math.sin(a) * r * 0.5 - r * 0.1, 3.2, 0, U.TAU);
          ctx.fill();
        }
      }
    }
  }

  /* --------------------------------------------------------------- Fruit ---- */
  class Fruit {
    constructor(o) {
      this.x = o.x; this.y = o.y;
      this.vx = o.vx || 0; this.vy = o.vy || 0;
      this.r = CFG.FRUIT.r;
      this.heal = CFG.FRUIT.heal;
      this.life = CFG.FRUIT.life;
      this.bob = Math.random() * 6;
      this.dead = false;
    }
    update(dt) {
      this.x += this.vx * dt; this.y += this.vy * dt;
      const f = Math.exp(-CFG.FRUIT.settle * dt);
      this.vx *= f; this.vy *= f;
      this.bob += dt * 3;
      this.life -= dt;
      if (this.life <= 0) this.dead = true;
    }
    draw(ctx) {
      const fade = this.life < 3 ? (0.35 + 0.65 * Math.abs(Math.sin(this.life * 8))) : 1;
      const y = this.y + Math.sin(this.bob) * 1.5;
      ctx.globalAlpha = fade;
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(this.x + 2, this.y + 4, this.r * 0.8, this.r * 0.45, 0, 0, U.TAU); ctx.fill();
      ctx.fillStyle = C.fruit;
      ctx.beginPath(); ctx.arc(this.x, y, this.r, 0, U.TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.beginPath(); ctx.arc(this.x - 2.4, y - 2.6, 2.1, 0, U.TAU); ctx.fill();
      ctx.fillStyle = '#4caf50';
      ctx.fillRect(this.x - 1, y - this.r - 3, 2, 4);
      ctx.globalAlpha = 1;
    }
  }

  /* -------------------------------------------------------------- Pickup ---- */
  class Pickup {
    constructor(o) {
      this.x = o.x; this.y = o.y;
      this.weaponId = o.weaponId;
      this.r = 13;
      this.life = CFG.PICKUP.life;
      this.bob = Math.random() * 6;
      this.dead = false;
    }
    get def() { return W.Weapons.get(this.weaponId); }
    update(dt) { this.life -= dt; this.bob += dt * 2.4; if (this.life <= 0) this.dead = true; }
    draw(ctx) {
      const w = this.def;
      const fade = this.life < 4 ? (0.3 + 0.7 * Math.abs(Math.sin(this.life * 7))) : 1;
      const y = this.y + Math.sin(this.bob) * 3;
      ctx.globalAlpha = fade;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(this.x - 13, this.y + 8, 26, 5);
      ctx.fillStyle = 'rgba(255,209,102,.16)';
      ctx.beginPath(); ctx.arc(this.x, y, 18 + Math.sin(this.bob * 1.5) * 2, 0, U.TAU); ctx.fill();
      ctx.fillStyle = '#22303a';
      ctx.fillRect(this.x - 14, y - 10, 28, 20);
      ctx.strokeStyle = C.pickup; ctx.lineWidth = 2;
      ctx.strokeRect(this.x - 14, y - 10, 28, 20);
      ctx.fillStyle = w.color;
      ctx.fillRect(this.x - 9, y - 2.5, 18, 5);
      ctx.fillRect(this.x - 3, y + 1, 4, 6);
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------ Particles ---- */
  class Particle {
    constructor(o) {
      this.x = o.x; this.y = o.y;
      this.vx = o.vx || 0; this.vy = o.vy || 0;
      this.life = o.life || 0.4; this.maxLife = this.life;
      this.r = o.r || 3; this.color = o.color || '#ffffff';
      this.drag = o.drag === undefined ? 4 : o.drag;
      this.glow = !!o.glow;
      this.dead = false;
    }
    update(dt) {
      this.x += this.vx * dt; this.y += this.vy * dt;
      const f = Math.exp(-this.drag * dt);
      this.vx *= f; this.vy *= f;
      this.life -= dt;
      if (this.life <= 0) this.dead = true;
    }
    draw(ctx) {
      const t = Math.max(0, this.life / this.maxLife);
      ctx.globalAlpha = this.glow ? t : t * 0.9;
      ctx.fillStyle = this.color;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r * (this.glow ? t : 0.4 + t * 0.6), 0, U.TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------ FloatText ---- */
  class FloatText {
    constructor(o) {
      this.x = o.x; this.y = o.y; this.text = o.text;
      this.color = o.color || C.text; this.life = o.life || 0.8; this.maxLife = this.life;
      this.vy = o.vy || -34; this.size = o.size || 12; this.dead = false;
    }
    update(dt) { this.y += this.vy * dt; this.vy *= Math.exp(-2 * dt); this.life -= dt; if (this.life <= 0) this.dead = true; }
    draw(ctx) {
      const t = Math.max(0, this.life / this.maxLife);
      ctx.globalAlpha = t;
      ctx.font = `700 ${this.size}px ui-monospace, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillText(this.text, this.x + 1, this.y + 1);
      ctx.fillStyle = this.color;
      ctx.fillText(this.text, this.x, this.y);
      ctx.globalAlpha = 1;
    }
  }

  W.Bullet = Bullet;
  W.Fighter = Fighter;
  W.Base = Base;
  W.Tree = Tree;
  W.Fruit = Fruit;
  W.Pickup = Pickup;
  W.Particle = Particle;
  W.FloatText = FloatText;
})(window.WARS || (window.WARS = {}));