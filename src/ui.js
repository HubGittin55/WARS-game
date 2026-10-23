/* WARS — canvas UI: HUD, banners, title/pause/game-over screens, level-up cards.
   All in logical view space (Config.VIEW), so it scales with the letterbox. */
(function (W) {
  'use strict';
  const U = W.Util;
  const CFG = W.Config;
  const C = CFG.COLORS;
  const FONT = 'ui-monospace, "DejaVu Sans Mono", Consolas, monospace';

  function text(ctx, s, x, y, size, color, align, weight) {
    ctx.font = `${weight || 700} ${size}px ${FONT}`;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillText(s, x + 1, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  function bar(ctx, x, y, w, h, f, color, bg, label) {
    ctx.fillStyle = bg || 'rgba(0,0,0,.55)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * U.clamp(f, 0, 1), h);
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    if (label) text(ctx, label, x + 4, y + h - 4, 10, '#0b1014');
  }

  class UI {
    constructor(game) {
      this.game = game;
      this.banner = null;
      this.bannerT = 0;
      this.cardRects = [];
      this.levelRects = [];
      this.controlRects = [];
      this.hover = -1;
      this.t = 0;
    }

    flashBanner(s, color) { this.banner = s; this.bannerColor = color || C.accent; this.bannerT = 2.2; }
    update(dt) { this.t += dt; if (this.bannerT > 0) this.bannerT -= dt; }

    /* --------------------------------------------------------------- HUD -- */
    drawHud(ctx, view, game) {
      const p = game.player, world = game.world;
      const pad = 14;

      // Top: both base HP bars (classic base-vs-base read).
      const bw = 250, bh = 13;
      const pb = world.playerBase, eb = world.enemyBase;
      bar(ctx, pad, pad, bw, bh, pb.hp / pb.maxHp, pb.hp / pb.maxHp > .3 ? C.teamPlayer : C.hpLow, null);
      text(ctx, `YOUR BASE  ${Math.ceil(pb.hp)}/${pb.maxHp}`, pad + 4, pad + bh + 14, 11, C.textDim);
      const ex = view.w - pad - bw;
      bar(ctx, ex, pad, bw, bh, eb.hp / eb.maxHp, C.teamEnemy, null);
      text(ctx, `ENEMY BASE  ${Math.ceil(eb.hp)}/${eb.maxHp}`, view.w - pad - 4, pad + bh + 14, 11, C.textDim, 'right');

      // Center top: run clock + wave.
      text(ctx, U.formatTime(game.time), view.w / 2, pad + 12, 15, C.text, 'center');
      text(ctx, 'WAVE ' + game.director.wave, view.w / 2, pad + 28, 10, C.textDim, 'center');

      // Bottom-left: player vitals + weapon + squad/tank pips.
      const by = view.h - pad;
      if (p && !p.dead) {
        bar(ctx, pad, by - 26, 210, 14, p.hp / p.maxHp, p.hp / p.maxHp > .35 ? C.hp : C.hpLow, null);
        text(ctx, `HP ${Math.ceil(p.hp)}/${p.maxHp}`, pad + 5, by - 15, 11, '#0b1014');
        const w = p.weapon;
        const wl = p.weaponTime > 0 ? ` ${Math.ceil(p.weaponTime)}s` : '';
        text(ctx, `${w.name.toUpperCase()}${wl}`, pad, by - 34, 13, p.weaponTime > 0 ? C.pickup : C.text);
      } else if (game.respawnT > 0) {
        text(ctx, `RESPAWN IN ${game.respawnT.toFixed(1)}s`, pad, by - 20, 14, C.teamEnemy);
      }

      // Squad pips: one square per soldier, to the right of the HP bar (lit = in the fight, outlined = respawning).
      const sq = game.squad;
      if (sq.length) {
        let sx = pad + 218;
        const sy = by - 25;
        sq.forEach((f) => {
          if (!f.dead) {
            ctx.fillStyle = C.teamPlayer;
            ctx.fillRect(sx, sy, 11, 11);
            ctx.fillStyle = '#0b1014';
            ctx.fillRect(sx + 1, sy + 7, 9 * (f.hp / f.maxHp), 3);
          } else {
            ctx.strokeStyle = C.teamPlayerDim;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(sx + 1, sy + 1, 9, 9);
          }
          sx += 16;
        });
      }
      // Tank pips: amber hulls with a slim HP bar, same row after the squad pips.
      if (game.tanks.length) {
        let tx = pad + 218 + sq.length * 16 + 8;
        const ty = by - 27;
        game.tanks.forEach((tk) => {
          const f = tk.hp / tk.maxHp;
          ctx.fillStyle = f > 0.4 ? C.accent : C.hpLow;
          ctx.fillRect(tx, ty, 16, 10);
          ctx.fillStyle = '#0b1014';
          ctx.fillRect(tx + 1, ty + 6, 14 * f, 3);
          tx += 20;
        });
      }

      // XP bar across the bottom.
      const need = game.xpNeed, have = game.xp;
      bar(ctx, pad, view.h - 8, view.w - pad * 2, 6, have / need, C.accent, 'rgba(0,0,0,.5)');
      text(ctx, `LV ${game.level}`, view.w / 2, view.h - 12, 10, C.textDim, 'center');

      // Stats block (bottom-center-left).
      const s = world.stats;
      text(ctx, `KILLS ${s.kills}   ACC ${s.shots ? Math.round((s.hits / s.shots) * 100) : 0}%   FRUIT ${s.fruit}`, pad, by - 52, 11, C.textDim);

      // Auto-fire + aim mode chip.
      const chip = (CFG.PLAYER.autoFire ? 'AUTO-FIRE ON' : 'AUTO-FIRE OFF') + '  [F]';
      text(ctx, chip, view.w - pad, view.h - 34, 11, CFG.PLAYER.autoFire ? C.hp : C.textDim, 'right');
      const aimMode = game.aimMode === 'mouse' ? 'MOUSE AIM' : 'AUTO AIM';
      text(ctx, aimMode, view.w - pad, view.h - 20, 10, C.textDim, 'right');

      if (this.bannerT > 0) {
        const a = U.clamp(this.bannerT / 0.5, 0, 1);
        ctx.globalAlpha = a;
        text(ctx, this.banner, view.w / 2, view.h * 0.28, 30, this.bannerColor, 'center', '800');
        ctx.globalAlpha = 1;
      }

      this.drawMinimapHint(ctx, view);
    }

    drawMinimapHint(ctx, view) {
      text(ctx, 'MAP', view.w - 14 - 168, view.h - 14 - 8, 9, C.textDim, 'right');
    }

    /* ------------------------------------------------------------- menus -- */
    dim(ctx, view, a) { ctx.fillStyle = `rgba(4,7,9,${a})`; ctx.fillRect(0, 0, view.w, view.h);
    }

    drawTitle(ctx, view, game) {
      this.dim(ctx, view, 0.72);
      const cx = view.w / 2;
      text(ctx, 'W A R S', cx, view.h * 0.26, 58, C.text, 'center', '800');
      text(ctx, 'two bases · a squad · a lot of lead', cx, view.h * 0.26 + 28, 14, C.accent, 'center');

      // Difficulty mode selector (persists in localStorage; applies to the next run).
      const modes = CFG.MODE_ORDER;
      const sel = CFG.MODES[game.mode] ? game.mode : CFG.MODE_DEFAULT;
      ctx.font = '700 13px ' + FONT;
      const sizes = modes.map(m => ctx.measureText(CFG.MODES[m].label).width);
      const gapM = 14, padM = 10;
      const totalW = sizes.reduce((a, b) => a + b, 0) + padM * 2 * modes.length + gapM * (modes.length - 1);
      let mx = cx - totalW / 2;
      const my = view.h * 0.36;
      ctx.textBaseline = 'middle';
      modes.forEach((m, i) => {
        const w = sizes[i] + padM * 2;
        const isSel = sel === m;
        if (isSel) {
          ctx.fillStyle = 'rgba(255,209,102,.18)';
          ctx.fillRect(mx, my - 12, w, 24);
          ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5;
          ctx.strokeRect(mx + .5, my - 11.5, w - 1, 23);
        }
        ctx.textAlign = 'left';
        ctx.fillStyle = isSel ? C.accent : C.textDim;
        ctx.fillText(CFG.MODES[m].label, mx + padM, my);
        mx += w + gapM;
      });
      ctx.textBaseline = 'alphabetic';
      text(ctx, '← / → or 1–5 picks a mode · harder means a bigger swarm, and your squad carries more', cx, my + 24, 11, C.textDim, 'center');

      // Map selector (Q / E, or click a name).
      const lv = CFG.LEVELS;
      const lsel = lv.find((l) => l.id === game.levelId) || lv[0];
      ctx.font = '600 12px ' + FONT;
      const lnames = lv.map(l => l.name);
      const lsizes = lnames.map(n => ctx.measureText(n).width);
      const gapL = 10, padL = 8;
      const lTotal = lsizes.reduce((a, b) => a + b, 0) + padL * 2 * lv.length + gapL * (lv.length - 1);
      let lx = cx - lTotal / 2;
      const ly = view.h * 0.435;
      ctx.textBaseline = 'middle';
      lv.forEach((l, i) => {
        const w = lsizes[i] + padL * 2;
        const isSel = lsel.id === l.id;
        if (isSel) {
          ctx.fillStyle = 'rgba(87,200,255,.16)';
          ctx.fillRect(lx, ly - 11, w, 22);
          ctx.strokeStyle = C.teamPlayer; ctx.lineWidth = 1.5;
          ctx.strokeRect(lx + .5, ly - 10.5, w - 1, 21);
        }
        ctx.textAlign = 'left';
        ctx.fillStyle = isSel ? C.teamPlayer : C.textDim;
        ctx.fillText(lnames[i], lx + padL, ly);
        lx += w + gapL;
      });
      ctx.textBaseline = 'alphabetic';
      this.levelRects = [];  // rebuilt each frame for mouse picking
      lx = cx - lTotal / 2;
      lv.forEach((l, i) => {
        const w = lsizes[i] + padL * 2;
        this.levelRects.push({ x: lx, y: ly - 12, w, h: 24, id: l.id });
        lx += w + gapL;
      });
      text(ctx, `Q / E or click picks a map · ${lsel.desc}`, cx, ly + 22, 11, C.textDim, 'center');

      // Control selector (click a chip, or C to cycle; persists like mode/map).
      const ctls = CFG.CONTROLS;
      const csel = ctls.find((c) => c.id === game.control) || ctls[0];
      ctx.font = '700 13px ' + FONT;
      const cnames = ctls.map(c => c.label);
      const csizes = cnames.map(n => ctx.measureText(n).width);
      const gapC = 12, padC = 10;
      const cTotal = csizes.reduce((a, b) => a + b, 0) + padC * 2 * ctls.length + gapC * (ctls.length - 1);
      let ccx = cx - cTotal / 2;
      const cy2 = view.h * 0.505;
      ctx.textBaseline = 'middle';
      this.controlRects = [];
      ctls.forEach((c, i) => {
        const w = csizes[i] + padC * 2;
        const isSel = csel.id === c.id;
        if (isSel) {
          ctx.fillStyle = 'rgba(126,231,135,.15)';
          ctx.fillRect(ccx, cy2 - 12, w, 24);
          ctx.strokeStyle = C.hp; ctx.lineWidth = 1.5;
          ctx.strokeRect(ccx + .5, cy2 - 11.5, w - 1, 23);
        }
        ctx.textAlign = 'left';
        ctx.fillStyle = isSel ? C.hp : C.textDim;
        ctx.fillText(cnames[i], ccx + padC, cy2);
        this.controlRects.push({ x: ccx, y: cy2 - 12, w, h: 24, id: c.id });
        ccx += w + gapC;
      });
      ctx.textBaseline = 'alphabetic';
      text(ctx, `C or click picks control · ${csel.desc}`, cx, cy2 + 24, 11, C.textDim, 'center');

      const lines = [
        'WASD / ARROWS / LEFT STICK     move          SHIFT   dash (brief i-frames)',
        'MOUSE / RIGHT STICK            aim           [F]     toggle auto-fire (on)',
        'YOUR SQUAD fights beside you — level-up cards upgrade the whole unit',
        `LEVEL ${CFG.TANK.unlockLevel} unlocks the TANK card: a tracked gun-platform that holds the line`,
        'SHOOT TREES for fruit (scarce, but juicy)  ·  GRAB CRATES for temporary guns',
        'KILL ENEMIES: XP → LEVEL UP → pick a perk [1/2/3]',
        'DESTROY THE ENEMY BASE to win',
      ];
      lines.forEach((l, i) => text(ctx, l, cx, view.h * 0.585 + i * 19, 12, i % 2 ? C.textDim : C.text, 'center'));

      const pulse = 0.55 + 0.45 * Math.sin(this.t * 4);
      ctx.globalAlpha = pulse;
      text(ctx, 'CLICK OR PRESS ENTER TO DEPLOY', cx, view.h * 0.88, 16, C.hp, 'center');
      ctx.globalAlpha = 1;
      text(ctx, 'P pause · R restart · M mute · ~ debug', cx, view.h * 0.94, 10, C.textDim, 'center');
    }

    drawPause(ctx, view) {
      this.dim(ctx, view, 0.6);
      const cx = view.w / 2;
      text(ctx, 'PAUSED', cx, view.h * 0.40, 40, C.text, 'center', '800');
      text(ctx, 'P to resume · R to restart · M ' + (game0(this).audio.muted ? 'unmuted' : 'muted'), cx, view.h * 0.50, 13, C.textDim, 'center');
      const g = game0(this);
      const mlbl = CFG.MODES[g.mode] ? CFG.MODES[g.mode].label : CFG.MODES[CFG.MODE_DEFAULT].label;
      const lv = (CFG.LEVELS.find((l) => l.id === g.levelId) || CFG.LEVELS[0]).name;
      text(ctx, `MODE ${mlbl}  ·  MAP ${lv}   —   ← / → or 1–5 / Q E to change (applies after R)`, cx, view.h * 0.55, 11, C.textDim, 'center');
    }

    drawLevelUp(ctx, view, cards, game) {
      this.dim(ctx, view, 0.66);
      text(ctx, `LEVEL ${game.level}`, view.w / 2, 90, 30, C.accent, 'center', '800');
      text(ctx, 'pick a perk', view.w / 2, 112, 12, C.textDim, 'center');
      const n = cards.length;
      const cw = 210, chh = 150, gap = 22;
      const total = n * cw + (n - 1) * gap;
      let x = (view.w - total) / 2;
      const y = view.h / 2 - chh / 2 + 10;
      this.cardRects.length = 0;
      cards.forEach((c, i) => {
        const r = { x, y, w: cw, h: chh, index: i };
        this.cardRects.push(r);
        const hov = this.hover === i;
        ctx.fillStyle = hov ? '#1b2a34' : '#131e25';
        ctx.fillRect(x, y, cw, chh);
        ctx.strokeStyle = hov ? C.accent : '#2b3a44';
        ctx.lineWidth = hov ? 3 : 1.5;
        ctx.strokeRect(x + .5, y + .5, cw - 1, chh - 1);
        text(ctx, `[${i + 1}]`, x + 12, y + 24, 12, C.textDim);
        text(ctx, c.name, x + 12, y + 48, 16, hov ? C.accent : C.text);
        wrap(ctx, c.desc, x + 12, y + 72, cw - 24, 15, 12, C.textDim);
        const owned = game.player.stacks[c.id] || 0;
        text(ctx, owned ? `owned x${owned}` : '', x + 12, y + chh - 14, 10, C.textDim);
        text(ctx, 'T' + c.tier, x + cw - 12, y + chh - 14, 10, c.tier > 2 ? C.pickup : C.textDim, 'right');
        x += cw + gap;
      });
    }

    drawGameOver(ctx, view, game, won) {
      this.dim(ctx, view, 0.78);
      const cx = view.w / 2;
      text(ctx, won ? 'BASE DESTROYED — YOU WIN' : 'DEFEAT', cx, view.h * 0.36, 42, won ? C.hp : C.teamEnemy, 'center', '800');
      const s = game.world.stats;
      const rows = [
        `time ${U.formatTime(game.time)}   wave ${game.director.wave}   level ${game.level}   mode ${CFG.MODES[game.mode] ? CFG.MODES[game.mode].label : CFG.MODES[CFG.MODE_DEFAULT].label}   map ${(CFG.LEVELS.find((l) => l.id === game.levelId) || CFG.LEVELS[0]).name}`,
        `kills ${s.kills}   shots ${s.shots}   accuracy ${s.shots ? Math.round((s.hits / s.shots) * 100) : 0}%`,
        `damage dealt ${Math.round(s.dmgDealt)}   damage taken ${Math.round(s.dmgTaken)}`,
        `fruit eaten ${s.fruit}   crates ${s.crates}   trees felled ${s.trees}`,
        `times down ${game.deaths}   enemy base left ${Math.ceil(game.world.enemyBase.hp)}`,
      ];
      rows.forEach((r, i) => text(ctx, r, cx, view.h * 0.48 + i * 22, 13, i ? C.textDim : C.text, 'center'));
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 4);
      ctx.globalAlpha = pulse;
      text(ctx, 'CLICK OR PRESS R FOR A NEW RUN', cx, view.h * 0.8, 16, C.accent, 'center');
      ctx.globalAlpha = 1;
    }

    /** Mouse hover for cards, in logical view coords. */
    hoverCards(input, view, active) {
      this.hover = -1;
      if (!active || !input.mouse.inside) return;
      const vx = (input.mouse.x - view.offsetX) / view.scale;
      const vy = (input.mouse.y - view.offsetY) / view.scale;
      for (const r of this.cardRects) if (U.boxHit(r, vx, vy)) this.hover = r.index;
    }
    clickedCard(input) {
      if (!input.mouse.left) return -1;
      if (this.hover >= 0) { input.mouse.left = false; return this.hover; }
      return -1;
    }
  }

  function wrap(ctx, s, x, y, maxW, lh, size, color) {
    ctx.font = `600 ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    const words = s.split(' ');
    let line = '';
    for (const wd of words) {
      const test = line ? line + ' ' + wd : wd;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y); y += lh; line = wd;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, y);
  }

  function game0(ui) { return ui.game; }

  W.UI = UI;
  W.UIHelpers = { text, bar, wrap };
})(window.WARS || (window.WARS = {}));