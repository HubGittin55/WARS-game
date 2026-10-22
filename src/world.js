/* WARS — the world: entity lists, broadphase grid, movement resolution, all
   bullet/tree/fruit/pickup collisions. Gameplay *decisions* (spawning, AI) live
   in director.js / ai.js / game.js; this file is physics + queries. */
(function (W) {
  'use strict';
  const U = W.Util;
  const CFG = W.Config;
  const T = CFG.TEAM;
  const C = CFG.COLORS;

  class World {
    constructor(game) {
      this.game = game;
      this.mode = CFG.MODE_DEFAULT;   // set by Game before build()
      this.rng = U.makeRng(1337);
      this.w = CFG.WORLD.W;
      this.h = CFG.WORLD.H;
      this.time = 0;
      this.bullets = [];
      this.fighters = [];
      this.tanks = [];
      this.trees = [];
      this.fruits = [];
      this.pickups = [];
      this.particles = [];
      this.texts = [];
      this.bases = [];
      this.decor = [];
      this.gore = [];        // blood / scorch decals (ground, oldest first)
      this.corpses = [];
      this.tracks = [];      // tank tread marks
      this.rings = [];       // expanding shockwave rings
      this.levelId = CFG.LEVELS[0].id;   // set by Game before build()
      this.grid = new Map();
      this.difficulty = 1;      // set each frame by the Director
      this.time = 0;            // world clock (seconds simulated)
      this.fruitStamps = [];    // rolling 1s window of fruit drops
      this.stats = { shots: 0, hits: 0, kills: 0, fruit: 0, trees: 0, crates: 0, dmgDealt: 0, dmgTaken: 0, dmgShot: 0, dmgBody: 0 };

      // Optional callbacks wired by game.js.
      this.onKill = null; this.onHit = null; this.onShot = null;
      this.onTreeDestroyed = null; this.onBaseDestroyed = null; this.onBaseHit = null;
      this.onPickup = null; this.onFruit = null; this.onExplosion = null;
      this.onTankDestroyed = null;
    }

    get modeCfg() { return CFG.MODES[this.mode] || CFG.MODES[CFG.MODE_DEFAULT]; }

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

    addTank(o) {
      if (this.tanks.length >= CFG.TANK.max) return null;
      const t = new W.Tank(o);
      this.tanks.push(t);
      return t;
    }

    /** Tank tread mark: a short dark segment the tank leaves as it rolls. */
    addTrack(x, y, a) {
      if (this.tracks.length >= 160) this.tracks.shift();
      this.tracks.push({ x, y, a, life: 14, t: 14 });
    }

    /* ------------------------------------------------- gore & violence --- */
    /** Blood splash + splat decal + tumbling chunks. `power` scales it all. */
    goreBurst(x, y, team, power) {
      power = power || 1;
      const blood = team === T.PLAYER ? C.bloodPlayer : C.bloodEnemy;
      if (this.gore.length < CFG.WORLD.MAX_GORE) {
        const segs = [];
        const n = Math.min(4 + Math.floor(power * 3), 9);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * U.TAU;
          const d = Math.random() * 14 * power;
          segs.push({
            dx: Math.cos(a) * d,
            dy: Math.sin(a) * d * 0.8,
            r: 2.5 + Math.random() * 5 * power,
            rot: Math.random() * Math.PI,
          });
        }
        this.gore.push(new W.Decal({
          x, y, segs,
          color: Math.random() < 0.6 ? blood : C.bloodDark,
          life: CFG.GORE.decalLife,
        }));
      }
      const chunks = Math.min(12, Math.floor(4 + power * 3));
      for (let i = 0; i < chunks; i++) {
        const a = Math.random() * U.TAU;
        const sp = 60 + Math.random() * 160 * power;
        this.addParticle(x, y, {
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 60 * power,   // upward kick; gravity brings it down
          life: 0.3 + Math.random() * 0.4,
          r: CFG.GORE.chunkMin + Math.random() * (CFG.GORE.chunkMax - CFG.GORE.chunkMin) * power,
          color: Math.random() < 0.7 ? blood : C.bloodDark,
          rect: true, grav: true,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 18,
          drag: 1.4,
        });
      }
    }

    /** A body that stays on the field a few seconds, then fades. */
    spawnCorpse(f) {
      if (this.corpses.length >= CFG.WORLD.MAX_CORPSES) this.corpses.shift();
      this.corpses.push(new W.Corpse({
        x: f.x, y: f.y, r: f.r,
        rot: f.aim || 0,
        bodyColor: f.team === T.PLAYER ? C.teamPlayer : C.teamEnemy,
        bloodColor: f.team === T.PLAYER ? C.bloodPlayer : C.bloodEnemy,
      }));
    }

    /** A charred scorch mark left by an explosion. */
    addScorch(x, y, r) {
      if (this.gore.length >= CFG.WORLD.MAX_GORE) return;
      const segs = [];
      for (let i = 0; i < 3; i++) {
        segs.push({
          dx: (Math.random() - 0.5) * r * 0.6,
          dy: (Math.random() - 0.5) * r * 0.6,
          r: r * (0.45 + Math.random() * 0.4),
          rot: Math.random() * Math.PI,
        });
      }
      this.gore.push(new W.Decal({ x, y, segs, color: C.scorch, kind: 'scorch', life: CFG.GORE.decalLife * 1.3 }));
    }

    /** Expanding ring — the visible pressure wave of an explosion. */
    addShockwave(x, y, maxR, color) {
      if (this.rings.length < 24) this.rings.push({ x, y, maxR, color: color || C.fire, t: 0.55, life: 0.55 });
    }

    updateShockwaves(dt) {
      for (const r of this.rings) r.t -= dt;
      for (let i = this.rings.length - 1; i >= 0; i--) if (this.rings[i].t <= 0) this.rings.splice(i, 1);
    }

    drawShockwaves(ctx) {
      for (const r of this.rings) {
        const k = 1 - r.t / r.life;              // 0 -> 1 over the life
        const ease = 1 - (1 - k) * (1 - k);
        ctx.globalAlpha = (1 - ease) * 0.55;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 3 + (1 - ease) * 5;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 8 + (r.maxR - 8) * ease, 0, U.TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    /* ------------------------------------------------------- map layout -- */
    build(seed) {
      this.rng = U.makeRng(seed);
      const rng = this.rng;
      this.bullets.length = this.fighters.length = this.trees.length = this.tanks.length = 0;
      this.fruits.length = this.pickups.length = this.particles.length = this.texts.length = 0;
      this.bases.length = 0; this.decor.length = 0;
      this.gore.length = 0; this.corpses.length = 0; this.rings.length = 0; this.tracks.length = 0;
      this.time = 0; this.fruitStamps.length = 0;
      this.difficulty = 1;
      this.stats = { shots: 0, hits: 0, kills: 0, fruit: 0, trees: 0, crates: 0, dmgDealt: 0, dmgTaken: 0, dmgShot: 0, dmgBody: 0 };

      const pad = 200;
      const baseHp = Math.round(CFG.BASE.hp * this.modeCfg.baseHp);
      this.playerBase = new W.Base({ team: T.PLAYER, x: pad + CFG.BASE.half, y: this.h - pad - CFG.BASE.half, hp: baseHp });
      this.enemyBase = new W.Base({ team: T.ENEMY, x: this.w - pad - CFG.BASE.half, y: pad + CFG.BASE.half, hp: baseHp });
      this.bases.push(this.playerBase, this.enemyBase);

      // Trees: the chosen map pattern (Config.LEVELS). Never on a base.
      this._placeTrees(rng);

      // Static ground decor (purely visual, seeded so it is stable per run).
      for (let i = 0; i < 220; i++) {
        this.decor.push({
          x: rng.range(0, this.w), y: rng.range(0, this.h),
          r: rng.range(2, 9), a: rng.range(0.03, 0.1), kind: rng.int(3),
        });
      }
      return this;
    }

    /** Place the treeline for the selected map pattern (scatter / ring / lanes /
        forest / quarters). Bases stay clear; near-overlaps get thinned out. */
    _placeTrees(rng) {
      const lv = CFG.LEVELS.find((l) => l.id === this.levelId) || CFG.LEVELS[0];
      const n = lv.trees || CFG.TREE.count;
      const cx = this.w / 2, cy = this.h / 2;
      const baseKeep = 300 * 300;
      const add = (x, y) => {
        x = U.clamp(x, 60, this.w - 60);
        y = U.clamp(y, 60, this.h - 60);
        if (U.dist2(x, y, this.playerBase.x, this.playerBase.y) < baseKeep) return;
        if (U.dist2(x, y, this.enemyBase.x, this.enemyBase.y) < baseKeep) return;
        this.trees.push(new W.Tree({
          x, y,
          r: CFG.TREE.canopyR + rng.range(-CFG.TREE.canopyRVar, CFG.TREE.canopyRVar),
          fruitMax: rng.weighted([[3, 3], [4, 5], [5, 2]]),
        }));
      };
      const pat = lv.pattern;
      if (pat === 'ring') {
        const radii = [240, 330, 420];
        for (let i = 0; i < n; i++) {
          const a = rng.angle();
          const r = radii[i % radii.length] + rng.range(-26, 26);
          add(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.72);  // elliptical: arena is wider than tall
        }
      } else if (pat === 'lanes') {
        const lines = [cx - 330, cx, cx + 330];
        for (let i = 0; i < n; i++) {
          const x = lines[i % lines.length] + rng.range(-42, 42);
          add(x, rng.range(90, this.h - 90));
        }
      } else if (pat === 'forest') {
        const cs = [];
        for (let i = 0; i < 6; i++) cs.push({ x: rng.range(180, this.w - 180), y: rng.range(180, this.h - 180) });
        for (let i = 0; i < n; i++) {
          if (i < n * 0.65) { const c = cs[i % cs.length]; add(c.x + rng.range(-180, 180), c.y + rng.range(-180, 180)); }
          else add(rng.range(60, this.w - 60), rng.range(60, this.h - 60));
        }
      } else if (pat === 'quarters') {
        const qs = [[cx - 330, cy - 300], [cx + 330, cy - 300], [cx - 330, cy + 300], [cx + 330, cy + 300]];
        for (let i = 0; i < n; i++) {
          const q = qs[i % 4];
          add(q[0] + rng.range(-130, 130), q[1] + rng.range(-130, 130));
        }
      } else {  // scatter (classic)
        const minGap = 78;
        let guard = 0;
        while (this.trees.length < n && guard++ < n * 60) {
          const x = rng.range(60, this.w - 60), y = rng.range(60, this.h - 60);
          if (U.dist2(x, y, this.playerBase.x, this.playerBase.y) < baseKeep) continue;
          if (U.dist2(x, y, this.enemyBase.x, this.enemyBase.y) < baseKeep) continue;
          let ok = true;
          for (const t of this.trees) if (U.dist2(x, y, t.x, t.y) < minGap * minGap) { ok = false; break; }
          if (!ok) continue;
          add(x, y);
        }
      }
      // thin near-overlaps left by the pattern generators
      const minD2 = 42 * 42;
      for (let i = this.trees.length - 1; i >= 0; i--) {
        for (let j = 0; j < i; j++) {
          if (U.dist2(this.trees[i].x, this.trees[i].y, this.trees[j].x, this.trees[j].y) < minD2) {
            this.trees.splice(i, 1);
            break;
          }
        }
      }
      // top up to the target count so each map delivers its advertised density
      {
        const minGap = 46;
        let guard = 0;
        while (this.trees.length < n && guard++ < (n - this.trees.length) * 400 + 200) {
          const x = rng.range(60, this.w - 60), y = rng.range(60, this.h - 60);
          if (U.dist2(x, y, this.playerBase.x, this.playerBase.y) < baseKeep) continue;
          if (U.dist2(x, y, this.enemyBase.x, this.enemyBase.y) < baseKeep) continue;
          let ok = true;
          for (const t of this.trees) if (U.dist2(x, y, t.x, t.y) < minGap * minGap) { ok = false; break; }
          if (!ok) continue;
          add(x, y);
        }
      }
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
      // Tanks are targetable too (bots and base turrets can shoot at them).
      for (const tk of this.tanks) {
        if (tk.dead || tk.team === team) continue;
        const d = U.dist2(from.x, from.y, tk.x, tk.y);
        if (d < bestD) { bestD = d; best = tk; }
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
      for (const tk of this.tanks) if (!tk.dead) put(tk, 'tank');
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
      for (const g of this.gore) g.update(dt);
      for (const c of this.corpses) c.update(dt);
      // tanks: run, then score any that died this frame (the explosion is the game's call)
      for (const tk of this.tanks) {
        if (!tk.dead) tk.update(dt, this);
        else if (!tk.scored) { tk.scored = true; this.onTankDestroyed?.(tk); }
      }
      for (let i = this.tanks.length - 1; i >= 0; i--) if (this.tanks[i].dead) this.tanks.splice(i, 1);
      for (const tr of this.tracks) tr.t -= dt;
      for (let i = this.tracks.length - 1; i >= 0; i--) if (this.tracks[i].t <= 0) this.tracks.splice(i, 1);
      this.updateShockwaves(dt);

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
      // tanks: same solids, but they are vehicles — trees bend, they do not
      for (const tk of this.tanks) {
        if (tk.dead) continue;
        tk.x = U.clamp(tk.x, pad + tk.r * 0.8, this.w - pad - tk.r * 0.8);
        tk.y = U.clamp(tk.y, pad + tk.r * 0.8, this.h - pad - tk.r * 0.8);
        for (const b of this.bases) if (b.alive && b.team !== tk.team) this._pushOut(tk, b.x, b.y, b.r + tk.r * 0.8);
        for (const t of this.trees) {
          if (!t.blocksMove) continue;
          if (U.dist2(tk.x, tk.y, t.x, t.y) > 40000) continue;
          this._pushOut(tk, t.x, t.y, t.r * 0.6 + tk.r * 0.8);
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
          const isBase = e instanceof W.Base, isTree = e instanceof W.Tree, isTank = e instanceof W.Tank;
          if (isBase) { if (e.team === b.team || !e.alive) continue; }
          else if (isTree) { if (!e.blocksBullet || e.dead) continue; }
          else if (e.team === b.team || e.dead) continue;
          const er = isBase ? e.r : isTree ? e.r * 0.8 : e.r;
          if (U.segDist2(e.x, e.y, b.px, b.py, b.x, b.y) > (b.r + er) * (b.r + er)) continue;
          const hit = U.segClosest(e.x, e.y, b.px, b.py, b.x, b.y);
          this._bulletImpact(b, e, isBase ? 'base' : isTree ? 'tree' : isTank ? 'tank' : 'fighter', hit);
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
      } else if (kind === 'tank') {
        const dealt = e.hurt(b.dmg, this, b.team);
        if (dealt > 0) {
          if (b.fromPlayer) this.stats.dmgDealt += dealt;
          this.burst(hx, hy, 3, { color: '#ffd08a', spMin: 30, spMax: 130, lifeMin: .1, lifeMax: .25, rMin: 1, rMax: 2.5 });
        }
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
      for (const tk of this.tanks) {
        if (tk.dead || tk.team === team) continue;
        const d = U.dist(x, y, tk.x, tk.y);
        if (d > radius + tk.r) continue;
        const falloff = U.clamp(1 - d / radius, 0.25, 1);
        tk.hurt(dmg * falloff, this, team);
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
      cull(this.gore); cull(this.corpses);
      // Dead fighters are kept one frame for game.js to score, then removed.
      for (let i = this.fighters.length - 1; i >= 0; i--) {
        const f = this.fighters[i];
        if (f.dead && !f.isPlayer) this.fighters.splice(i, 1);
      }
    }
  }

  W.World = World;
})(window.WARS || (window.WARS = {}));