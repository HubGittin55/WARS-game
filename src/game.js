/* WARS — game state machine + player controller + scoring.
   States: title -> playing <-> paused / levelup -> won | lost. */
(function (W) {
  'use strict';
  const U = W.Util;
  const CFG = W.Config;
  const C = CFG.COLORS;
  const T = CFG.TEAM;

  class Game {
    constructor(opts) {
      opts = opts || {};
      this.audio = opts.audio || new W.Audio();
      this.world = new W.World(this);
      this.camera = new W.Camera(CFG.WORLD.W, CFG.WORLD.H, CFG.VIEW.W, CFG.VIEW.H);
      this.ui = new W.UI(this);
      this.director = new W.Director(this);
      this.state = 'title';
      this.time = 0;
      this.level = 1; this.xp = 0; this.xpNeed = 0;
      this.cards = [];
      this.respawnT = 0;
      this.deaths = 0;
      this.hurtFlash = this.healFlash = 0;
      this.aimMode = 'auto';
      this.player = null;
      this.mode = this._loadMode();
      this.levelId = this._loadLevel();
      this.control = this._loadControl();
      this.moveTarget = null;   // mouse-control destination (world coords)
      this.world.mode = this.mode;
      this.world.levelId = this.levelId;
      this.squad = [];        // soldier fighters (game-owned; world culls them on death)
      this.squadResp = [];    // per-slot respawn timer
      this.squadUp = { dmg: 0, rate: 0, hp: 0 };
      this.tanks = [];
      this._tankResp = 0;
      this.best = this._loadBest();
      this._wireWorld();
      this.reset(opts.seed || (Date.now() & 0xffff));
    }

    /* ----------------------------------------------------------- helpers --- */
    /** Stereo-pan + distance-attenuation options for a sound at a world point. */
    _soundOpts(x, y) {
      const c = this.camera;
      const dx = x - (c.x + c.w / 2);
      const dy = y - (c.y + c.h / 2);
      return { pan: U.clamp(dx / CFG.AUDIO.panRange, -1, 1), dist: Math.hypot(dx, dy) };
    }

/* ----------------------------------------------------------- setup --- */
    _wireWorld() {
      const w = this.world, a = this.audio;
      w.onShot = (shooter, weapon) => {
        if (!this.camera.visible(shooter.x, shooter.y, 200)) return;
        const own = shooter.team === T.PLAYER;
        a.play(weapon.sound || 'shootPistol', { vol: own ? 1 : 0.45, ...this._soundOpts(shooter.x, shooter.y) });
        if (own) this.camera.addShake(weapon.id === 'rocket' ? 0.16 : weapon.id === 'shotgun' ? 0.1 : 0.03);
      };
      w.onHit = (f, dmg) => {
        a.play('hit', this._soundOpts(f.x, f.y));
        if (f.isPlayer) { this.hurtFlash = 1; this.camera.addShake(0.22); }
      };
      w.onKill = (f, srcTeam) => {
        const m = this.modeCfg;
        const violence = m.violence || 1;
        const isElite = f.type === 'elite';
        // Violence: blood splash + splat decal + tumbling chunks (capped in world).
        w.goreBurst(f.x, f.y, f.team, (isElite ? 1.6 : 1) * violence);
        w.spawnCorpse(f);
        w.burst(f.x, f.y, 16, { color: f.team === T.PLAYER ? C.teamPlayer : C.teamEnemy, spMin: 60, spMax: 260, lifeMin: .2, lifeMax: .55 });
        a.play('kill', this._soundOpts(f.x, f.y));
        a.play('squish', { vol: 0.7, ...this._soundOpts(f.x, f.y) });
        if (isElite) a.play('chunk', this._soundOpts(f.x, f.y));
        if (f.isPlayer) { this._playerDown(); return; }
        if (f.team === T.ENEMY) {
          // XP from any enemy death, credited kills only if you (or your base)
          // landed the finishing blow. Easier modes pay more XP per kill.
          this.addXp(f.xpValue * (m.xp || 1));
          if (srcTeam === T.PLAYER) {
            w.stats.kills++;
            w.addText(f.x, f.y - 18, '+' + Math.round(f.xpValue * (m.xp || 1)) + ' XP', C.accent, 11);
          }
        }
        this.camera.addShake((isElite ? 0.18 : 0.08) * violence);
      };
      w.onTreeHit = () => a.play('tree');
      w.onTreeDestroyed = () => { w.stats.trees++; };
      w.onFruit = (f) => {
        a.play('fruit', this._soundOpts(f.x, f.y));
        if (f.isPlayer) { this.healFlash = 1; }
      };
      w.onPickup = (f) => { if (f.isPlayer) a.play('pickup', { vol: 0.7 }); };
      w.onExplosion = (x, y) => {
        const violence = this.modeCfg.violence || 1;
        a.play('explode', this._soundOpts(x, y));
        if (this.camera.visible(x, y, 200)) this.camera.addShake(0.3 * violence);
        w.addScorch(x, y, 30);
        w.addShockwave(x, y, 110, C.fire);
      };
      w.onBaseHit = (b) => {
        a.play('hit', { vol: 0.8, ...this._soundOpts(b.x, b.y) });
        if (b.team === T.PLAYER) { this.hurtFlash = Math.max(this.hurtFlash, 0.5); this.camera.addShake(0.14 * (this.modeCfg.violence || 1)); }
        else this.camera.addShake(0.05);
        // a badly wounded base keeps crackling, and the bunker starts sounding the alarm
        if (b.hp / b.maxHp < 0.5 && Math.random() < 0.18) a.play('fire', { vol: 0.5 });
        if (b.team === T.PLAYER && b.hp / b.maxHp < 0.45) a.play('alarm', { minGap: 3.5 });
      };
      w.onBaseDestroyed = (b) => {
        w.burst(b.x, b.y, 60, { color: '#ffb066', spMin: 80, spMax: 520, lifeMin: .3, lifeMax: 1.1, rMin: 4, rMax: 10 });
        w.goreBurst(b.x, b.y, b.team, 2.2);
        w.addScorch(b.x - 40, b.y - 40, 46);
        w.addScorch(b.x + 44, b.y + 30, 40);
        w.addShockwave(b.x, b.y, 170, '#ffd9a0');
        w.explode(b.x, b.y, 220, 0, T.ENEMY === b.team ? T.PLAYER : T.ENEMY);
        this.camera.addShake(1.2 * (this.modeCfg.violence || 1));
        a.play('explode');
        a.play('chunk');
        this._end(b.team === T.ENEMY);
      };
      w.onTankDestroyed = (tk) => {
        const violence = this.modeCfg.violence || 1;
        w.burst(tk.x, tk.y, 44, { color: '#ffb066', spMin: 80, spMax: 460, lifeMin: .3, lifeMax: .9, rMin: 3, rMax: 8 });
        w.burst(tk.x, tk.y, 12, { color: '#fff3c4', spMin: 20, spMax: 140, lifeMin: .15, lifeMax: .4, rMin: 4, rMax: 9 });
        w.goreBurst(tk.x, tk.y, T.PLAYER, 1.6 * violence);
        w.addScorch(tk.x, tk.y, 56);
        w.addShockwave(tk.x, tk.y, 160, '#ffd9a0');
        a.play('explode', this._soundOpts(tk.x, tk.y));
        a.play('chunk', this._soundOpts(tk.x, tk.y));
        this.camera.addShake(0.9 * violence);
        this.ui.flashBanner('TANK LOST', C.teamEnemy);
        this.tanks = this.tanks.filter((t) => t !== tk);
        this._tankResp = 30;   // a replacement rolls in if the level still allows it
      };
    }

    /* ----------------------------------------------------------- modes --- */
    _loadMode() {
      try {
        const m = localStorage.getItem('wars_mode');
        if (m && CFG.MODES[m]) return m;
      } catch (e) {}
      return CFG.MODE_DEFAULT;
    }
    get modeCfg() { return CFG.MODES[this.mode] || CFG.MODES[CFG.MODE_DEFAULT]; }
    get playerBase() { return this.world.playerBase; }
    get enemyBase() { return this.world.enemyBase; }
    _tankUnlockLevel() { return CFG.TANK.unlockLevel; }
    _squadMax() { return CFG.SQUAD.max; }
    setMode(m) {
      if (!CFG.MODES[m]) return false;
      if (m === this.mode) return true;
      this.mode = m;
      this.world.mode = m;
      try { localStorage.setItem('wars_mode', m); } catch (e) {}
      return true;
    }

    /* --------------------------------------------------------- control --- */
    _loadControl() {
      try {
        const c = localStorage.getItem('wars_control');
        if (c && CFG.CONTROLS.some((x) => x.id === c)) return c;
      } catch (e) {}
      return CFG.CONTROL_DEFAULT;
    }
    setControl(id) {
      if (!CFG.CONTROLS.some((x) => x.id === id)) return false;
      if (id === this.control) return true;
      this.control = id;
      this.moveTarget = null;
      try { localStorage.setItem('wars_control', id); } catch (e) {}
      const ctl = CFG.CONTROLS.find((x) => x.id === id);
      this.ui.flashBanner('CONTROL ' + ctl.label, C.text);
      this.audio.play('pickup');
      return true;
    }

    /* ----------------------------------------------------------- level --- */
    _loadLevel() {
      try {
        const l = localStorage.getItem('wars_level');
        if (l && CFG.LEVELS.some((x) => x.id === l)) return l;
      } catch (e) {}
      return CFG.LEVELS[0].id;
    }
    setLevel(id) {
      if (!CFG.LEVELS.some((x) => x.id === id)) return false;
      if (id === this.levelId) return true;
      this.levelId = id;
      this.world.levelId = id;
      try { localStorage.setItem('wars_level', id); } catch (e) {}
      const lv = CFG.LEVELS.find((x) => x.id === id);
      this.ui.flashBanner(lv.name, C.text);
      this.audio.play('pickup');
      return true;
    }

    reset(seed) {
      this.world.mode = this.mode;
      this.world.levelId = this.levelId;
      this.world.build(seed);
      this.time = 0;
      this.level = 1; this.xp = 0;
      this.xpNeed = this._xpFor(2);
      this.cards = [];
      this.respawnT = 0;
      this.deaths = 0;
      this.moveTarget = null;
      this.hurtFlash = this.healFlash = 0;
      this.squad = [];
      this.squadResp = [];
      this.squadUp = { dmg: 0, rate: 0, hp: 0 };
      this.tanks = [];
      this._tankResp = 0;
      this.director.reset();
      this.ui.bannerT = 0;

      const pb = this.world.playerBase;
      const spot = this.world.openSpot(pb.x + 90, pb.y - 60, 40, 12);
      this.player = this.world.addFighter({
        team: T.PLAYER, isPlayer: true, x: spot.x, y: spot.y,
        hp: Math.max(20, CFG.PLAYER.hp + this.modeCfg.playerHp),
        speed: CFG.PLAYER.speed * (this.modeCfg.playerSpeed || 1),
        r: CFG.PLAYER.r,
      });
      this.camera.snapTo(this.player);

      // Deploy the starting squad around you.
      for (let i = 0; i < CFG.SQUAD.start; i++) {
        const a = this.world.rng.angle();
        const r = CFG.SQUAD.formationR;
        const s = this.world.openSpot(spot.x + Math.cos(a) * r, spot.y + Math.sin(a) * r, 30, 8);
        this._spawnSoldier(i, s.x, s.y);
      }

      this.state = 'title';
      return this;
    }

    restart() { this.reset((Date.now() & 0xffff)); this.start(); }
    start() {
      this.audio.unlock();
      if (this.state === 'title') { this.state = 'playing'; this.ui.flashBanner('GO', C.hp); }
    }

    _xpFor(level) { return Math.round(CFG.XP.levelBase * Math.pow(CFG.XP.levelGrowth, level - 1)); }

    /* --------------------------------------------------- squad & tanks --- */
    _spawnSoldier(i, x, y) {
      const t = W.AI.typeInfo('soldier');
      const f = this.world.addFighter({
        team: T.PLAYER, type: 'soldier', x, y,
        hp: Math.round(t.hp * (1 + 0.15 * this.squadUp.hp)),
        speed: t.speed, r: t.r,
        weaponId: t.weapon,
        spawnGuard: 0.9,
      });
      f.ai.slot = i;
      this._applySquadStats(f);
      this.squad[i] = f;
      this.squadResp[i] = 0;
      this.world.addText(x, y - 16, 'SOLDIER', C.teamPlayer, 11);
      return f;
    }

    /** Recruit one more soldier (Reinforcements card; squad capped at SQUAD.max). */
    _recruit() {
      if (this.squad.length >= CFG.SQUAD.max) return false;
      const i = this.squad.length;
      const pb = this.world.playerBase;
      const a = this.world.rng.angle();
      const s = this.world.openSpot(pb.x + Math.cos(a) * 200, pb.y + Math.sin(a) * 200, 30, 8);
      this._spawnSoldier(i, s.x, s.y);
      this.ui.flashBanner('REINFORCEMENTS', C.teamPlayer);
      this.audio.play('pickup');
      return true;
    }

    /** Re-derive every live soldier's stats from the squad upgrade tiers. */
    _applySquadStats(f) {
      const t = W.AI.typeInfo('soldier');
      f.dmgMul = 1 + 0.12 * this.squadUp.dmg;
      f.armor = Math.min(0.5, 0.1 * this.squadUp.hp);
      f.maxHp = Math.round(t.hp * (1 + 0.15 * this.squadUp.hp));
      f.hp = Math.min(f.hp, f.maxHp);
    }

    bumpSquad(stat) {
      this.squadUp[stat] = Math.min(4, (this.squadUp[stat] || 0) + 1);
      for (const f of this.squad) if (f && !f.dead) this._applySquadStats(f);
      this.world.addText(this.world.playerBase.x, this.world.playerBase.y - 90, 'SQUAD UPGRADED', C.accent, 13);
    }

    _updateSquad(dt) {
      const S = CFG.SQUAD;
      for (let i = 0; i < this.squad.length; i++) {
        const f = this.squad[i];
        if (!f.dead) continue;
        if (!f._respStarted) { f._respStarted = true; this.squadResp[i] = S.respawn; }
        this.squadResp[i] -= dt;
        if (this.squadResp[i] <= 0) {
          const anchor = this.player && !this.player.dead ? this.player : this.world.playerBase;
          if (!anchor || !anchor.alive) continue;
          const r = anchor === this.world.playerBase ? 140 : S.formationR + 30;
          const a = this.world.rng.angle();
          const s = this.world.openSpot(anchor.x + Math.cos(a) * r, anchor.y + Math.sin(a) * r, 30, 8);
          this._spawnSoldier(i, s.x, s.y);
          this.audio.play('pickup', { vol: 0.5 });
        }
      }
    }

    deployTank() {
      const TANK = CFG.TANK;
      if (this.tanks.length >= TANK.max) return false;
      const pb = this.world.playerBase;
      const a = this.world.rng.angle();
      const s = this.world.openSpot(pb.x + Math.cos(a) * 300, pb.y + Math.sin(a) * 300, 80, 10);
      const tk = this.world.addTank({ team: T.PLAYER, x: s.x, y: s.y, aim: U.angleTo(s.x, s.y, this.world.enemyBase.x, this.world.enemyBase.y) });
      if (!tk) return false;
      this.tanks.push(tk);
      this.ui.flashBanner('TANK DEPLOYED', C.accent);
      this.audio.play('chunk', { vol: 0.8, ...this._soundOpts(s.x, s.y) });
      this.audio.play('pickup', this._soundOpts(s.x, s.y));
      this.world.addShockwave(s.x, s.y, 110, C.teamPlayer);
      this.world.burst(s.x, s.y, 18, { color: C.teamPlayer, spMin: 40, spMax: 200, lifeMin: .2, lifeMax: .5 });
      return true;
    }

    _updateTanks(dt) {
      if (this._tankResp > 0) {
        this._tankResp -= dt;
        if (this._tankResp <= 0 && this.level >= CFG.TANK.unlockLevel && this.tanks.length < CFG.TANK.max) this.deployTank();
      }
    }

    /** Take the i-th level-up card, resume the sim. Returns false if there is no such card. */
    takeCard(i) {
      const card = this.cards[i];
      if (!card) return false;
      W.Upgrades.take(this, this.player, card);
      this.cards = [];
      this.state = 'playing';
      this.ui.flashBanner(card.name.toUpperCase(), CFG.COLORS.accent);
      this.audio.play('pickup');
      return true;
    }

    addXp(n) {
      this.xp += n;
      while (this.xp >= this.xpNeed) {
        this.xp -= this.xpNeed;
        this.level++;
        this.xpNeed = this._xpFor(this.level);
        this.cards = W.Upgrades.roll(this.player, CFG.XP.cards, this.world.rng, this);
        if (this.cards.length) {
          this.state = 'levelup';
          this.audio.play('levelup');
        } else {
          // Nothing left to pick: just heal as a consolation.
          this.player.hp = Math.min(this.player.maxHp, this.player.hp + 30);
        }
      }
    }

    _playerDown() {
      this.deaths++;
      this.respawnT = CFG.PLAYER.respawn;
      this.audio.play('hurt');
      this.camera.addShake(0.6 * (this.modeCfg.violence || 1));
      this.ui.flashBanner('YOU ARE DOWN', C.teamEnemy);
      // Downed player leaves the fighter list conceptually; keep object for respawn.
      // (Gore + squish sound are fired from onKill, which runs first.)
      this.player.dead = true;
    }

    _respawn() {
      const pb = this.world.playerBase;
      const spot = this.world.openSpot(pb.x + 90, pb.y - 60, 50, 14);
      const p = this.player;
      p.dead = false;
      p.x = spot.x; p.y = spot.y;
      p.vx = p.vy = 0;
      p.hp = p.maxHp;
      p.iframes = 0; p.spawnGuard = 1.4;
      p.weaponId = 'pistol'; p.weaponTime = 0;
      p.aim = Math.atan2(this.world.enemyBase.y - spot.y, this.world.enemyBase.x - spot.x);
      this.camera.snapTo(p);
      this.world.burst(p.x, p.y, 14, { color: C.teamPlayer, spMin: 40, spMax: 180, lifeMin: .2, lifeMax: .5 });
    }

    _end(won) {
      if (this.state === 'won' || this.state === 'lost') return;
      this.state = won ? 'won' : 'lost';
      this.audio.play(won ? 'win' : 'lose');
      if (won) this._saveBest();
    }

    _loadBest() {
      try { return JSON.parse(localStorage.getItem('wars.best') || 'null'); } catch (e) { return null; }
    }
    _saveBest() {
      const s = this.world.stats;
      const run = { time: this.time, kills: s.kills, level: this.level, won: true };
      const better = !this.best || run.kills > this.best.kills;
      if (better) { try { localStorage.setItem('wars.best', JSON.stringify(run)); } catch (e) {} this.best = run; }
    }

    /* ---------------------------------------------------------- update --- */
    update(dt, input) {
      this.ui.update(dt);
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
      this.healFlash = Math.max(0, this.healFlash - dt * 2.2);

      if (this.state === 'title' || this.state === 'paused') return;
      if (this.state === 'won' || this.state === 'lost') {
        // Let the world keep simulating for the fireworks.
        this.world.update(dt);
        this.camera.update(dt, this.world.playerBase, null);
        return;
      }
      if (this.state === 'levelup') return;   // frozen world while you pick

      this.time += dt;
      this.addXp(CFG.XP.perSecond * dt);
      this._playerControl(dt, input);
      W.AI.update(dt, this.world, this);
      this.director.update(dt);
      this.world.update(dt);
      this._updateSquad(dt);
      this._updateTanks(dt);

      if (this.respawnT > 0) {
        this.respawnT -= dt;
        if (this.respawnT <= 0) { this.respawnT = 0; this._respawn(); }
      }

      const camTarget = this.player.dead ? this.world.playerBase : this.player;
      this.camera.update(dt, camTarget, this.aimPoint);

      // Music intensity: title bed -> combat -> heat is on -> base under fire.
      let inten = 0;
      if (this.state === 'playing') {
        const pb = this.world.playerBase;
        let foe = 0;
        for (const f of this.world.fighters) if (!f.dead && f.team === T.ENEMY) foe++;
        inten = (pb.hp / pb.maxHp < 0.3 || foe > 16) ? 3 : foe > 9 ? 2 : 1;
      }
      this.audio.setIntensity(inten);

      // A wounded player hears his own heartbeat.
      if (this.player && !this.player.dead && this.player.hp / this.player.maxHp < 0.3) {
        this.audio.play('heartbeat', { minGap: 0.8 });
      }
    }

    /* -------------------------------------------------- player control --- */
    _playerControl(dt, input) {
      const p = this.player;
      if (!p || p.dead) return;

      const mouseControl = this.control === 'mouse';

      // --- movement ------------------------------------------------------
      let mv;
      if (mouseControl) {
        // Click-to-move: while the left button is held the destination tracks
        // the cursor (hold to guide); after a plain click the last destination
        // sticks, so the fighter keeps walking there until he arrives.
        if (input.mouse.left && input.mouse.inside && this.view) {
          this.moveTarget = input.toWorld(this.view, this.camera);
        }
        mv = { x: 0, y: 0, m: 0 };
        if (this.moveTarget) {
          const dx = this.moveTarget.x - p.x, dy = this.moveTarget.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d <= Math.max(p.r + 6, 18)) this.moveTarget = null;
          else mv = { x: dx / d, y: dy / d, m: 1 };
        }
      } else {
        this.moveTarget = null;
        mv = input.moveVector();
      }
      // Dash first: while it is running we must not fight its velocity.
      if (input.pressedAction('dash') || input.pad.dash) p.tryDash(mv.x, mv.y, this.world);
      if (p.dashT <= 0) {
        const sp = p.baseSpeed * p.speedMul;
        const k = Math.min(1, dt * 12);
        p.vx += (mv.x * sp - p.vx) * k;
        p.vy += (mv.y * sp - p.vy) * k;
      }

      // --- aim ---------------------------------------------------------
      // In mouse-control mode the mouse is busy steering, so the gun always
      // auto-aims (a gamepad aim stick still overrides).
      const useMouse = !mouseControl && ((input.moveMode === 'mouse' && input.mouse.inside) || (input.pad.ax || input.pad.ay));
      let aim = null;
      if (useMouse) {
        const wpt = input.toWorld(this.view, this.camera);
        this.aimPoint = wpt;
        aim = U.angleTo(p.x, p.y, wpt.x, wpt.y);
        this.aimMode = input.pad.ax || input.pad.ay ? 'stick' : 'mouse';
      } else {
        // Context auto-aim: pick the closest hostile *edge* — including the enemy
        // base, so walking into their bunker means you start pounding it.
        // Snap rule: a target only counts if it sits within +/- autoAimSnapDeg
        // of the current aim line; anything wider is ignored and the gun holds
        // its line instead of yanking across the screen.
        const snap = (CFG.PLAYER.autoAimSnapDeg || 10) * Math.PI / 180;
        const inCone = (ang) => Math.abs(U.angleDiff(p.aim, ang)) <= snap;
        const eb = this.world.enemyBase;
        const foe = this.world.nearestEnemy(p, p.team, p.aimRange);
        const foeD = foe ? U.dist(p.x, p.y, foe.x, foe.y) - foe.r : Infinity;
        const baseD = eb.alive ? U.dist(p.x, p.y, eb.x, eb.y) - eb.r : Infinity;
        const foeAim = foe ? U.angleTo(p.x, p.y, foe.x + (foe.vx || 0) * 0.12, foe.y + (foe.vy || 0) * 0.12) : null;
        const foeOk = foe && inCone(foeAim);
        const b = eb.alive ? eb : this.world.playerBase;
        const baseAim = U.angleTo(p.x, p.y, b.x, b.y);
        const baseOk = inCone(baseAim);
        if (foeOk && (!baseOk || foeD <= baseD)) {
          aim = foeAim;
          this.aimPoint = { x: foe.x, y: foe.y };
        } else if (baseOk) {
          aim = baseAim;
          this.aimPoint = { x: b.x, y: b.y };
        } else {
          // Nothing in the snap cone: hold the current line.
          this.aimPoint = { x: p.x + Math.cos(p.aim) * 140, y: p.y + Math.sin(p.aim) * 140 };
        }
        this.aimMode = 'auto';
      }
      if (aim !== null) p.aim = U.turnToward(p.aim, aim, dt * 16);

      // --- fire --------------------------------------------------------
      const wantFire = CFG.PLAYER.autoFire || input.action('fire') || input.pad.fire > 0;
      if (wantFire) p.tryFire(this.world, p.aim, this.world.rng);
    }

    /* ------------------------------------------------------------ draw --- */
    draw(ctx, view, dpr, input) {
      this.view = view;
      const R = W.Renderer, world = this.world;
      R.beginFrame(ctx, view, dpr);
      ctx.save();
      this.camera.apply(ctx);
      R.drawBackground(ctx, world, this.camera);
      R.drawWorld(ctx, world, this.camera, this);
      // Mouse-control destination marker (world space, pulsing ring + X).
      if (this.control === 'mouse' && this.moveTarget && this.state === 'playing') {
        const mt = this.moveTarget, pulse = 5 + 2 * Math.sin(this.ui.t * 6);
        ctx.strokeStyle = C.accent; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(mt.x, mt.y, 9 + pulse * 0.4, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mt.x - 5, mt.y - 5); ctx.lineTo(mt.x + 5, mt.y + 5);
        ctx.moveTo(mt.x + 5, mt.y - 5); ctx.lineTo(mt.x - 5, mt.y + 5);
        ctx.stroke();
      }
      ctx.restore();

      // Screen-space layers.
      R.drawMinimap(ctx, world, this, view);
      if (this.state !== 'title') this.ui.drawHud(ctx, view, this);
      if (CFG.DEBUG.showHitboxes) this._debugOverlay(ctx, view);

      if (this.state === 'title') this.ui.drawTitle(ctx, view, this);
      else if (this.state === 'paused') this.ui.drawPause(ctx, view);
      else if (this.state === 'levelup') this.ui.drawLevelUp(ctx, view, this.cards, this);
      else if (this.state === 'won' || this.state === 'lost') this.ui.drawGameOver(ctx, view, this, this.state === 'won');

      R.endFrame(ctx, view, dpr, this);
    }

    _debugOverlay(ctx, view) {
      const lines = [
        `fps ${Math.round(this.fps || 0)}  ents F:${this.world.fighters.length} B:${this.world.bullets.length} P:${this.world.particles.length} T:${this.world.trees.length}`,
        `cam ${Math.round(this.camera.x)},${Math.round(this.camera.y)}  state ${this.state}  aim ${this.aimMode}`,
        `grid cells ${this.world.grid.size}  seed ok`,
      ];
      lines.forEach((l, i) => W.UIHelpers.text(ctx, l, view.w / 2 - 150, view.h - 60 + i * 13, 10, '#00ffcc'));
    }
  }

  W.Game = Game;
})(window.WARS || (window.WARS = {}));