/* WARS — level-up upgrades. Data + an apply(fighter) hook.
   `stacks: Infinity` means it can be picked repeatedly. */
(function (W) {
  'use strict';

  const LIST = [
    { id: 'dmg', name: 'Hollow Points', tier: 1, max: 8, desc: '+18% damage', apply: (p) => { p.dmgMul += 0.18; } },
    { id: 'rate', name: 'Oiled Bolt', tier: 1, max: 8, desc: '+14% fire rate', apply: (p) => { p.rateMul *= 0.86; } },
    { id: 'speed', name: 'Light Boots', tier: 1, max: 6, desc: '+9% move speed', apply: (p) => { p.speedMul += 0.09; } },
    { id: 'hp', name: 'Kevlar Vest', tier: 1, max: 8, desc: '+25 max HP, heal 25', apply: (p) => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); } },
    { id: 'pierce', name: 'Slugs', tier: 2, max: 4, desc: 'Bullets pierce +1', apply: (p) => { p.pierceBonus += 1; } },
    { id: 'pellet', name: 'Extra Barrel', tier: 3, max: 3, desc: '+1 pellet per shot', apply: (p) => { p.pelletBonus += 1; } },
    { id: 'range', name: 'Long Barrel', tier: 1, max: 5, desc: '+16% bullet life & auto-aim range', apply: (p) => { p.lifeMul += 0.16; p.aimRange += 70; } },
    { id: 'magnet', name: 'Scavenger', tier: 1, max: 5, desc: '+40% pickup magnet radius', apply: (p) => { p.magnet += 0.4; } },
    { id: 'heal', name: 'Field Medkit', tier: 1, max: 99, desc: 'Heal 45 now', apply: (p) => { p.hp = Math.min(p.maxHp, p.hp + 45); } },
    { id: 'armor', name: 'Ablative Plating', tier: 2, max: 5, desc: '-8% damage taken', apply: (p) => { p.armor = Math.min(0.6, p.armor + 0.08); } },
    { id: 'basehp', name: 'Reinforced Bunker', tier: 2, max: 6, desc: '+150 ally base HP (and heal)', apply: (p, game) => { if (game && game.playerBase) { game.playerBase.maxHp += 150; game.playerBase.hp += 150; } } },
    { id: 'turret', name: 'Turret Coolant', tier: 2, max: 5, desc: 'Ally base turret fires 15% faster', apply: (p, game) => { if (game && game.playerBase) game.playerBase.rateMul *= 0.85; } },
  ];

  const Upgrades = {
    LIST,
    byId: (id) => LIST.find((u) => u.id === id),

    /** Offer `n` distinct upgrade choices the player still has room for. */
    roll(player, n, rng) {
      const pool = LIST.filter((u) => (player.stacks[u.id] || 0) < (u.max === 99 ? 999 : u.max));
      const out = [];
      const copy = pool.slice();
      for (let i = 0; i < n && copy.length; i++) {
        const idx = (rng.next() * copy.length) | 0;
        out.push(copy.splice(idx, 1)[0]);
      }
      return out;
    },

    take(game, player, card) {
      player.stacks[card.id] = (player.stacks[card.id] || 0) + 1;
      card.apply(player, game);
      player.recompute?.();
    },
  };

  W.Upgrades = Upgrades;
})(window.WARS || (window.WARS = {}));