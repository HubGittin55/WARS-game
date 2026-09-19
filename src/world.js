/* WARS — the world: entity lists, broadphase grid, movement resolution, all
   bullet/tree/fruit/pickup collisions. Gameplay *decisions* (spawning, AI) live
   in director.js / ai.js / game.js; this file is physics + queries. */
(function (W) {
  'use strict';
  const U = W.Util;
  const CFG = W.Config;
  const T = CFG.TEAM;

  class World {
    constructor(game) {
      this.game = game;
      this.rng = U.makeRng(1337);
      this.w = CFG.WORLD.W;
      this.h = CFG.WORLD.H;
      this.time = 0;
      this.bullets = [];
      this.fighters = [];
      this.trees = [];
      this.fruits = [];
      this.pickups = [];
      this.particles = [];
      this.texts = [];
      this.bases = [];
      this.decor = [];
      this.grid = new Map();
      this.difficulty = 1;      // set each frame by the Director
      this.time = 0;            // world clock (seconds simulated)
      this.fruitStamps = [];    // rolling 1s window of fruit drops
      this.stats = { shots: 0, hits: 0, kills: 0, fruit: 0, trees: 0, crates: 0, dmgDealt: 0, dmgTaken: 0, dmgShot: 0, dmgBody: 0 };

      // Optional callbacks wired by game.js.
      this.onKill = null; this.onHit = null; this.onShot = null;
      this.onTreeDestroyed = null; this.onBaseDestroyed = null; this.onBaseHit = null;
      this.onPickup = null; this.onFruit = null; this.onExplosion = null;
    }

    /* --------------------------------------------------------- factories -- */
    addBullet(o) {
      if (this.bullets.length >= CFG.WORLD.MAX_BULLETS) return null;
      const b = new W.Bullet(o);
      this.bullets.push(b);
      return b;
    }
    addParticle(x, y, o) {
      if (this.particles.length >= CFG.WORLD.MAX_PARTICLES) return null;
      const p = new W.Particle(Object.assign({ x, y }, o));
      this.particles.push(p);
      return p;
    }
    burst(x, y, n, o) {
      o = o || {};
      const rng = this.rng;
      for (let i = 0; i < n; i++) {
        const a = rng.angle(), sp = rng.range(o.spMin || 40, o.spMax || 220);
        this.addParticle(x, y, {
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: rng.range(o.lifeMin || 0.18, o.lifeMax || 0.5),
          r: rng.range(o.rMin || 2, o.rMax || 4.5),
          color: o.color || '#ffd7a0', glow: o.glow !== false, drag: o.drag,
        });
      }
    }
    addText(x, y, text, color, size) {
      this.texts.push(new W.FloatText({ x, y, text, color, size }));
    }
    /** Fruit throttle: a strict sliding one-second window plus a field cap.
        Without this, shredding the treeline with a minigun carpets the map in
        healing and the run becomes unloseable. */
    fruitAllowed() {
      if (this.fruits.length >= CFG.TREE.maxOnGround) return false;
      const cap = CFG.TREE.dropPerSec;
      const stamps = this.fruitStamps;
      while (stamps.length && this.time - stamps[0] > 1) stamps.shift();
      if (stamps.length >= cap) return false;
      stamps.push(this.time);
      return true;
    }

    addFruit(x, y, angle, rng) {
      const f = new W.Fruit({
        x, y,
        vx: Math.cos(angle) * CFG.FRUIT.popSpeed * rng.range(0.5, 1.2),
        vy: Math.sin(angle) * CFG.FRUIT.popSpeed * rng.range(0.5, 1.2),
      });
      this.fruits.push(f);
      return f;
    }
    addPickup(x, y, weaponId) {
      const p = new W.Pickup({ x, y, weaponId });
      this.pickups.push(p);
      return p;
    }
    addFighter(o) {
      const f = new W.Fighter(o);
      // Anything that steers gameplay goes through the world RNG so one seed
      // reproduces one run (the dev tools diff runs). Cosmetic jitter may vary.
      if (f.ai) f.ai.strafe = this.rng.sign();
      this.fighters.push(f);
      return f;
    }

    /* ------------------------------------------------------- map layout -- */
    build(seed) {
      this.rng = U.makeRng(seed);
      const rng = this.rng;
      this.bullets.length = this.fighters.length = this.trees.length = 0;
      this.fruits.length = this.pickups.length = this.particles.length = this.texts.length = 0;
      this.bases.length = 0; this.decor.length = 0;
      this.time = 0; this.fruitStamps.length = 0;
      this.difficulty = 1;
      this.stats = { shots: 0, hits: 0, kills: 0, fruit: 0, trees: 0, crates: 0, dmgDealt: 0, dmgTaken: 0, dmgShot: 0, dmgBody: 0 };

      const pad = 200;
      this.playerBase = new W.Base({ team: T.PLAYER, x: pad + CFG.BASE.half, y: this.h - pad - CFG.BASE.half });
      this.enemyBase = new W.Base({ team: T.ENEMY, x: this.w - pad - CFG.BASE.half, y: pad + CFG.BASE.half });
      this.bases.push(this.playerBase, this.enemyBase);

      // Trees: scattered, but never on top of a base or in a tight clump.
      const minGap = 78;
      let guard = 0;
      while (this.trees.length < CFG.TREE.count && guard++ < CFG.TREE.count * 60) {
        const x = rng.range(60, this.w - 60), y = rng.range(60, this.h - 60);
        if (U.dist2(x, y, this.playerBase.x, this.playerBase.y) < 300 * 300) continue;
        if (U.dist2(x, y, this.enemyBase.x, this.enemyBase.y) < 300 * 300) continue;
        let ok = true;
        for (const t of this.trees) if (U.dist2(x, y, t.x, t.y) < minGap * minGap) { ok = false; break; }
        if (!ok) continue;
        this.trees.push(new W.Tree({
          x, y,
          r: CFG.TREE.canopyR + rng.range(-CFG.TREE.canopyRVar, CFG.TREE.canopyRVar),
          fruitMax: rng.weighted([[3, 3], [4, 5], [5, 2]]),
        }));
      }

      // Static ground decor (purely visual, seeded so it is stable per run).
      for (let i = 0; i < 220; i++) {
        this.decor.push({
          x: rng.range(0, this.w), y: rng.range(0, this.h),
          r: rng.range(2, 9), a: rng.range(0.03, 0.1), kind: rng.int(3),
        });
      }
      return this;
    }

    /** Find a walkable spot near (x,y) that is clear of trees/bases. */
    openSpot(x, y, radius, tries) {
      const rng = this.rng;
      tries = tries || 24;
      for (let i = 0; i < tries; i++) {
        const a = rng.angle(), d = i === 0 ? 0 : rng.range(0, radius || 90);
        const px = U.clamp(x + Math.cos(a) * d, CFG.WORLD.PAD + 20, this.w - CFG.WORLD.PAD - 20);
        const py = U.clamp(y + Math.sin(a) * d, CFG.WORLD.PAD + 20, this.h - CFG.WORLD.PAD - 20);
        if (this.isBlocked(px, py, 18)) continue;
        return { x: px, y: py };
      }
      return { x: U.clamp(x, 40, this.w - 40), y: U.clamp(y, 40, this.h - 40) };
    }

    isBlocked(x, y, r) {
      for (const b of this.bases) if (U.dist2(x, y, b.x, b.y) < (b.r + r) * (b.r + r)) return true;
      for (const t of this.trees) {
        if (!t.blocksMove) continue;
        if (U.dist2(x, y, t.x, t.y) < (t.r * 0.72 + r) * (t.r * 0.72 + r)) return true;
      }
      return false;
    }

    /* ---------------------------------------------------------- queries --- */
    nearestEnemy(from, team, range, opts) {
      let best = null, bestD = range * range;
      for (const f of this.fighters) {
        if (f.dead || f.team === team) continue;
        if (opts && opts.skipPlayer && f.isPlayer) continue;
        if (opts && opts.skipBots && !f.isPlayer) continue;
        if (f.spawnGuard > 0 && !f.isPlayer) continue;
        const d = U.dist2(from.x, from.y, f.x, f.y);
        if (d < bestD) { bestD = d; best = f; }
      }
      return best;
    }

    /** Nearest hostile *base* within range (bases are always valid targets). */
    nearestEnemyBase(from, team, range) {
      let best = null, bestD = range * range;
      for (const b of this.bases) {
        if (b.team === team || !b.alive) continue;
        const d = U.dist2(from.x, from.y, b.x, b.y);
        if (d < bestD) { bestD = d; best = b; }
      }
      return best;
    }

    /* --------------------------------------------------------- broadphase -- */
    _rebuildGrid() {
      this.grid.clear();
      const cell = CFG.WORLD.GRID_CELL;
      const put = (e, kind) => {
        const r = (e.r || 10) + 4;
        const x0 = Math.floor((e.x - r) / cell), x1 = Math.floor((e.x + r) / cell);
        const y0 = Math.floor((e.y - r) / cell), y1 = Math.floor((e.y + r) / cell);
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
          const k = gx + ',' + gy;
          let a = this.grid.get(k);
          if (!a) { a = []; this.grid.set(k, a); }
          a.push(e);
        }
      };
      for (const f of this.fighters) if (!f.dead) put(f, 'fighter');
      for (const b of this.bases) if (b.alive) put(b, 'base');
      for (const t of this.trees) if (t.blocksBullet) put(t, 'tree');
    }

    query(x, y, r) {
      // Stamp-based dedupe: avoids an O(n^2) indexOf per query in a bullet storm.
      this._stamp = (this._stamp || 0) + 1;
      const st = this._stamp, cell = CFG.WORLD.GRID_CELL, out = [];
      const x0 = Math.floor((x - r) / cell), x1 = Math.floor((x + r) / cell);
      const y0 = Math.floor((y - r) / cell), y1 = Math.floor((y + r) / cell);
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const a = this.grid.get(gx + ',' + gy);
        if (!a) continue;
        for (const e of a) { if (e._stamp !== st) { e._stamp = st; out.push(e); } }
      }
      return out;
    }

    /* ------------------------------------------------------------ update -- */
    update(dt) {
      this.time += dt;
      const rng = this.rng;

      for (const b of this.bases) if (b.alive) b.update(dt, this, this.game);
      for (const f of this.fighters) if (!f.dead) f.update(dt, this);
      for (const t of this.trees) t.update(dt);
      for (const f of this.fruits) f.update(dt);
      for (const p of this.pickups) p.update(dt);
      for (const p of this.particles) p.update(dt);
      for (const t of this.texts) t.update(dt);
      for (const b of this.bullets) b.update(dt);

      this._rebuildGrid();
      this._resolveMovement();
      this._bullets();
      this._contacts();
      this._pickups();
      this._cull();
    }

    /** Push fighter `f` out of a solid circle at (cx,cy) and, if it is grinding
        head-first into the surface, convert that pressure into a sideways slide.
        Without this, walking straight at a tree or a bunker wedges you there. */
    _pushOut(f, cx, cy, min) {
      const d2 = U.dist2(f.x, f.y, cx, cy);
      if (d2 >= min * min || d2 < 0.0001) return false;
      const d = Math.sqrt(d2);
      const nx = (f.x - cx) / d, ny = (f.y - cy) / d;
      f.x = cx + nx * min; f.y = cy + ny * min;
      const vn = f.vx * nx + f.vy * ny;              // < 0 = pressing into the surface
      const tx = -ny, ty = nx;
      let vt = f.vx * tx + f.vy * ty;
      if (vn < 0 && Math.abs(vt) < Math.abs(vn) * 0.4) {
        if (!f.slipSign) f.slipSign = this.rng.sign();
        vt = f.slipSign * Math.abs(vn) * 0.9;
        f.vx = nx * vn * 0.1 + tx * vt;
        f.vy = ny * vn * 0.1 + ty * vt;
      }
      return true;
    }

    _resolveMovement() {
      const pad = CFG.WORLD.PAD;
      for (const f of this.fighters) {
        if (f.dead) continue;
        // walls
        f.x = U.clamp(f.x, pad + f.r, this.w - pad - f.r);
        f.y = U.clamp(f.y, pad + f.r, this.h - pad - f.r);
        // bases (hard circles)
        for (const b of this.bases) if (b.alive) this._pushOut(f, b.x, b.y, b.r + f.r);
        // trees (soft cover)
        for (const t of this.trees) {
          if (!t.blocksMove) continue;
          if (U.dist2(f.x, f.y, t.x, t.y) > 40000) continue;
          this._pushOut(f, t.x, t.y, t.r * 0.72 + f.r);
        }
      }
      // fighter-vs-fighter separation (cheap single pass, twice for stability)
      const fs = this.fighters;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < fs.length; i++) {
          const a = fs[i]; if (a.dead) continue;
          for (let j = i + 1; j < fs.length; j++) {
            const b = fs[j]; if (b.dead) continue;
            if (U.dist2(a.x, a.y, b.x, b.y) > 1600) continue;
            const min = a.r + b.r;
            const d2 = U.dist2(a.x, a.y, b.x, b.y);
            if (d2 >= min * min || d2 < 0.0001) continue;
            const d = Math.sqrt(d2), nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
            const push = (min - d) * 0.5;
            const aMass = a.isPlayer ? 0.25 : 1, bMass = b.isPlayer ? 0.25 : 1;
            a.x -= nx * push * aMass * 2; a.y -= ny * push * aMass * 2;
            b.x += nx * push * bMass * 2; b.y += ny * push * bMass * 2;
          }
        }
      }
    }

    _bullets() {
      for (const b of this.bullets) {
        if (b.dead) continue;
        const travel = U.dist(b.px, b.py, b.x, b.y);
        const mx = (b.px + b.x) / 2, my = (b.py + b.y) / 2;
        // Swept test: the bullet is a segment this frame, so fast rounds cannot
        // tunnel through thin targets at 60Hz.
        const near = this.query(mx, my, b.r + travel / 2 + 2);
        for (const e of near) {
          const isBase = e instanceof W.Base, isTree = e instanceof W.Tree;
          if (isBase) { if (e.team === b.team || !e.alive) continue; }
          else if (isTree) { if (!e.blocksBullet || e.dead) continue; }
          else if (e.team === b.team || e.dead) continue;
          const er = isBase ? e.r : isTree ? e.r * 0.8 : e.r;
          if (U.segDist2(e.x, e.y, b.px, b.py, b.x, b.y) > (b.r + er) * (b.r + er)) continue;
          const hit = U.segClosest(e.x, e.y, b.px, b.py, b.x, b.y);
          this._bulletImpact(b, e, isBase ? 'base' : isTree ? 'tree' : 'fighter', hit);
          break;
        }
        // world bounds
        if (b.x < 0 || b.y < 0 || b.x > this.w || b.y > this.h) b.dead = true;
      }
    }

    _bulletImpact(b, e, kind, hit) {
      if (b.hits) { if (b.hits.indexOf(e) >= 0) return; } else b.hits = [e];
      const hx = hit ? hit.x : b.x, hy = hit ? hit.y : b.y;
      b.x = hx; b.y = hy;

      if (kind === 'tree') {
        e.hit(b.dmg, this, this.rng);
        this.burst(hx, hy, 4, { color: '#4f9b66', spMin: 30, spMax: 120, lifeMin: .12, lifeMax: .3, rMin: 1.5, rMax: 3 });
        this.onTreeHit?.(b, e);
      } else if (kind === 'fighter') {
        const dealt = e.hurt(b.dmg, this, b.team);
        if (dealt > 0) {
          if (b.fromPlayer && !b.counted) { b.counted = true; this.stats.hits++; }
          if (b.fromPlayer) this.stats.dmgDealt += dealt;
          if (b.knock) {
            const s = Math.atan2(b.vy, b.vx);
            e.vx += Math.cos(s) * b.knock; e.vy += Math.sin(s) * b.knock;
          }
          this.burst(hx, hy, 3, { color: e.team === T.PLAYER ? '#ff9d9d' : '#c9f0ff', spMin: 40, spMax: 160, lifeMin: .1, lifeMax: .26, rMin: 1.5, rMax: 3 });
          if (e.isPlayer) { this.stats.dmgTaken += dealt; this.stats.dmgShot += dealt; }
        }
      } else if (kind === 'base') {
        const dealt = e.hurt(b.dmg, this, b.team);
        if (dealt > 0 && b.fromPlayer) this.stats.dmgDealt += dealt;
        this.burst(hx, hy, 5, { color: '#ffd08a', spMin: 40, spMax: 170, lifeMin: .12, lifeMax: .32 });
      }

      // splash
      if (b.splash > 0) {
        this.explode(hx, hy, b.splash, b.dmg * 0.7, b.team, b);
      }

      if (b.pierce > 0) { b.pierce--; }
      else b.dead = true;
    }

    explode(x, y, radius, dmg, team, src) {
      this.burst(x, y, 22, { color: '#ffb066', spMin: 60, spMax: 340, lifeMin: .2, lifeMax: .55, rMin: 3, rMax: 7 });
      this.burst(x, y, 10, { color: '#fff3c4', spMin: 20, spMax: 120, lifeMin: .1, lifeMax: .3, rMin: 4, rMax: 9 });
      this.addText(x, y - 12, 'BOOM', '#ffb066', 12);
      for (const f of this.fighters) {
        if (f.dead || f.team === team) continue;
        const d = U.dist(x, y, f.x, f.y);
        if (d > radius + f.r) continue;
        const falloff = U.clamp(1 - d / radius, 0.25, 1);
        const dealt = f.hurt(dmg * falloff, this, team);
        if (dealt > 0) {
          if (src && src.fromPlayer) this.stats.dmgDealt += dealt;
          const a = U.angleTo(x, y, f.x, f.y);
          f.vx += Math.cos(a) * 220 * falloff; f.vy += Math.sin(a) * 220 * falloff;
        }
      }
      for (const b of this.bases) {
        if (b.team === team || !b.alive) continue;
        if (U.dist(x, y, b.x, b.y) < radius + b.r) b.hurt(dmg * 0.6, this, team);
      }
      for (const t of this.trees) if (!t.dead && U.dist(x, y, t.x, t.y) < radius + t.r) t.hit(dmg * 0.4, this, this.rng);
      this.onExplosion?.(x, y, radius, src);
    }

    _contacts() {
      const fs = this.fighters;
      for (let i = 0; i < fs.length; i++) {
        const a = fs[i]; if (a.dead || a.contactCd > 0) continue;
        for (let j = 0; j < fs.length; j++) {
          if (i === j) continue;
          const b = fs[j];
          if (b.dead || b.team === a.team) continue;
          if (!U.circleHit(a.x, a.y, a.r, b.x, b.y, b.r)) continue;
          const dealt = b.hurt(CFG.BOT.contactDmg, this, a.team);
          a.contactCd = CFG.BOT.contactCd;
          if (dealt > 0 && b.isPlayer) this.stats.dmgBody += dealt;
          const ang = U.angleTo(a.x, a.y, b.x, b.y);
          b.vx += Math.cos(ang) * 160; b.vy += Math.sin(ang) * 160;
          if (dealt > 0) this.burst(b.x, b.y, 3, { color: '#ff8a8a', spMin: 30, spMax: 120, lifeMin: .1, lifeMax: .25 });
          break;
        }
      }
    }

    _pickups() {
      const fs = this.fighters;
      // Fruit: heals whoever touches it; player gets a magnet pull.
      for (const fr of this.fruits) {
        if (fr.dead) continue;
        for (const f of fs) {
          if (f.dead || f.magnet <= 0) continue;
          const pull = 46 * f.magnet;
          const d2 = U.dist2(f.x, f.y, fr.x, fr.y);
          if (d2 < pull * pull && d2 > 1) {
            const d = Math.sqrt(d2);
            const strength = 260 * f.magnet * (1 - d / pull);
            fr.vx += ((f.x - fr.x) / d) * strength * 0.06;
            fr.vy += ((f.y - fr.y) / d) * strength * 0.06;
          }
        }
        for (const f of fs) {
          if (f.dead || f.hp >= f.maxHp) continue;
          if (!U.circleHit(f.x, f.y, f.r, fr.x, fr.y, fr.r + 2)) continue;
          fr.dead = true;
          const healed = Math.min(fr.heal, f.maxHp - f.hp);
          f.hp += healed;
          this.stats.fruit++;
          this.addText(f.x, f.y - f.r - 6, '+' + healed, CFG.COLORS.hp, 13);
          this.burst(fr.x, fr.y, 6, { color: CFG.COLORS.fruit, spMin: 30, spMax: 130, lifeMin: .15, lifeMax: .4, rMin: 2, rMax: 4 });
          this.onFruit?.(f, healed);
          break;
        }
      }
      // Weapon crates (yours only — the enemy does not get to scale with you).
      for (const p of this.pickups) {
        if (p.dead) continue;
        for (const f of fs) {
          if (f.dead || !f.isPlayer) continue;
          if (!U.circleHit(f.x, f.y, f.r, p.x, p.y, p.r + 2)) continue;
          p.dead = true;
          this.stats.crates++;
          f.giveWeapon(p.weaponId, CFG.PICKUP.duration);
          this.addText(f.x, f.y - f.r - 10, W.Weapons.get(p.weaponId).name.toUpperCase(), CFG.COLORS.pickup, 13);
          this.burst(p.x, p.y, 12, { color: CFG.COLORS.pickup, spMin: 40, spMax: 200, lifeMin: .15, lifeMax: .45 });
          this.onPickup?.(f, p);
          break;
        }
      }
    }

    _cull() {
      const cull = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i].dead) arr.splice(i, 1); };
      cull(this.bullets); cull(this.particles); cull(this.texts);
      cull(this.fruits); cull(this.pickups);
      // Dead fighters are kept one frame for game.js to score, then removed.
      for (let i = this.fighters.length - 1; i >= 0; i--) {
        const f = this.fighters[i];
        if (f.dead && !f.isPlayer) this.fighters.splice(i, 1);
      }
    }
  }

  W.World = World;
})(window.WARS || (window.WARS = {}));