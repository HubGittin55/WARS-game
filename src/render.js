/* WARS — rendering: view fit/letterbox, world background, draw order, minimap.
   Everything is drawn in world units; the view transform maps them to the fixed
   logical canvas (Config.VIEW), which CSS then letterboxes to the window. */
(function (W) {
  'use strict';
  const U = W.Util;
  const CFG = W.Config;
  const C = CFG.COLORS;

  const Renderer = {
    /** Fit the fixed logical view inside the window (letterbox, never stretch). */
    computeView(cssW, cssH) {
      const vw = CFG.VIEW.W, vh = CFG.VIEW.H;
      const scale = Math.max(0.25, Math.min(cssW / vw, cssH / vh));
      return {
        scale,
        offsetX: Math.round((cssW - vw * scale) / 2),
        offsetY: Math.round((cssH - vh * scale) / 2),
        cssW, cssH, w: vw, h: vh,
      };
    },

    /** Reset transform to logical view space (0,0 = top-left of the play view). */
    beginFrame(ctx, view, dpr) {
      ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.offsetX, dpr * view.offsetY);
      ctx.fillStyle = C.bg;
      ctx.fillRect(-view.offsetX / view.scale, -view.offsetY / view.scale, view.cssW / view.scale, view.cssH / view.scale);
      ctx.save();
    },

    endFrame(ctx, view, dpr, game) {
      ctx.restore();
      // Vignette (cheap, big win on mood).
      const g = ctx.createRadialGradient(view.w / 2, view.h / 2, view.h * 0.35, view.w / 2, view.h / 2, view.h * 0.95);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, view.w, view.h);
      // Damage flash
      if (game.hurtFlash > 0) {
        ctx.fillStyle = `rgba(255,60,60,${Math.min(0.45, game.hurtFlash * 0.5)})`;
        ctx.fillRect(0, 0, view.w, view.h);
      }
      if (game.healFlash > 0) {
        ctx.fillStyle = `rgba(126,231,135,${Math.min(0.28, game.healFlash * 0.35)})`;
        ctx.fillRect(0, 0, view.w, view.h);
      }
    },

    /* ------------------------------------------------------- background -- */
    drawBackground(ctx, world, cam) {
      const cell = 80;
      const x0 = Math.floor(cam.x / cell) * cell, x1 = cam.x + cam.w;
      const y0 = Math.floor(cam.y / cell) * cell, y1 = cam.y + cam.h;

      ctx.fillStyle = C.grid;
      for (let x = x0; x <= x1; x += cell) {
        const major = ((x / cell) % 5) === 0;
        ctx.fillStyle = major ? C.gridMajor : C.grid;
        ctx.fillRect(x, cam.y - 4, 1, cam.h + 8);
      }
      for (let y = y0; y <= y1; y += cell) {
        const major = ((y / cell) % 5) === 0;
        ctx.fillStyle = major ? C.gridMajor : C.grid;
        ctx.fillRect(cam.x - 4, y, cam.w + 8, 1);
      }

      // ground decor
      for (const d of world.decor) {
        if (!cam.visible(d.x, d.y, 20)) continue;
        ctx.globalAlpha = d.a;
        ctx.fillStyle = d.kind === 0 ? '#2b3a44' : d.kind === 1 ? '#243039' : '#1d2830';
        if (d.kind === 2) { ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, U.TAU); ctx.fill(); }
        else ctx.fillRect(d.x, d.y, d.r * 1.6, d.r * 0.7);
        ctx.globalAlpha = 1;
      }

      // tank tread marks (faint, fade out over their life)
      for (const tr of world.tracks) {
        if (!cam.visible(tr.x, tr.y, 30)) continue;
        const al = U.clamp(tr.t / 14, 0, 1) * 0.32;
        const ca = Math.cos(tr.a), sa = Math.sin(tr.a);
        ctx.globalAlpha = al;
        ctx.strokeStyle = '#0e1318';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(tr.x - sa * 8 - ca * 5, tr.y + ca * 8 - sa * 5);
        ctx.lineTo(tr.x - sa * 8 + ca * 5, tr.y + ca * 8 + sa * 5);
        ctx.moveTo(tr.x + sa * 8 - ca * 5, tr.y - ca * 8 - sa * 5);
        ctx.lineTo(tr.x + sa * 8 + ca * 5, tr.y - ca * 8 + sa * 5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // arena walls
      const p = CFG.WORLD.PAD;
      ctx.strokeStyle = C.wall; ctx.lineWidth = p * 2;
      ctx.strokeRect(p / 2, p / 2, world.w - p, world.h - p);
      ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 2;
      ctx.strokeRect(p, p, world.w - p * 2, world.h - p * 2);

      // home / enemy territory tint
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = C.teamPlayer;
      ctx.fillRect(p, p, world.w - p * 2, world.h - p * 2);
      ctx.globalAlpha = 1;
    },

    /* ---------------------------------------------------------- entities -- */
    drawWorld(ctx, world, cam, game) {
      // Ground layer: blood decals linger beneath everything, corpses under fighters.
      for (const g of world.gore) if (cam.visible(g.x, g.y, g.r + 12)) g.draw(ctx);
      for (const fr of world.fruits) if (cam.visible(fr.x, fr.y)) fr.draw(ctx);
      for (const p of world.pickups) if (cam.visible(p.x, p.y)) p.draw(ctx);
      for (const b of world.bases) if (b.alive && cam.visible(b.x, b.y, 140)) b.draw(ctx);
      for (const p of world.particles) if (cam.visible(p.x, p.y)) p.draw(ctx);
      for (const c of world.corpses) if (cam.visible(c.x, c.y, 30)) c.draw(ctx);
      world.drawShockwaves(ctx);

      // Fighters, painted back-to-front so lower bodies overlap upper ones.
      const fs = world.fighters.filter((f) => !f.dead && cam.visible(f.x, f.y, 40));
      fs.sort((a, b) => a.y - b.y);
      for (const f of fs) f.draw(ctx, game);

      // Tanks sit on the ground but under the canopies.
      for (const tk of world.tanks) if (tk.alive && cam.visible(tk.x, tk.y, 60)) tk.draw(ctx);

      // Canopies last so they read as cover you can hide behind.
      for (const t of world.trees) {
        if (!cam.visible(t.x, t.y, 60)) continue;
        ctx.globalAlpha = 0.94;
        t.draw(ctx);
        ctx.globalAlpha = 1;
      }

      for (const b of world.bullets) if (cam.visible(b.x, b.y, 30)) b.draw(ctx);
      for (const t of world.texts) if (cam.visible(t.x, t.y, 40)) t.draw(ctx);

      if (CFG.DEBUG.showHitboxes) this._debug(ctx, world, cam);
    },

    _debug(ctx, world, cam) {
      ctx.strokeStyle = '#00ffcc'; ctx.lineWidth = 1;
      const ring = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, U.TAU); ctx.stroke(); };
      for (const f of world.fighters) if (!f.dead) { ring(f.x, f.y, f.r); ctx.strokeStyle = '#ff0'; ring(f.x, f.y, f.aimRange); ctx.strokeStyle = '#00ffcc'; }
      for (const t of world.trees) if (!t.dead) { ring(t.x, t.y, t.r); ring(t.x, t.y, t.r * 0.72); }
      for (const b of world.bases) if (b.alive) { ring(b.x, b.y, b.r); ctx.strokeStyle = '#f0f'; ring(b.x, b.y, CFG.BASE.turretRange); ctx.strokeStyle = '#00ffcc'; }
      if (CFG.DEBUG.showGrid) {
        const cell = CFG.WORLD.GRID_CELL;
        ctx.strokeStyle = 'rgba(255,0,255,.25)';
        for (let x = Math.floor(cam.x / cell) * cell; x < cam.x + cam.w; x += cell) ctx.strokeRect(x, cam.y, cell, cell);
        for (let y = Math.floor(cam.y / cell) * cell; y < cam.y + cam.h; y += cell) ctx.strokeRect(cam.x, y, cell, cell);
      }
    },

    /* ----------------------------------------------------------- minimap -- */
    drawMinimap(ctx, world, game, view) {
      const w = 168, h = Math.round(w * (world.h / world.w));
      const x = view.w - w - 14, y = view.h - h - 14;
      const sx = w / world.w, sy = h / world.h;
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = '#070c10';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#2b3a44'; ctx.lineWidth = 1;
      ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);

      ctx.fillStyle = 'rgba(47,125,79,.55)';
      for (const t of world.trees) if (!t.dead) ctx.fillRect(x + t.x * sx - 1, y + t.y * sy - 1, 2, 2);

      const dot = (px, py, c, s) => { ctx.fillStyle = c; ctx.fillRect(x + px * sx - s / 2, y + py * sy - s / 2, s, s); };
      for (const f of world.fighters) {
        if (f.dead) continue;
        dot(f.x, f.y, f.team === CFG.TEAM.PLAYER ? C.teamPlayer : C.teamEnemy, f.isPlayer ? 4 : 2);
      }
      for (const b of world.bases) if (b.alive) dot(b.x, b.y, b.team === CFG.TEAM.PLAYER ? C.teamPlayer : C.teamEnemy, 7);
      for (const tk of world.tanks) if (tk.alive) dot(tk.x, tk.y, tk.team === CFG.TEAM.PLAYER ? C.accent : C.hpLow, 4);
      for (const p of world.pickups) dot(p.x, p.y, C.pickup, 3);
      for (const fr of world.fruits) dot(fr.x, fr.y, C.fruit, 2);

      // camera rect
      const cam = game.camera;
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.strokeRect(x + cam.x * sx, y + cam.y * sy, cam.w * sx, cam.h * sy);
      ctx.globalAlpha = 1;
      return { x, y, w, h };
    },
  };

  W.Renderer = Renderer;
})(window.WARS || (window.WARS = {}));