/* WARS — bootstrap: canvas sizing, fixed-timestep loop, global hotkeys.
   Runs from file:// with no server, no modules, no build step. */
(function (W) {
  'use strict';
  const CFG = W.Config;
  const U = W.Util;

  const FIXED = 1 / 60;     // physics step (bullets use swept tests, so 60Hz is safe)
  const MAX_FRAME = 0.05;    // clamp huge frame gaps (tab switches, breakpoints)

  function boot() {
    const canvas = document.getElementById('game');
    const stage = document.getElementById('stage');
    const bootEl = document.getElementById('boot');
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (bootEl) bootEl.style.display = 'none';

    const input = new W.Input(canvas);
    const game = new W.Game({});
    W.game = game; W.input = input;   // handy in devtools

    let view = W.Renderer.computeView(window.innerWidth, window.innerHeight);
    let dpr = 1;

    function resize() {
      dpr = U.clamp(window.devicePixelRatio || 1, 1, 2.5);
      const cssW = window.innerWidth, cssH = window.innerHeight;
      view = W.Renderer.computeView(cssW, cssH);
      canvas.style.width = Math.round(cssW) + 'px';
      canvas.style.height = Math.round(cssH) + 'px';
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      game.camera.setView(CFG.VIEW.W, CFG.VIEW.H);
    }
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    resize();

    /* ------------------------------------------------------ hotkeys ------ */
    /** Cycle / jump to a difficulty mode (title, pause, or game-over screen).
        The pick persists in localStorage and applies to the next run. */
    function changeMode(delta, absolute) {
      const order = CFG.MODE_ORDER;
      let idx = order.indexOf(game.mode);
      if (idx < 0) idx = order.indexOf(CFG.MODE_DEFAULT);
      idx = absolute === undefined ? U.clamp(idx + delta, 0, order.length - 1) : U.clamp(absolute, 0, order.length - 1);
      if (order[idx] !== game.mode) {
        game.setMode(order[idx]);
        game.ui.flashBanner('MODE ' + CFG.MODES[order[idx]].label, CFG.COLORS.accent);
        game.audio.play('pickup', { vol: 0.5 });
      }
    }
    function tryModeKeys() {
      if (input.consume('modeLeft')) changeMode(-1);
      else if (input.consume('modeRight')) changeMode(1);
      else {
        for (let i = 0; i < 5; i++) {
          if (input.consume('mode' + (i + 1))) { changeMode(undefined, i); break; }
        }
      }
    }

    /** Cycle / jump to a map (title screen only — the world is rebuilt on deploy). */
    function changeLevel(delta, absolute) {
      const order = CFG.LEVELS.map((l) => l.id);
      let idx = order.indexOf(game.levelId);
      if (idx < 0) idx = 0;
      idx = absolute === undefined ? (idx + delta + order.length) % order.length : U.clamp(absolute, 0, order.length - 1);
      if (order[idx] !== game.levelId) {
        game.setLevel(order[idx]);
        game.audio.play('pickup', { vol: 0.6 });
      }
    }
    function tryLevelKeys() {
      if (input.consume('levelLeft')) changeLevel(-1);
      else if (input.consume('levelRight')) changeLevel(1);
    }

    function hotkeys() {
      if (input.consume('mute')) game.audio.setMuted(!game.audio.muted);
      if (input.consume('toggleAuto')) {
        CFG.PLAYER.autoFire = !CFG.PLAYER.autoFire;
        game.ui.flashBanner(CFG.PLAYER.autoFire ? 'AUTO-FIRE ON' : 'MANUAL FIRE', CFG.COLORS.accent);
      }
      if (input.consume('debug')) {
        CFG.DEBUG.showHitboxes = !CFG.DEBUG.showHitboxes;
        CFG.DEBUG.showGrid = CFG.DEBUG.showHitboxes;
      }
      if (input.consume('restart')) { game.audio.unlock(); game.restart(); return; }

      switch (game.state) {
        case 'title':
          tryModeKeys();
          tryLevelKeys();
          if (input.consume('start')) game.start();
          break;
        case 'playing':
          if (input.consume('pause')) game.state = 'paused';
          break;
        case 'paused':
          tryModeKeys();
          if (input.consume('pause') || input.consume('start')) game.state = 'playing';
          break;
        case 'levelup': {
          const keys = ['card1', 'card2', 'card3'];
          for (let i = 0; i < keys.length; i++) {
            if (input.consume(keys[i]) && game.cards[i]) { takeCard(i); break; }
          }
          break;
        }
        case 'won': case 'lost':
          tryModeKeys();
          if (input.consume('start')) game.restart();
          break;
      }
    }

    function takeCard(i) { game.takeCard(i); }

    // Clicks: pick a map chip / deploy / restart / pick a card.
    function viewPoint(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      return {
        vx: (clientX - r.left - view.offsetX) / view.scale,
        vy: (clientY - r.top - view.offsetY) / view.scale,
      };
    }
    canvas.addEventListener('mousedown', (e) => {
      game.audio.unlock();
      if (e.button !== 0) return;
      if (game.state === 'title') {
        const pt = viewPoint(e.clientX, e.clientY);
        const lvRect = (game.ui.levelRects || []).find((r2) => U.boxHit(r2, pt.vx, pt.vy));
        if (lvRect) { game.setLevel(lvRect.id); game.audio.play('pickup', { vol: 0.6 }); return; }
        game.start();
        return;
      }
      if (game.state === 'won' || game.state === 'lost') { game.restart(); return; }
      if (game.state === 'levelup' && game.ui.hover >= 0) takeCard(game.ui.hover);
    });
    // Touch: treat as a tap for menus.
    canvas.addEventListener('touchstart', (e) => {
      game.audio.unlock();
      const t = e.touches[0];
      if (t) {
        const r = canvas.getBoundingClientRect();
        input.mouse.x = t.clientX - r.left; input.mouse.y = t.clientY - r.top;
        input.mouse.inside = true;
        if (game.state === 'title') {
          const pt = viewPoint(t.clientX, t.clientY);
          const lvRect = (game.ui.levelRects || []).find((r2) => U.boxHit(r2, pt.vx, pt.vy));
          if (lvRect) { game.setLevel(lvRect.id); game.audio.play('pickup', { vol: 0.6 }); return; }
        }
      }
      if (game.state === 'title') game.start();
      else if (game.state === 'won' || game.state === 'lost') game.restart();
      else if (game.state === 'levelup' && game.ui.hover >= 0) takeCard(game.ui.hover);
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && game.state === 'playing') game.state = 'paused';
    });

    /* --------------------------------------------------------- loop ------ */
    let last = performance.now(), acc = 0, fpsT = 0, fpsN = 0;

    function frame(now) {
      requestAnimationFrame(frame);
      let dt = (now - last) / 1000;
      last = now;
      if (!(dt > 0)) dt = 0;
      if (dt > MAX_FRAME) dt = MAX_FRAME;

      // fps meter
      fpsT += dt; fpsN++;
      if (fpsT >= 0.5) { game.fps = fpsN / fpsT; fpsT = 0; fpsN = 0; }

      input.frame(dt, now / 1000);
      game.view = view;
      hotkeys();
      game.ui.hoverCards(input, view, game.state === 'levelup');
      if (game.ui.clickedCard(input) >= 0 && game.state === 'levelup') takeCard(game.ui.hover);

      acc += dt;
      let steps = 0;
      while (acc >= FIXED && steps < 8) { game.update(FIXED, input); acc -= FIXED; steps++; }
      if (steps === 8) acc = 0;   // give up on catching up rather than lock-stepping

      game.draw(ctx, view, dpr, input);
      input.endFrame();
    }
    requestAnimationFrame(frame);
  }

  // Surface fatal errors on-screen: much easier to debug from file:// on Windows.
  function showError(msg) {
    const el = document.getElementById('boot');
    if (el) { el.style.display = 'grid'; el.innerHTML = '<div style="max-width:640px;text-align:center;line-height:1.6">BOOT ERROR<br><span style="color:#ff8a8a">' + String(msg) + '</span></div>'; }
    console.error(msg);
  }

  window.addEventListener('error', (e) => showError(e.message));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { try { boot(); } catch (e) { showError(e && e.stack || e); } });
  else { try { boot(); } catch (e) { showError(e && e.stack || e); } }
})(window.WARS || (window.WARS = {}));