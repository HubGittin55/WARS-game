# WARS

**[▶ Play it live](https://hubgittin55.github.io/WARS-game/)** — the current `main` build, in your browser.

Top-down auto-shooter ("Contra meets bullet heaven") in plain HTML5 + canvas.
Two bases trade fire while you fight through the swarm between them. Shoot their
bunker to the ground before yours falls.

No build step, no bundler, no CDN, no ES modules, no assets — just `index.html`
and `src/*.js`. It runs from `file://` on Linux and Windows 11, offline, and every
sound is synthesised at runtime with WebAudio.

## Run it

**Easiest:** double-click `index.html` (or open it in any modern browser).

```sh
./run.sh                 # Linux: opens index.html in your default browser
./run.sh --serve         # Linux: serves on http://localhost:8080 instead
```

```bat
run.bat                  # Windows 11: opens index.html in your default browser
run.bat serve            # Windows 11: serves on http://localhost:8080 instead
```

Chromium browsers treat `file://` fine for this game (there are no XHR/fetch/module
loads), so a server is never required — it is only there in case you prefer one.

## Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move | `WASD` / arrows | left stick |
| Aim | mouse | right stick |
| Shoot | `Space` / `J` (auto-fire is on by default) | `A` / `RT` |
| Dash | `Shift` | `B` / left bumper |
| Toggle auto-fire | `F` | — |
| Pick a level-up card | `1` `2` `3` or click | `A` |
| Pause / restart / mute | `P` or `Esc` / `R` / `M` | `Start` |

Mouse aim is optional: if you never touch the mouse, auto-aim picks the nearest
hostile for you — including the enemy base when you are standing next to it, so a
walk-up becomes a point-blank beating. Auto-aim only snaps to a target within
±10° of your current aim line, so it will not yank your gun across the screen.

**Control scheme** is picked on the title screen (click it, or press `C` to cycle)
and is saved. KEYBOARD is the scheme above. MOUSE control steers with the mouse
instead: left-click a spot and the fighter walks there; hold left-click to keep
guiding him. The gun auto-aims while you steer (same ±10° snap rule).

## The loop

* **Your base and theirs** each run an automatic turret. Both have 1600 HP and soak
  only 50% of bullet damage, so killing bots matters more than spraying the wall.
* **Trees** are cover: they eat bullets and block walking. Shoot a canopy and it
  knocks fruit loose; **fruit heals 20 HP**.
* **Crates** spawn between the bases and hand you a real gun (SMG, shotgun, laser,
  rocket, minigun) for 20 seconds. Only you can take them.
* **Every kill is XP.** Level up pauses the world and deals three perk cards.
* **The Director** escalates: ~7 enemies alive at the start, creeping to 16, with
  early spawns marching out of their base and later ones dropping in off-camera.
  Bots are slow, sloppy and half-damage at t=0 and sharpen over ~4 minutes.
* You respawn at your own base when you go down; only the enemy base dying ends the
  run (in your favour). Losing your own base loses.

## Tuning

Everything gameplay-relevant lives in `src/config.js` — one object, commented.
The knobs that move difficulty the most:

| Knob | Meaning |
| --- | --- |
| `DIRECTOR.aliveCapBase` / `aliveCapPerMin` / `aliveCapMax` | how many enemies are allowed on the field, and how fast that grows |
| `DIRECTOR.ringChance` → `ringChanceLate` | share of spawns that drop just off-camera instead of marching from their base |
| `BOT.earlyDmgMul` / `lateDmgMul`, `earlySpreadMul` / `lateSpreadMul`, `earlyRateMul` / `lateRateMul` | the forgiveness ramp: bots at t=0 vs bots at 4 minutes |
| `TREE.dropPerSec`, `TREE.maxOnGround`, `FRUIT.heal` | your sustain — fruit is hard-capped at 2 drops/second and 10 on the field |
| `BASE.hp`, `BASE.dmgTakenMul`, `BASE.turretRange` | how long a base race lasts |

## Dev tools (Node, no dependencies)

```sh
bash tools/check.sh          # syntax + smoke + pressure curve + 8-seed playtest
node tools/smoke.js          # headless 40s sim + every draw path against a mock canvas
node tools/pressure.js 300   # alive / on-screen / damage-intake every 20s: the difficulty curve
node tools/playtest.js 420   # 8 seeded runs driven by a committed-but-dumb bot: pacing + win rate
```

`tools/harness.js` boots the real `src/*.js` files (in the order `index.html` loads
them) inside Node with just enough DOM stubs to simulate. The bot in it walks at the
enemy base, eats fruit when badly hurt and unsticks itself, but never dodges bullets —
so read its death counts as pessimistic and its wins as a floor.

## Layout

```
index.html        canvas, letterbox CSS, script order (this is the load order)
src/config.js     every tunable number
src/util.js       math, seeded RNG, tween/damp helpers
src/input.js      keyboard + mouse + gamepad, view->world mouse projection
src/audio.js      procedural SFX (no audio files)
src/camera.js     smoothed follow, aim look-ahead, shake, world clamping
src/weapons.js    weapon cards (pistol, SMG, shotgun, laser, rocket, minigun)
src/upgrades.js   the level-up card pool
src/entities.js   Bullet, Fighter, Base, Tree, Fruit, Pickup, Particle, FloatText
src/world.js      arena build, spatial grid, collisions, pickups, damage rules
src/ai.js         bot brain + bot archetypes
src/director.js   spawn pacing: waves, trickle, elites, crates, difficulty ramp
src/render.js     view fit, world/background, draw order, minimap
src/ui.js         HUD, banners, title/pause/level-up/game-over screens
src/game.js       state machine, player control, XP/levels, win/lose
src/main.js       canvas sizing, fixed-timestep loop, hotkeys, crash overlay
```

Fixed 960×540 logical resolution, letterboxed and DPR-aware, so the play area is
identical on every screen. Physics runs at a fixed 60 Hz with swept bullet collision
tests, so fast rounds cannot tunnel through anything.