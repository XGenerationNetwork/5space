/* 5Space - greens.
 *
 * A "green" is SubSpace's prize: a small rotating gem that sits in open space
 * and gives you something when you fly over it.  Every green in the sky looks
 * exactly the same, and you do not find out what is inside until you take it.
 * That is the original 1997 behaviour, and it happens to be the same idea as
 * NetHack's unidentified potions - so the roguelike layer here is not a
 * transplant, it is the mechanic SubSpace already had, given a discovery
 * screen and consequences that persist for the whole run.
 *
 * Some greens are *negative* and take something away.  Deeper sectors weight
 * the table further towards negatives, which is what makes a green near the
 * Core a genuine decision rather than a reflex.
 *
 * The enumeration order is Continuum's, so prize ids match what a zone would
 * send on the wire.
 */
(function (SS) {
  'use strict';

  var P = {
    None: 0, Recharge: 1, Energy: 2, Rotation: 3, Stealth: 4, Cloak: 5,
    XRadar: 6, Warp: 7, Guns: 8, Bombs: 9, BouncingBullets: 10, Thruster: 11,
    TopSpeed: 12, FullCharge: 13, EngineShutdown: 14, MultiFire: 15,
    Proximity: 16, Super: 17, Shields: 18, Shrapnel: 19, AntiWarp: 20,
    Repel: 21, Burst: 22, Decoy: 23, Thor: 24, MultiPrize: 25, Brick: 26,
    Rocket: 27, Portal: 28
  };
  SS.P = P;

  /* kinds decide how a prize is applied and how it is described:
       'stat'   - nudges a handling number up or down
       'toggle' - grants or removes an ability
       'level'  - steps a weapon level within the ship's range
       'count'  - adds or removes a stock of a limited-use item
       'burst'  - an immediate effect with no lasting record
       'timed'  - a temporary status
       'meta'   - resolves into other prizes                                */

  var PRIZES = [
    { id: P.Recharge, name: 'Recharge', kind: 'stat', stat: 'recharge',
      up: 'Charge rate increased.', down: 'Charge rate decreased.',
      weight: 100, note: 'Energy comes back faster.' },

    { id: P.Energy, name: 'Energy', kind: 'stat', stat: 'energy',
      up: 'Maximum energy level increased.', down: 'Maximum energy level decreased.',
      weight: 100, note: 'A deeper pool to spend and to survive on.' },

    { id: P.Rotation, name: 'Rotation', kind: 'stat', stat: 'rotation',
      up: 'Rotation speed increased.', down: 'Rotation speed decreased.',
      weight: 90, note: 'The ship comes round faster.' },

    { id: P.Stealth, name: 'Stealth', kind: 'toggle', flag: 'stealth',
      up: 'Stealth available.', down: 'Stealth lost.',
      weight: 40, requires: 'HasStealth',
      note: 'Hold it on and you vanish from enemy radar.' },

    { id: P.Cloak, name: 'Cloak', kind: 'toggle', flag: 'cloak',
      up: 'Cloak available.', down: 'Cloak lost.',
      weight: 35, requires: 'HasCloak',
      note: 'Hold it on and you vanish from sight entirely.' },

    { id: P.XRadar, name: 'X-Radar', kind: 'toggle', flag: 'xradar',
      up: 'X-Radar available.', down: 'X-Radar lost.',
      weight: 45, requires: 'HasXRadar',
      note: 'See enemies through walls, for a steady energy drain.' },

    { id: P.Warp, name: 'Warp', kind: 'burst',
      up: 'Warp!', down: 'Warp!',
      weight: 25, neverRandom: true,
      note: 'Throws you somewhere else in the sector, ready or not.' },

    { id: P.Guns, name: 'Guns', kind: 'level', level: 'guns',
      up: 'Guns upgraded.', down: 'Guns downgraded.',
      weight: 110, note: 'Bullets hit harder.' },

    { id: P.Bombs, name: 'Bombs', kind: 'level', level: 'bombs',
      up: 'Bombs upgraded.', down: 'Bombs downgraded.',
      weight: 85, note: 'A bigger blast and a wider proximity trigger.' },

    { id: P.BouncingBullets, name: 'Bouncing Bullets', kind: 'toggle', flag: 'bouncing',
      up: 'Bouncing bullets.', down: 'Bouncing bullets lost.',
      weight: 45, requires: 'HasBouncingBullets',
      note: 'Bullets ricochet off walls instead of dying on them.' },

    { id: P.Thruster, name: 'Thruster', kind: 'stat', stat: 'thrust',
      up: 'Thrusters upgraded.', down: 'Thrusters downgraded.',
      weight: 95, note: 'Faster acceleration out of a standstill.' },

    { id: P.TopSpeed, name: 'Top Speed', kind: 'stat', stat: 'speed',
      up: 'Top speed increased.', down: 'Top speed reduced.',
      weight: 95, note: 'A higher ceiling on velocity.' },

    { id: P.FullCharge, name: 'Full Charge', kind: 'burst',
      up: 'Full charge.', down: 'Energy depleted.',
      weight: 70, note: 'Refills the energy bar on the spot.' },

    { id: P.EngineShutdown, name: 'Engine Shutdown', kind: 'timed', status: 'shutdown',
      up: 'Engines shut-down.', down: 'Engines shut-down (severe).',
      weight: 40, alwaysNegative: true, neverRandom: true,
      note: 'Thrust and steering die for a few very long seconds.' },

    { id: P.MultiFire, name: 'MultiFire', kind: 'toggle', flag: 'multifire',
      up: 'MultiFire bullets.', down: 'MultiFire lost.',
      weight: 50, requires: 'HasMultiFire',
      note: 'Fire a three-bullet spread instead of one shot.' },

    { id: P.Proximity, name: 'Proximity', kind: 'toggle', flag: 'proximity',
      up: 'Proximity bombs.', down: 'Proximity bombs lost.',
      weight: 55, requires: 'HasProximity',
      note: 'Bombs detonate when something comes near, not on contact.' },

    { id: P.Super, name: 'Super', kind: 'timed', status: 'super',
      up: 'Temporary SuperPower!', down: '',
      weight: 8, neverNegative: true, neverRandom: true,
      note: 'Briefly invulnerable, and everything you fire is at full power.' },

    { id: P.Shields, name: 'Shields', kind: 'timed', status: 'shields',
      up: 'Temporary Shields.', down: '',
      weight: 12, neverNegative: true, neverRandom: true,
      note: 'Absorbs every hit for a few seconds.' },

    { id: P.Shrapnel, name: 'Shrapnel', kind: 'stat', stat: 'shrapnel',
      up: 'Shrapnel increased.', down: 'Shrapnel reduced.',
      weight: 60, requires: 'HasShrapnel',
      note: 'Your bombs throw more fragments when they burst.' },

    { id: P.AntiWarp, name: 'AntiWarp', kind: 'toggle', flag: 'antiwarp',
      up: 'AntiWarp available.', down: 'AntiWarp lost.',
      weight: 30, requires: 'HasAntiWarp',
      note: 'Holds nearby enemies in place; they cannot warp out.' },

    { id: P.Repel, name: 'Repel', kind: 'count', count: 'repel',
      up: 'Repeller increased.', down: 'Repeller lost.',
      weight: 55, note: 'Shoves everything nearby - ships and shots alike - away.' },

    { id: P.Burst, name: 'Burst', kind: 'count', count: 'burst',
      up: 'Burst increased.', down: 'Burst lost.',
      weight: 50, note: 'A ring of bouncing bullets fired in every direction.' },

    { id: P.Decoy, name: 'Decoy', kind: 'count', count: 'decoy',
      up: 'Decoy increased.', down: 'Decoy lost.',
      weight: 45, note: 'A mirror image that flies your heading and draws fire.' },

    { id: P.Thor, name: "Thor's Hammer", kind: 'count', count: 'thor',
      up: "Thor's hammer increased.", down: "Thor's hammer lost.",
      weight: 14, note: 'A bomb that passes through walls and ignores shields.' },

    { id: P.MultiPrize, name: 'MultiPrize', kind: 'meta',
      up: 'MultiPrize!', down: '',
      weight: 18, neverNegative: true, neverRandom: true,
      note: 'Resolves into a handful of other greens at once.' },

    { id: P.Brick, name: 'Brick', kind: 'count', count: 'brick',
      up: 'Brick increased.', down: 'Brick lost.',
      weight: 35, note: 'Drops a short wall in front of you. Blocks shots and ships.' },

    { id: P.Rocket, name: 'Rocket', kind: 'count', count: 'rocket',
      up: 'Rocket increased.', down: 'Rocket lost.',
      weight: 30, note: 'A few seconds of thrust and speed far past your ceiling.' },

    { id: P.Portal, name: 'Portal', kind: 'count', count: 'portal',
      up: 'Portal increased.', down: 'Portal lost.',
      weight: 32, note: 'Drop a beacon, then warp back to it from anywhere in the sector.' }
  ];

  SS.PRIZES = PRIZES;

  var byId = {};
  PRIZES.forEach(function (p) { byId[p.id] = p; });
  SS.prizeById = function (id) { return byId[Math.abs(id)] || null; };

  /* ------------------------------------------------------------------ */
  /* rolling a green                                                    */
  /* ------------------------------------------------------------------ */

  /* Which prizes this ship can meaningfully receive.  There is no point
     handing a Warbird a Cloak it can never mount, so those are filtered out
     of its table entirely - the same way a zone sets PrizeWeight to zero. */
  SS.prizeTableFor = function (shipDef) {
    var s = shipDef.settings;
    return PRIZES.filter(function (p) {
      if (p.neverRandom) return false;
      if (p.requires && !s[p.requires]) return false;
      if (p.kind === 'level' && p.level === 'bombs' && s.MaximumBombs <= 0) return false;
      if (p.kind === 'count') {
        var cap = 'Maximum' + p.name.replace(/[^A-Za-z]/g, '').replace(/^Thors.*/, 'Thor');
        if (p.count === 'repel') cap = 'MaximumRepel';
        else if (p.count === 'burst') cap = 'MaximumBurst';
        else if (p.count === 'decoy') cap = 'MaximumDecoy';
        else if (p.count === 'thor') cap = 'MaximumThor';
        else if (p.count === 'brick') cap = 'MaximumBrick';
        else if (p.count === 'rocket') cap = 'MaximumRocket';
        else if (p.count === 'portal') cap = 'MaximumPortal';
        if (!s[cap]) return false;
      }
      return true;
    });
  };

  /* Roll the contents of a green.  Returns a signed prize id: negative means
     the green takes the thing away instead of giving it.  `negativeFactor` is
     "one green in this many is negative", as the arena setting reads. */
  SS.rollPrize = function (shipDef, negativeFactor) {
    var table = SS.prizeTableFor(shipDef);
    var chosen = SS.pickWeighted(table);
    if (!chosen) return P.FullCharge;
    var id = chosen.id;
    if (!chosen.neverNegative && negativeFactor > 0 && SS.rn2(negativeFactor) === 0) {
      return -id;
    }
    return id;
  };

  /* Specials never come out of the ordinary table; they are seeded onto the
     map deliberately, in guarded places, so that finding one means something. */
  SS.SPECIAL_PRIZES = [P.Super, P.Shields, P.MultiPrize, P.Thor];

  /* Deeper sectors sour the well. */
  SS.negativeFactorFor = function (depth) {
    var base = SS.ARENA.PrizeNegativeFactor;
    var f = Math.round(base - (depth - 1) * 0.35);
    return Math.max(4, f);
  };

  /* ------------------------------------------------------------------ */
  /* the discovery log                                                  */
  /* ------------------------------------------------------------------ */

  /* Greens are anonymous, so the only way a pilot learns the table is by
     keeping count.  `game.prizeLog` maps prize id -> {took, lost}; this
     renders it for the discoveries screen. */
  SS.describePrizeLog = function (log) {
    var rows = [];
    var known = PRIZES.filter(function (p) {
      var e = log[p.id];
      return e && (e.took || e.lost);
    });
    if (!known.length) {
      rows.push({ text: '  You have not opened a single green yet.' });
      return rows;
    }
    known.sort(function (a, b) {
      var ea = log[a.id], eb = log[b.id];
      return (eb.took + eb.lost) - (ea.took + ea.lost);
    });
    rows.push({ header: true, text: 'Greens opened' });
    known.forEach(function (p) {
      var e = log[p.id];
      var line = '  ' + pad(p.name, 18) + pad('+' + e.took, 6) +
        (e.lost ? pad('-' + e.lost, 6) : pad('', 6)) + p.note;
      rows.push({ text: line });
    });
    return rows;
  };

  function pad(s, n) {
    s = String(s);
    while (s.length < n) s += ' ';
    return s;
  }

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
