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
      this.best = this._loadBest();
      this._wireWorld();
      this.reset(opts.seed || (Date.now() & 0xffff));
    }

    /* ----------------------------------------------------------- setup --- */
    _wireWorld() {
      const w = this.world, a = this.audio;
      w.onShot = (shooter, weapon) => {
        if (!this.camera.visible(shooter.x, shooter.y, 200)) return;
        const own = shooter.team === T.PLAYER;
        a.play(weapon.sound || 'shootPistol', { vol: own ? 1 : 0.45 });
        if (own) this.camera.addShake(weapon.id === 'rocket' ? 0.16 : weapon.id === 'shotgun' ? 0.1 : 0.03);
      };
      w.onHit = (f, dmg) => {
        a.play('hit');
        if (f.isPlayer) { this.hurtFlash = 1; this.camera.addShake(0.22); }
      };
      w.onKill = (f, srcTeam) => {
        w.burst(f.x, f.y, 16, { color: f.team === T.PLAYER ? C.teamPlayer : C.teamEnemy, spMin: 60, spMax: 260, lifeMin: .2, lifeMax: .55 });
        a.play('kill');
        if (f.isPlayer) { this._playerDown(); return; }
        if (f.team === T.ENEMY) {
          // XP from any enemy death, credited kills only if you (or your base)
          // landed the finishing blow.
          this.addXp(f.xpValue);
          if (srcTeam === T.PLAYER) {
            w.stats.kills++;
            w.addText(f.x, f.y - 18, '+' + f.xpValue + ' XP', C.accent, 11);
          }
        }
        this.camera.addShake(0.08);
      };
      w.onTreeHit = () => a.play('tree');
      w.onTreeDestroyed = () => { w.stats.trees++; };
      w.onFruit = (f) => {
        a.play('fruit');
        if (f.isPlayer) { this.healFlash = 1; }
      };
      w.onPickup = (f) => { if (f.isPlayer) a.play('pickup'); };
      w.onExplosion = (x, y) => {
        a.play('explode');
        if (this.camera.visible(x, y, 200)) this.camera.addShake(0.3);
      };
      w.onBaseHit = (b) => {
        a.play('hit', { vol: 0.8 });
        if (b.team === T.PLAYER) { this.hurtFlash = Math.max(this.hurtFlash, 0.5); this.camera.addShake(0.14); }
        else this.camera.addShake(0.05);
      };
      w.onBaseDestroyed = (b) => {
        w.burst(b.x, b.y, 60, { color: '#ffb066', spMin: 80, spMax: 520, lifeMin: .3, lifeMax: 1.1, rMin: 4, rMax: 10 });
        w.explode(b.x, b.y, 220, 0, T.ENEMY === b.team ? T.PLAYER : T.ENEMY);
        this.camera.addShake(1.2);
        a.play('explode');
        this._end(b.team === T.ENEMY);
      };
    }

    reset(seed) {
      this.world.build(seed);
      this.time = 0;
      this.level = 1; this.xp = 0;
      this.xpNeed = this._xpFor(2);
      this.cards = [];
      this.respawnT = 0;
      this.deaths = 0;
      this.hurtFlash = this.healFlash = 0;
      this.director.reset();
      this.ui.bannerT = 0;

      const pb = this.world.playerBase;
      const spot = this.world.openSpot(pb.x + 90, pb.y - 60, 40, 12);
      this.player = this.world.addFighter({
        team: T.PLAYER, isPlayer: true, x: spot.x, y: spot.y,
        hp: CFG.PLAYER.hp, speed: CFG.PLAYER.speed, r: CFG.PLAYER.r,
      });
      this.camera.snapTo(this.player);
      this.state = 'title';
      return this;
    }

    restart() { this.reset((Date.now() & 0xffff)); this.start(); }
    start() {
      this.audio.unlock();
      if (this.state === 'title') { this.state = 'playing'; this.ui.flashBanner('GO', C.hp); }
    }

    _xpFor(level) { return Math.round(CFG.XP.levelBase * Math.pow(CFG.XP.levelGrowth, level - 1)); }

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
        this.cards = W.Upgrades.roll(this.player, CFG.XP.cards, this.world.rng);
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
      this.camera.addShake(0.6);
      this.ui.flashBanner('YOU ARE DOWN', C.teamEnemy);
      // Downed player leaves the fighter list conceptually; keep object for respawn.
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

      if (this.respawnT > 0) {
        this.respawnT -= dt;
        if (this.respawnT <= 0) { this.respawnT = 0; this._respawn(); }
      }

      const camTarget = this.player.dead ? this.world.playerBase : this.player;
      this.camera.update(dt, camTarget, this.aimPoint);
    }

    /* -------------------------------------------------- player control --- */
    _playerControl(dt, input) {
      const p = this.player;
      if (!p || p.dead) return;

      const mv = input.moveVector();
      // Dash first: while it is running we must not fight its velocity.
      if (input.pressedAction('dash') || input.pad.dash) p.tryDash(mv.x, mv.y, this.world);
      if (p.dashT <= 0) {
        const sp = p.baseSpeed * p.speedMul;
        const k = Math.min(1, dt * 12);
        p.vx += (mv.x * sp - p.vx) * k;
        p.vy += (mv.y * sp - p.vy) * k;
      }

      // --- aim ---------------------------------------------------------
      const useMouse = (input.moveMode === 'mouse' && input.mouse.inside) || (input.pad.ax || input.pad.ay);
      let aim = null;
      if (useMouse) {
        const wpt = input.toWorld(this.view, this.camera);
        this.aimPoint = wpt;
        aim = U.angleTo(p.x, p.y, wpt.x, wpt.y);
        this.aimMode = input.pad.ax || input.pad.ay ? 'stick' : 'mouse';
      } else {
        // Context auto-aim: pick the closest hostile *edge* — including the enemy
        // base, so walking into their bunker means you start pounding it.
        const eb = this.world.enemyBase;
        const foe = this.world.nearestEnemy(p, p.team, p.aimRange);
        const foeD = foe ? U.dist(p.x, p.y, foe.x, foe.y) - foe.r : Infinity;
        const baseD = eb.alive ? U.dist(p.x, p.y, eb.x, eb.y) - eb.r : Infinity;
        if (foe && foeD <= baseD) {
          aim = U.angleTo(p.x, p.y, foe.x + (foe.vx || 0) * 0.12, foe.y + (foe.vy || 0) * 0.12);
          this.aimPoint = { x: foe.x, y: foe.y };
        } else {
          const b = eb.alive ? eb : this.world.playerBase;
          aim = U.angleTo(p.x, p.y, b.x, b.y);
          this.aimPoint = { x: b.x, y: b.y };
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