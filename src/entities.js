/* WARS — entity types. Each owns its own draw(); physics/collisions live in world.js.
   Visual style: faked top-left light source, soft shadows, per-type silhouettes,
   damage states, and a gore layer (Decal / Corpse) for the violence. */
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
      const len = this.kind === 'laser' ? 3.4 : 2.3;
      const ex = this.px + (this.x - this.px) * len;
      const ey = this.py + (this.y - this.py) * len;
      // soft outer glow, then a hot core — reads as real muzzle light
      ctx.strokeStyle = this.color;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = this.r * 2 + 5;
      ctx.beginPath(); ctx.moveTo(this.px, this.py); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = this.r * 1.1;
      ctx.beginPath(); ctx.moveTo(this.px, this.py); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r * 0.55, 0, U.TAU); ctx.fill();
      if (this.kind === 'rocket') {
        // little body + flickering flame, aligned to velocity
        const a = Math.atan2(this.vy, this.vx);
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(a);
        ctx.fillStyle = '#39424a';
        ctx.fillRect(-5, -3, 10, 6);
        const fl = 6 + Math.sin(this.maxLife * 60 + this.x * 0.2) * 3;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = C.fire;
        ctx.beginPath(); ctx.moveTo(-5, -2.6); ctx.lineTo(-5 - fl, 0); ctx.lineTo(-5, 2.6); ctx.closePath(); ctx.fill();
        ctx.restore();
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

      // cosmetics
      this.trail = [];        // dash afterimages (player)
      this.smokeT = 0;
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
      if (this.isPlayer && this.dashT > 0) {
        this.trail.push({ x: this.x, y: this.y, a: 1 });
        if (this.trail.length > 9) this.trail.shift();
      }
      for (const t of this.trail) t.a -= dt * 5.5;
      if (this.trail.length && this.trail[0].a <= 0) this.trail.shift();

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

      // wounded smoke once you're badly hurt
      this.smokeT -= dt;
      if (this.smokeT <= 0 && this.hp / this.maxHp < 0.4 && this.hp > 0) {
        this.smokeT = 0.16;
        world.addParticle(this.x + (Math.random() - .5) * this.r, this.y - this.r * 0.4, {
          vx: (Math.random() - .5) * 14, vy: -16, life: 0.6, r: 2.6, color: C.smoke, smoke: true, drag: 1.2,
        });
      }
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
      // muzzle flash: a hot core plus a fast expanding dot
      const mx = this.x + Math.cos(angle) * (this.r + 6);
      const my = this.y + Math.sin(angle) * (this.r + 6);
      world.addParticle(mx, my, {
        vx: Math.cos(angle) * 40, vy: Math.sin(angle) * 40, life: 0.08, r: 5.5, color: '#fff6cc', glow: true,
      });
      world.addParticle(mx, my, {
        vx: Math.cos(angle) * 60, vy: Math.sin(angle) * 60, life: 0.05, r: 3, color: '#ffe9a0', glow: true,
      });
      return true;
    }

    draw(ctx, game) {
      const isP = this.team === CFG.TEAM.PLAYER;
      const T = W.AI ? W.AI.TYPES[this.type] : null;
      const body = (T && T.colorHint) ? T.colorHint : (isP ? C.teamPlayer : C.teamEnemy);
      const dim = isP ? C.teamPlayerDim : C.teamEnemyDim;
      const bob = Math.sin(this.walkPhase) * 1.6;
      const by = this.y + bob * 0.3;
      const hpF = this.maxHp > 0 ? this.hp / this.maxHp : 0;

      // dash afterimages (player)
      if (isP && this.trail.length) {
        ctx.fillStyle = C.teamPlayer;
        for (const t of this.trail) {
          if (t.a <= 0) continue;
          ctx.globalAlpha = 0.14 * t.a;
          ctx.beginPath(); ctx.arc(t.x, t.y, this.r * 0.85, 0, U.TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // shadow
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.ellipse(this.x + 2, this.y + 5, this.r * 0.95, this.r * 0.6, 0, 0, U.TAU); ctx.fill();

      // walking feet, perpendicular to facing, alternating stride
      const px = -Math.sin(this.aim), py = Math.cos(this.aim);
      const stride = Math.sin(this.walkPhase) * this.r * 0.32;
      ctx.fillStyle = dim;
      for (const s of [1, -1]) {
        ctx.beginPath();
        ctx.arc(this.x + px * s * this.r * 0.42 + Math.cos(this.aim) * s * stride,
                by + py * s * this.r * 0.42 + Math.sin(this.aim) * s * stride,
                this.r * 0.28, 0, U.TAU);
        ctx.fill();
      }

      // gun (under the body so the stock hides in the torso)
      const w = this.weapon;
      const rec = (w && this.cd > 0) ? Math.min(1, this.cd / Math.max(0.05, w.rate)) * 4 : 0;
      const barrel = this.r * (this.type === 'sniper' ? 2.1 : this.type === 'gunner' ? 1.6 : 1.25);
      ctx.save();
      ctx.translate(this.x, by);
      ctx.rotate(this.aim);
      ctx.fillStyle = '#2b3944';
      ctx.fillRect(this.r * 0.3 - rec, -2.6, barrel, 5.2);
      ctx.fillStyle = this.flash > 0.4 ? '#fff3b0' : '#4a5c6b';
      ctx.fillRect(this.r * 0.3 - rec + barrel - 4, -3.4, 4, 6.8);
      if (this.type === 'brute') {           // twin barrels
        ctx.fillStyle = '#3a2626';
        ctx.fillRect(this.r * 0.3 - rec + 3, -6, barrel * 0.7, 3.2);
        ctx.fillRect(this.r * 0.3 - rec + 3, 2.8, barrel * 0.7, 3.2);
      }
      ctx.restore();

      // body: dark offset copy for form shadow, then main, then rim + highlight
      ctx.fillStyle = 'rgba(0,0,0,.30)';
      ctx.beginPath(); ctx.arc(this.x + 2.5, by + 3, this.r * 0.92, 0, U.TAU); ctx.fill();
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.arc(this.x - 0.8, by - 1.2, this.r * 0.92, 0, U.TAU); ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = dim;
      ctx.beginPath(); ctx.arc(this.x, by, this.r, 0, U.TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.20)';
      ctx.beginPath(); ctx.arc(this.x - this.r * 0.34, by - this.r * 0.42, this.r * 0.3, 0, U.TAU); ctx.fill();

      // visor (you can see which way they are looking)
      ctx.save();
      ctx.translate(this.x, by);
      ctx.rotate(this.aim);
      ctx.fillStyle = 'rgba(8,10,12,.78)';
      ctx.fillRect(this.r * 0.22, -this.r * 0.44, this.r * 0.5, this.r * 0.88);
      ctx.fillStyle = isP ? 'rgba(210,244,255,.95)' : 'rgba(255,120,90,.9)';
      ctx.fillRect(this.r * 0.36, -this.r * 0.2, this.r * 0.3, this.r * 0.4);
      ctx.restore();

      // brute armor plate
      if (this.type === 'brute') {
        ctx.strokeStyle = '#402323'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(this.x, by, this.r - 1, 0, U.TAU); ctx.stroke();
        ctx.fillStyle = '#4a2a2a';
        for (let i = 0; i < 4; i++) {
          const a = this.aim + Math.PI / 4 + i * (U.TAU / 4);
          ctx.beginPath(); ctx.arc(this.x + Math.cos(a) * (this.r - 4), by + Math.sin(a) * (this.r - 4), 2.6, 0, U.TAU); ctx.fill();
        }
      }

      // scorching when badly damaged
      if (hpF < 0.45 && this.hp > 0) {
        ctx.globalAlpha = (0.45 - hpF) * 1.1;
        ctx.fillStyle = '#160c08';
        ctx.beginPath(); ctx.arc(this.x + 1.5, by + 2, this.r * 0.78, 0, U.TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
      // hit flash
      if (this.flash > 0.25) {
        ctx.globalAlpha = Math.min(0.65, this.flash * 0.7);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(this.x, by, this.r * 0.95, 0, U.TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (this.spawnGuard > 0 || this.iframes > 0) {
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(this.spawnGuard * 30);
        ctx.beginPath(); ctx.arc(this.x, by, this.r + 5, 0, U.TAU);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // hp bar (skip for player: it lives in the HUD)
      if (!this.isPlayer && this.hp < this.maxHp && this.hp > 0) {
        const w2 = this.r * 2.2, h2 = 3;
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(this.x - w2 / 2, this.y - this.r - 9, w2, h2);
        ctx.fillStyle = hpF > 0.4 ? C.hp : C.hpLow;
        ctx.fillRect(this.x - w2 / 2, this.y - this.r - 9, w2 * hpF, h2);
      }
    }
  }

  /* ----------------------------------------------------------------- Base --- */

  /* ----------------------------------------------------------------- Base --- */
  /* Bunker: takes hits, regens when left alone, and a short-range turret keeps
     its own patch clear. Visual states: clean -> cracked -> charred ->
     burning wreck. */
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
      // pre-rolled damage cosmetics (stable per base)
      this.cracks = [];
      for (let i = 0; i < 5; i++) {
        const pts = [[0, 0]];
        let a = Math.random() * U.TAU;
        let d = 0;
        const n = 3 + ((Math.random() * 3) | 0);
        for (let j = 0; j < n; j++) {
          a += (Math.random() - 0.5) * 1.6;
          d += 10 + Math.random() * 14;
          const dd = Math.min(d, this.half * 0.85);
          pts.push([Math.cos(a) * dd, Math.sin(a) * dd]);
        }
        this.cracks.push(pts);
      }
      this.fireSpots = [];
      for (let i = 0; i < 7; i++) {
        this.fireSpots.push({ x: (Math.random() - 0.5) * this.half * 1.4, y: (Math.random() - 0.5) * this.half * 1.4 });
      }
    }
    get alive() { return this.hp > 0; }

    hurt(dmg, world, srcTeam) {
      if (this.dead) return 0;
      const m = world.modeCfg;
      // Mode replaces the classic dmgTakenMul: hard = 0.5 (classic), easier = softer, harder = raw.
      const real = dmg * (m ? m.baseDmg : CFG.BASE.dmgTakenMul);
      this.hp -= real; this.flash = 1;
      if (this.hp <= 0) { this.hp = 0; this.dead = true; world.onBaseDestroyed?.(this, srcTeam); }
      else world.onBaseHit?.(this, real, srcTeam);
      return real;
    }

    update(dt, world, game) {
      this.pulse += dt;
      this.flash = Math.max(0, this.flash - dt * 4);
      if (this.dead) return;
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
      const h = this.half;
      const isP = this.team === CFG.TEAM.PLAYER;
      const col = isP ? C.teamPlayer : C.teamEnemy;
      const dim = isP ? C.teamPlayerDim : C.teamEnemyDim;
      const f = this.maxHp > 0 ? this.hp / this.maxHp : 0;

      if (this.dead) {
        this._drawWreck(ctx, col);
        return;
      }

      const shake = this.flash > 0.5 ? (Math.random() - 0.5) * 4 : 0;

      // shadow
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fillRect(this.x - h + 5, this.y - h + 9, h * 2, h * 2);

      // outer shell (charred as it takes damage)
      ctx.fillStyle = f > 0.5 ? '#23272b' : '#15181a';
      ctx.fillRect(this.x - h + shake, this.y - h + shake, h * 2, h * 2);

      // inner floor: team colored, dimmed when hurt
      ctx.fillStyle = f > 0.5 ? col : dim;
      ctx.fillRect(this.x - h + 8, this.y - h + 8, h * 2 - 16, h * 2 - 16);

      // hazard stripe border (slow crawl = "alive machinery")
      const ss = 12;
      ctx.strokeStyle = f > 0.5 ? '#3d444b' : '#14171a';
      ctx.lineWidth = 8;
      ctx.setLineDash([ss, ss]);
      ctx.lineDashOffset = this.pulse * 10;
      ctx.strokeRect(this.x - h + 12, this.y - h + 12, h * 2 - 24, h * 2 - 24);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.strokeStyle = f > 0.5 ? dim : 'rgba(0,0,0,.4)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(this.x - h + 12, this.y - h + 12, h * 2 - 24, h * 2 - 24);

      // structural cracks appear below 60% / 30%
      const cracksShown = f > 0.6 ? 0 : f > 0.3 ? 2 : 5;
      if (cracksShown > 0) {
        ctx.strokeStyle = 'rgba(5,6,7,.85)';
        ctx.lineWidth = 2.5;
        for (let i = 0; i < cracksShown; i++) {
          const pts = this.cracks[i];
          ctx.beginPath();
          ctx.moveTo(this.x + pts[0][0] + shake, this.y + pts[0][1] + shake);
          for (let j = 1; j < pts.length; j++) ctx.lineTo(this.x + pts[j][0] + shake, this.y + pts[j][1] + shake);
          ctx.stroke();
        }
      }

      // core: team-colored inner block, pulsing
      const p = 0.5 + 0.5 * Math.sin(this.pulse * 2);
      ctx.globalAlpha = 0.2 + p * 0.3;
      ctx.fillStyle = f > 0.25 ? col : '#4a1d1d';
      ctx.fillRect(this.x - h * 0.5, this.y - h * 0.5, h, h);
      ctx.globalAlpha = 1;

      // turret: rotating barrel + domed body
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.turretAim);
      ctx.fillStyle = '#33454f';
      ctx.fillRect(0, -6, this.r + 4, 12);
      ctx.fillStyle = '#1c262d';
      ctx.fillRect(this.r * 0.5 - 4, -4.5, 8, 9);
      ctx.fillStyle = f > 0.25 ? col : '#3a2222';
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, U.TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, U.TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.beginPath(); ctx.arc(0, 0, 4.5 * (0.6 + p * 0.5), 0, U.TAU); ctx.fill();
      ctx.restore();

      // hit flash
      if (this.flash > 0.2) {
        ctx.globalAlpha = Math.min(0.5, this.flash * 0.55);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(this.x - h, this.y - h, h * 2, h * 2);
        ctx.globalAlpha = 1;
      }

      // hp bar
      const w = h * 2.4;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(this.x - w / 2, this.y - h - 18, w, 7);
      ctx.fillStyle = f > 0.35 ? (isP ? C.hp : C.teamEnemy) : C.hpLow;
      ctx.fillRect(this.x - w / 2, this.y - h - 18, w * f, 7);
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1;
      ctx.strokeRect(this.x - w / 2, this.y - h - 18, w, 7);
    }

    /** A destroyed base keeps burning — that is what losing (or winning) looks like. */
    _drawWreck(ctx, col) {
      const h = this.half;
      const t = this.pulse;

      // charred footprint
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(this.x - h + 5, this.y - h + 8, h * 2, h * 2);
      ctx.fillStyle = '#13100d';
      ctx.fillRect(this.x - h, this.y - h, h * 2, h * 2);
      ctx.fillStyle = '#1c1512';
      ctx.fillRect(this.x - h + 5, this.y - h + 5, h * 2 - 10, h * 2 - 10);

      // all the cracks, deeper
      ctx.strokeStyle = 'rgba(4,4,4,.95)';
      ctx.lineWidth = 3;
      for (const pts of this.cracks) {
        ctx.beginPath();
        ctx.moveTo(this.x + pts[0][0], this.y + pts[0][1]);
        for (let j = 1; j < pts.length; j++) ctx.lineTo(this.x + pts[j][0], this.y + pts[j][1]);
        ctx.stroke();
      }

      // melted core
      ctx.fillStyle = '#0d0d0f';
      ctx.beginPath(); ctx.arc(this.x, this.y, 15, 0, U.TAU); ctx.fill();
      ctx.strokeStyle = '#2a211b'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(this.x, this.y, 12, 0, U.TAU); ctx.stroke();

      // embers + a flickering fire tongue
      for (let i = 0; i < 7; i++) {
        const s = this.fireSpots[i];
        const fl = 0.25 + 0.75 * Math.abs(Math.sin(t * (2.6 + (i % 4) * 1.3) + i * 2.3));
        ctx.globalAlpha = fl * 0.85;
        ctx.fillStyle = i % 2 ? C.fire : '#e0561f';
        ctx.beginPath(); ctx.arc(this.x + s.x, this.y + s.y, 2.5 + fl * 3, 0, U.TAU); ctx.fill();
      }
      const k = (t * 0.7) % 1;
      const fs = this.fireSpots[(Math.floor(t * 0.7)) % 7];
      ctx.globalAlpha = (1 - k) * 0.55;
      ctx.fillStyle = '#ff8a2e';
      ctx.beginPath();
      ctx.moveTo(this.x + fs.x - 4, this.y + fs.y);
      ctx.lineTo(this.x + fs.x, this.y + fs.y - 10 - k * 12);
      ctx.lineTo(this.x + fs.x + 4, this.y + fs.y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // faint team ghost stripe so you can still tell whose bunker it was
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = col;
      ctx.fillRect(this.x - h, this.y - h + 9, h * 2, 4);
      ctx.globalAlpha = 1;
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
      // irregular canopy lobes (stable per tree — no wobble jitter)
      this.lobes = [];
      for (let i = 0; i < 7; i++) {
        this.lobes.push({
          a: (i / 7) * U.TAU + Math.random() * 0.9,
          d: 0.3 + Math.random() * 0.32,
          s: 0.4 + Math.random() * 0.2,
        });
      }
      this.lobes.push({ a: Math.random() * U.TAU, d: 0.12, s: 0.58 });
      this.appleSpots = [];
      for (let i = 0; i < 3; i++) {
        this.appleSpots.push({ a: Math.random() * U.TAU, d: 0.45 + Math.random() * 0.3 });
      }
      this.logs = [
        { a: Math.random() * Math.PI, d: 0.45 },
        { a: Math.random() * Math.PI, d: 0.7 },
      ];
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

      if (this.dead) {
        // a felled tree is a woodpile and a stump, not a ghost — it regrows later
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.beginPath(); ctx.ellipse(this.x + 3, this.y + 5, r * 0.7, r * 0.4, 0, 0, U.TAU); ctx.fill();
        for (const lg of this.logs) {
          ctx.save();
          ctx.translate(this.x + Math.cos(lg.a) * r * lg.d * 0.5, this.y + Math.sin(lg.a) * r * lg.d * 0.4);
          ctx.rotate(lg.a);
          ctx.fillStyle = '#54381f';
          ctx.fillRect(-r * 0.42, -3, r * 0.84, 6);
          ctx.fillStyle = '#3c2a17';
          ctx.fillRect(-r * 0.42, 1.5, r * 0.84, 1.5);
          ctx.restore();
        }
        // stump with growth rings
        ctx.fillStyle = '#6b4a2b';
        ctx.beginPath(); ctx.arc(this.x, this.y, this.trunkR * 1.15, 0, U.TAU); ctx.fill();
        ctx.fillStyle = '#8a6a42';
        ctx.beginPath(); ctx.arc(this.x - 1, this.y - 1, this.trunkR * 0.8, 0, U.TAU); ctx.fill();
        ctx.strokeStyle = '#4a3320'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.trunkR * 0.5, 0, U.TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(this.x, this.y, this.trunkR * 0.22, 0, U.TAU); ctx.stroke();
        return;
      }

      // shadow
      ctx.fillStyle = 'rgba(0,0,0,.32)';
      ctx.beginPath(); ctx.ellipse(this.x + 4, this.y + 7, r * 0.95, r * 0.6, 0, 0, U.TAU); ctx.fill();

      // tapered trunk
      ctx.fillStyle = C.trunk;
      ctx.beginPath();
      ctx.moveTo(this.x - this.trunkR * 0.55, this.y + this.trunkR * 1.5);
      ctx.lineTo(this.x + this.trunkR * 0.55, this.y + this.trunkR * 1.5);
      ctx.lineTo(this.x + this.trunkR * 0.3, this.y - 2);
      ctx.lineTo(this.x - this.trunkR * 0.3, this.y - 2);
      ctx.closePath();
      ctx.fill();

      const flash = this.flash > 0.3;
      const dark = flash ? '#7dbf92' : C.canopyDark;
      const mid = flash ? '#a5e8b8' : C.canopy;
      const top = flash ? '#d2ffd9' : C.canopyLight;

      // canopy: dark under-layer, mid layer, light top layer — top-left light
      for (const layer of [
        { col: dark, ox: 1.5, oy: 2.5, sc: 1.06, squash: 0.8 },
        { col: mid, ox: -1.5, oy: -2, sc: 1.0, squash: 0.84 },
      ]) {
        ctx.fillStyle = layer.col;
        for (const l of this.lobes) {
          ctx.beginPath();
          ctx.ellipse(
            this.x + Math.cos(l.a) * r * l.d + s + layer.ox,
            this.y + Math.sin(l.a) * r * l.d * layer.squash - r * 0.08 + layer.oy,
            r * l.s * layer.sc, r * l.s * layer.sc * 0.92, 0, 0, U.TAU);
          ctx.fill();
        }
      }
      // light only strikes the top-left of alternating lobes
      ctx.fillStyle = top;
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < this.lobes.length; i += 2) {
        const l = this.lobes[i];
        ctx.beginPath();
        ctx.ellipse(
          this.x + Math.cos(l.a) * r * l.d * 0.7 - r * 0.18 + s,
          this.y + Math.sin(l.a) * r * l.d * 0.7 * 0.8 - r * 0.24,
          r * l.s * 0.62, r * l.s * 0.5, 0, 0, U.TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // rim light, top-left arc
      ctx.strokeStyle = 'rgba(255,255,255,.09)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(this.x - r * 0.12 + s, this.y - r * 0.16, r * 0.85, Math.PI * 0.75, Math.PI * 1.5);
      ctx.stroke();

      // apples: red, glossy, with stems
      for (let i = 0; i < this.fruit; i++) {
        const a = this.appleSpots[i % 3];
        const ax = this.x + Math.cos(a.a) * r * a.d + s;
        const ay = this.y + Math.sin(a.a) * r * a.d * 0.7 - r * 0.14;
        ctx.fillStyle = C.apple;
        ctx.beginPath(); ctx.arc(ax, ay, 3.6, 0, U.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,240,230,.7)';
        ctx.beginPath(); ctx.arc(ax - 1.2, ay - 1.3, 1.2, 0, U.TAU); ctx.fill();
        ctx.fillStyle = '#5a3b22';
        ctx.fillRect(ax - 0.7, ay - 5.4, 1.4, 2.4);
      }
    }
  }
  /* ---------------------------------------------------------------- Fruit --- */
  class Fruit {
    constructor(o) {
      this.x = o.x; this.y = o.y;
      this.vx = o.vx || 0; this.vy = o.vy || 0;
      this.r = CFG.FRUIT.r;
      this.heal = CFG.FRUIT.heal;
      this.life = CFG.FRUIT.life;
      this.bob = Math.random() * 6;
      this.rot = 0;
      this.vr = (Math.random() - 0.5) * 7;
      this.dead = false;
    }
    update(dt) {
      this.x += this.vx * dt; this.y += this.vy * dt;
      const f = Math.exp(-CFG.FRUIT.settle * dt);
      this.vx *= f; this.vy *= f;
      this.bob += dt * 3;
      this.rot += this.vr * dt * Math.min(1, (Math.abs(this.vx) + Math.abs(this.vy)) / 60 + 0.15);
      this.vr *= Math.exp(-1.5 * dt);
      this.life -= dt;
      if (this.life <= 0) this.dead = true;
    }
    draw(ctx) {
      const fade = this.life < 3 ? (0.35 + 0.65 * Math.abs(Math.sin(this.life * 8))) : 1;
      const y = this.y + Math.sin(this.bob) * 1.4;
      ctx.globalAlpha = fade;
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(this.x + 2, this.y + 4, this.r * 0.7, this.r * 0.4, 0, 0, U.TAU); ctx.fill();
      // body
      ctx.fillStyle = C.apple;
      ctx.beginPath(); ctx.arc(this.x, y, 6.4, 0, U.TAU); ctx.fill();
      ctx.fillStyle = 'rgba(90,20,12,.45)';
      ctx.beginPath(); ctx.ellipse(this.x + 1.2, y + 2.2, 5.2, 3.4, 0, 0, U.TAU); ctx.fill();
      // glossy highlight
      ctx.fillStyle = 'rgba(255,235,225,.75)';
      ctx.beginPath(); ctx.arc(this.x - 2.3, y - 2.4, 1.7, 0, U.TAU); ctx.fill();
      // stem + leaf, tumbling as it rolls
      ctx.save();
      ctx.translate(this.x, y);
      ctx.rotate(Math.sin(this.rot) * 0.5);
      ctx.fillStyle = '#5a3b22';
      ctx.fillRect(-1, -9.2, 2, 3.4);
      ctx.fillStyle = '#4d8f3c';
      ctx.beginPath();
      ctx.ellipse(2.6, -9.4, 3.4, 1.7, -0.5, 0, U.TAU);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  /* --------------------------------------------------------------- Pickup --- */
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
    update(dt) {
      this.life -= dt; this.bob += dt * 2.4;
      if (this.life <= 0) this.dead = true;
    }
    draw(ctx) {
      const w = this.def;
      const fade = this.life < 4 ? (0.3 + 0.7 * Math.abs(Math.sin(this.life * 7))) : 1;
      const y = this.y + Math.sin(this.bob) * 2.5;
      ctx.globalAlpha = fade;
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath(); ctx.ellipse(this.x + 2, this.y + 12, 16, 6, 0, 0, U.TAU); ctx.fill();
      // beacon glow
      ctx.fillStyle = 'rgba(255,209,102,.13)';
      ctx.beginPath(); ctx.arc(this.x, y, 20 + Math.sin(this.bob * 1.5) * 2.5, 0, U.TAU); ctx.fill();
      // wooden crate
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(this.x - 14, y - 11, 28, 22);
      ctx.fillStyle = '#5f3f24';
      ctx.fillRect(this.x - 14, y - 2, 28, 4);
      ctx.fillRect(this.x - 14, y + 6, 28, 2.5);
      ctx.strokeStyle = '#3f2a16';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(this.x - 14, y - 11, 28, 22);
      // corner braces
      ctx.lineWidth = 3;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(this.x + sx * 14, y + sy * 11 - sy * 6);
        ctx.lineTo(this.x + sx * 14, y + sy * 11);
        ctx.lineTo(this.x + sx * 14 - sx * 6, y + sy * 11);
        ctx.stroke();
      }
      // weapon color strip + stencil
      ctx.fillStyle = w.color;
      ctx.fillRect(this.x - 9, y - 1, 18, 4);
      ctx.fillStyle = 'rgba(255,235,200,.85)';
      ctx.font = '700 7px ui-monospace, SFMono-Regular, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('AMMO', this.x, y + 6.5);
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------- Particle --- */
  class Particle {
    constructor(o) {
      this.x = o.x; this.y = o.y;
      this.vx = o.vx || 0; this.vy = o.vy || 0;
      this.life = o.life || 0.4; this.maxLife = this.life;
      this.r = o.r || 3;
      this.color = o.color || '#ffffff';
      this.drag = o.drag === undefined ? 4 : o.drag;
      this.glow = !!o.glow;
      this.rect = !!o.rect;      // tumbling chunk / leaf
      this.smoke = !!o.smoke;    // growing soft puff
      this.rot = o.rot || 0;
      this.vr = o.vr || 0;
      this.grav = !!o.grav;     // chunks fall and splat
      this.dead = false;
    }
    update(dt) {
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (this.grav) this.vy += 300 * dt;
      const f = Math.exp(-this.drag * dt);
      this.vx *= f; this.vy *= f;
      if (this.vr) this.rot += this.vr * dt;
      this.life -= dt;
      if (this.life <= 0) this.dead = true;
    }
    draw(ctx) {
      const t = Math.max(0, this.life / this.maxLife);
      if (this.rect) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rot);
        ctx.globalAlpha = Math.min(1, t * 2) * 0.95;
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.r, -this.r * 0.6, this.r * 2, this.r * 1.2);
        ctx.restore();
        return;
      }
      if (this.smoke) {
        const grow = 1 + (1 - t) * 1.7;
        ctx.globalAlpha = t * 0.32;
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r * grow, 0, U.TAU); ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      ctx.globalAlpha = this.glow ? t : t * 0.9;
      ctx.fillStyle = this.color;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r * (this.glow ? t : 0.4 + t * 0.6), 0, U.TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------------------------------------------------------- Decal --- */
  /* Blood stain or scorch mark soaked into the ground. Blobs are rolled at
     creation and only drawn, so a dozen of these cost almost nothing. */
  class Decal {
    constructor(o) {
      this.x = o.x; this.y = o.y;
      this.segs = o.segs;
      this.color = o.color;
      this.kind = o.kind || 'blood';
      this.life = o.life; this.maxLife = o.life;
      this.dead = false;
    }
    update(dt) {
      this.life -= dt;
      if (this.life <= 0) this.dead = true;
    }
    draw(ctx) {
      const t = this.life / this.maxLife;
      const fadeAt = 1 - CFG.GORE.decalFade / this.maxLife;
      const a = t < fadeAt ? 1 - (1 - t) / Math.max(0.001, 1 - fadeAt) : 1;
      ctx.globalAlpha = (this.kind === 'scorch' ? 0.5 : 0.78) * a;
      ctx.fillStyle = this.color;
      for (const s of this.segs) {
        ctx.beginPath();
        ctx.ellipse(this.x + s.dx, this.y + s.dy, s.r, s.r * 0.72, s.rot, 0, U.TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* --------------------------------------------------------------- Corpse --- */
  /* A body that stays on the field for a few seconds after a kill, then fades
     — so you can see what you did. */
  class Corpse {
    constructor(o) {
      this.x = o.x; this.y = o.y;
      this.r = o.r || 13;
      this.rot = o.rot || 0;
      this.bodyColor = o.bodyColor;
      this.bloodColor = o.bloodColor;
      this.life = CFG.GORE.corpseLife; this.maxLife = CFG.GORE.corpseLife;
      this.dead = false;
      this.chunks = [];
      const n = 2 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) {
        this.chunks.push({
          dx: (Math.random() - 0.5) * this.r * 2.6,
          dy: (Math.random() - 0.5) * this.r * 2.2,
          r: 1.6 + Math.random() * 2.4,
        });
      }
    }
    update(dt) {
      this.life -= dt;
      if (this.life <= 0) this.dead = true;
    }
    draw(ctx) {
      const t = this.life / this.maxLife;
      const a = t < 0.4 ? t / 0.4 : 1;
      // blood pool
      ctx.globalAlpha = 0.5 * a;
      ctx.fillStyle = this.bloodColor;
      ctx.beginPath(); ctx.ellipse(this.x, this.y + 1, this.r * 1.7, this.r * 1.1, this.rot, 0, U.TAU); ctx.fill();
      // flattened body + shading
      ctx.globalAlpha = 0.9 * a;
      ctx.beginPath(); ctx.ellipse(this.x, this.y, this.r * 1.05, this.r * 0.62, this.rot, 0, U.TAU); ctx.fill();
      ctx.fillStyle = this.bodyColor;
      ctx.beginPath(); ctx.ellipse(this.x - 1, this.y - 1.5, this.r * 0.72, this.r * 0.45, this.rot, 0, U.TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(this.x, this.y, this.r * 1.05, this.r * 0.62, this.rot, 0, U.TAU); ctx.stroke();
      // organ chunks
      ctx.fillStyle = '#c23b30';
      for (const c of this.chunks) {
        ctx.beginPath(); ctx.arc(this.x + c.dx, this.y + c.dy, c.r, 0, U.TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------ FloatText --- */
  class FloatText {
    constructor(o) {
      this.x = o.x; this.y = o.y;
      this.text = o.text;
      this.color = o.color || '#ffffff';
      this.life = o.life || 0.9; this.maxLife = this.life;
      this.vy = o.vy || -34;
      this.size = o.size || 11;
      this.dead = false;
    }
    update(dt) {
      this.y += this.vy * dt;
      this.vy *= Math.exp(-1.2 * dt);
      this.life -= dt;
      if (this.life <= 0) this.dead = true;
    }
    draw(ctx) {
      const t = this.life / this.maxLife;
      ctx.globalAlpha = Math.min(1, t * 1.5);
      ctx.font = '700 ' + this.size + 'px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.strokeText(this.text, this.x, this.y);
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
  W.Decal = Decal;
  W.Corpse = Corpse;
  W.FloatText = FloatText;

  /* ----------------------------------------------------------------- Tank --- */
  /* Late-game unlock: a slow, heavily-armored vehicle that advances on the
     enemy base, parks at gun range and fires high-damage splash shells from
     an independently-rotating turret. Tanks can be upgraded (damage). */
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  class Tank {
    constructor(o) {
      this.x = o.x; this.y = o.y;
      this.team = o.team || CFG.TEAM.PLAYER;
      this.r = CFG.TANK.r;
      this.maxHp = CFG.TANK.hp;
      this.hp = this.maxHp;
      this.dmgMul = 1;
      this.dead = false;
      this.hull = o.aim != null ? o.aim : (this.team === CFG.TEAM.PLAYER ? -Math.PI / 2 : Math.PI / 2);
      this.aim = this.hull;
      this.vx = 0; this.vy = 0;
      this.cd = 0;
      this.trackT = 0;
      this.smokeT = 0;
      this._t = Math.random() * 10;
      this.dmgDealt = 0;
    }

    get alive() { return !this.dead; }

    hurt(dmg, world, srcTeam) {
      if (this.dead) return 0;
      this.hp -= dmg;
      if (this.hp <= 0) { this.hp = 0; this.dead = true; }
      return dmg;
    }

    update(dt, world) {
      this._t += dt;
      this.cd = Math.max(0, this.cd - dt);
      this.trackT = Math.max(0, this.trackT - dt);
      this.smokeT = Math.max(0, this.smokeT - dt);
      const T = CFG.TANK;
      const enemyBase = this.team === CFG.TEAM.PLAYER ? world.enemyBase : world.playerBase;

      // --- target: nearest living enemy in gun range, else the enemy base ---
      let tgt = world.nearestEnemy(this, this.team, T.turretRange);
      if (!tgt && enemyBase && !enemyBase.dead) {
        const d2 = (enemyBase.x - this.x) ** 2 + (enemyBase.y - this.y) ** 2;
        if (d2 < (T.turretRange * 1.5) ** 2) tgt = enemyBase;
      }
      if (tgt) {
        const want = Math.atan2(tgt.y - this.y, tgt.x - this.x);
        this.aim = U.turnToward(this.aim, want, T.turretTurn * dt);
        if (this.cd <= 0 && Math.abs(U.angleDiff(this.aim, want)) < 0.12) {
          this.cd = T.shellRate;
          const mx = this.x + Math.cos(this.aim) * 30;
          const my = this.y + Math.sin(this.aim) * 30;
          world.addBullet({
            x: mx, y: my,
            vx: Math.cos(this.aim) * T.shellSpeed, vy: Math.sin(this.aim) * T.shellSpeed,
            dmg: T.shellDmg * this.dmgMul, r: T.shellR, speed: T.shellSpeed,
            life: (T.turretRange * 1.3) / T.shellSpeed,
            team: this.team, splash: T.splash, knock: 120,
            sound: 'shootTank',
            fromPlayer: this.team === CFG.TEAM.PLAYER,
          });
          world.addParticle(mx, my, {
            vx: -Math.cos(this.aim) * 30, vy: -Math.sin(this.aim) * 30,
            life: 0.18, r: 6, color: C.smoke, smoke: true, drag: 2,
          });
          // the shell itself resolves damage + splash via world._bulletImpact
        }
      }

      // --- movement: advance on the enemy base, hold at gun range ----------
      let mx = 0, my = 0;
      if (enemyBase && !enemyBase.dead) {
        const d = Math.hypot(enemyBase.x - this.x, enemyBase.y - this.y);
        if (d > T.holdRange) {
          const a = Math.atan2(enemyBase.y - this.y, enemyBase.x - this.x);
          mx = Math.cos(a); my = Math.sin(a);
        }
      }
      this.vx = mx * T.speed; this.vy = my * T.speed;
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > 0.001) this.hull = U.turnToward(this.hull, Math.atan2(this.vy, this.vx), 1.6 * dt);
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (sp > 1 && this.trackT <= 0) { this.trackT = 0.5; world.addTrack && world.addTrack(this.x, this.y, this.hull); }

      // damage smoke -> fire when critical
      const hpF = this.hp / this.maxHp;
      if (this.smokeT <= 0 && hpF < 0.6 && this.hp > 0) {
        this.smokeT = hpF < 0.25 ? 0.07 : 0.16;
        world.addParticle(this.x + (Math.random() - .5) * 16, this.y - 6, {
          vx: (Math.random() - .5) * 10, vy: -20 - (0.6 - hpF) * 30,
          life: hpF < 0.25 ? 0.8 : 0.5, r: hpF < 0.25 ? 4.5 : 3,
          color: hpF < 0.25 ? C.fire : C.smoke, smoke: true, drag: 1.2, glow: hpF < 0.25,
        });
      }
    }

    draw(ctx) {
      const isP = this.team === CFG.TEAM.PLAYER;
      const hpF = this.hp / this.maxHp;
      const tw = 46, th = 32;

      // shadow
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.ellipse(this.x + 3, this.y + 8, 30, 15, 0, 0, U.TAU); ctx.fill();

      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.hull);

      // tracks
      ctx.fillStyle = '#10151a';
      ctx.fillRect(-tw / 2, -th / 2, tw, 9);
      ctx.fillRect(-tw / 2, th / 2 - 9, tw, 9);
      ctx.fillStyle = '#232b32';
      for (let i = 0; i < 5; i++) {
        const nx = -tw / 2 + 3 + i * (tw / 5);
        ctx.fillRect(nx, -th / 2 + 1.5, 3, 6);
        ctx.fillRect(nx, th / 2 - 7.5, 3, 6);
      }

      // hull
      ctx.fillStyle = '#0b0e10';
      rr(ctx, -tw / 2 + 7, -th / 2 + 7, tw - 14, th - 14, 5); ctx.fill();
      ctx.fillStyle = isP ? '#4a6a58' : '#5c4b46';
      rr(ctx, -tw / 2 + 8, -th / 2 + 8, tw - 16, th - 16, 4); ctx.fill();
      // team stripe
      ctx.fillStyle = isP ? C.teamPlayer : C.teamEnemy;
      ctx.fillRect(-tw / 2 + 8, -2, tw - 16, 4);
      // hull damage: scorch + cracks
      if (hpF < 0.5) {
        ctx.globalAlpha = (0.5 - hpF) * 1.4;
        ctx.fillStyle = '#0f0a08';
        rr(ctx, -tw / 2 + 9, -th / 2 + 9, tw - 18, th - 18, 3); ctx.fill();
        ctx.globalAlpha = 1;
      }

      // turret (independent rotation)
      ctx.rotate(this.aim - this.hull);
      ctx.fillStyle = '#0b0e10';
      ctx.beginPath(); ctx.arc(2, 3, 13, 0, U.TAU); ctx.fill();
      ctx.fillStyle = isP ? '#567c68' : '#6a5550';
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, U.TAU); ctx.fill();
      // barrel + muzzle brake
      ctx.fillStyle = '#222b32';
      ctx.fillRect(7, -3.5, 27, 7);
      ctx.fillStyle = '#151c21';
      ctx.fillRect(30, -5, 6, 10);
      // hatch
      ctx.fillStyle = isP ? '#3d5c4b' : '#4e3d38';
      ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, U.TAU); ctx.fill();
      ctx.restore();

      // hp bar
      if (this.hp < this.maxHp && this.hp > 0) {
        const w2 = 54;
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(this.x - w2 / 2, this.y - 32, w2, 4);
        ctx.fillStyle = hpF > 0.4 ? C.hp : C.hpLow;
        ctx.fillRect(this.x - w2 / 2, this.y - 32, w2 * hpF, 4);
      }
    }
  }

  W.Tank = Tank;
})(window.WARS || (window.WARS = {}));
