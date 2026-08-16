/* 5Space - the eight ships, and the arena settings they fly under.
 *
 * The field names and units are Continuum's, taken from the ArenaSettings
 * layout that nullspace documents, so that anyone who has read a zone's
 * server.cfg will recognise every number here:
 *
 *   MaximumRotation   400 = one full revolution per second  (rot/400 rev/s)
 *   MaximumThrust     acceleration in tiles/s^2 is thrust * 10/16
 *   MaximumSpeed      top speed in tiles/s is speed / 160
 *   MaximumRecharge   energy per second is recharge / 10
 *   BulletSpeed       pixels/second/10, so tiles/s is speed / 160
 *   AfterburnerEnergy energy per second is the value / 10, as recharge is
 *   Radius            collision radius in pixels (16 pixels to a tile)
 *   *Energy           raw energy units, deducted from the energy pool
 *
 * The Initial* values are what a fresh ship flies with; the Maximum* values
 * are the ceiling that greens can lift it to.  That gap is the whole
 * progression curve of the game, and it is why an unprized Leviathan handles
 * like a barge while a fully-prized one is terrifying.
 */
(function (SS) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* arena-wide settings                                                */
  /* ------------------------------------------------------------------ */

  SS.ARENA = {
    /* damage */
    BulletDamageLevel: 190,       // L1 bullet
    BulletDamageUpgrade: 105,     // added per gun level
    BombDamageLevel: 1400,        // at the centre of the blast
    BurstDamageLevel: 400,
    InactiveShrapDamage: 120,     // shrapnel in its first quarter second
    ShrapnelDamage: 240,

    /* lifetimes, in seconds (Continuum quotes these in ticks of 1/100s) */
    BulletAliveTime: 3.5,
    BombAliveTime: 8.0,
    MineAliveTime: 120.0,
    DecoyAliveTime: 30.0,
    BurstAliveTime: 2.0,

    /* bombs */
    BombExplodePixels: 80,        // L1 blast radius; L2 doubles, L3 triples
    BombExplodeDelay: 0.10,       // proximity trigger to detonation
    ProximityDistance: 3,         // tiles, +1 per bomb level
    ShrapnelSpeed: 2200,
    ShrapnelRate: 2,              // extra shrapnel per Shrapnel green
    ShrapnelMax: 12,

    /* utility */
    RepelSpeed: 5000,
    RepelDistance: 300,           // pixels
    RepelTime: 0.5,
    EngineShutdownTime: 4.0,
    SafetyLimit: 25.0,            // seconds you may loiter in a safe zone
    WormholeSwitchTime: 30.0,
    EnterDelay: 2.0,

    /* collision */
    BounceFactor: 14,             // 16 = no speed lost to a wall bounce
    WallDamage: 0,                // walls bruise your speed, not your energy

    /* greens */
    PrizeFactor: 34,              // greens per 1000 tiles of open space
    PrizeDelay: 12.0,             // respawn delay for a taken green
    PrizeNegativeFactor: 14,      // 1 green in this many is a negative
    PrizeMaxExist: 20.0,
    MinimumVirtual: 8,
    DeathPrizeTime: 20.0,         // how long a kill's spilled greens last

    /* scoring */
    BountyIncreaseForKill: 2,
    FlaggerKillMultiplier: 2,
    RewardBase: 100
  };

  /* Continuum measures the world in pixels and the map in tiles. */
  SS.PIXELS_PER_TILE = 16;
  SS.TICK_RATE = 100;            // simulation ticks per second
  SS.TICK_DT = 1 / 100;

  /* ------------------------------------------------------------------ */
  /* the ships                                                          */
  /* ------------------------------------------------------------------ */

  /* Shared defaults so each ship only states what makes it itself. */
  function ship(def) {
    var s = {
      /* handling */
      InitialRotation: 250, MaximumRotation: 400, UpgradeRotation: 25,
      InitialThrust: 15, MaximumThrust: 27, UpgradeThrust: 2,
      InitialSpeed: 3000, MaximumSpeed: 4800, UpgradeSpeed: 150,
      InitialRecharge: 1000, MaximumRecharge: 1800, UpgradeRecharge: 80,
      InitialEnergy: 1000, MaximumEnergy: 1900, UpgradeEnergy: 90,

      /* armament */
      InitialGuns: 1, MaximumGuns: 3,
      InitialBombs: 1, MaximumBombs: 2,
      InitialMines: 0, MaximumMines: 0,
      BulletSpeed: 4000, BombSpeed: 2800,
      BulletFireEnergy: 180, MultiFireEnergy: 240,
      BombFireEnergy: 500, BombFireEnergyUpgrade: 200,
      LandmineFireEnergy: 700, LandmineFireEnergyUpgrade: 250,
      BombThrust: 300,             // back-thrust when a bomb leaves the tube
      MultiFireAngle: 1500,        // 1000 = one rotation point
      BurstSpeed: 3000,

      /* what the ship may ever have */
      InitialBurst: 0, MaximumBurst: 0,
      InitialRepel: 0, MaximumRepel: 0,
      InitialThor: 0, MaximumThor: 0,
      InitialDecoy: 0, MaximumDecoy: 0,
      InitialRocket: 0, MaximumRocket: 0,
      InitialBrick: 0, MaximumBrick: 0,
      InitialPortal: 0, MaximumPortal: 0,

      /* Held-down energy drains.  Continuum quotes these in the same
         tenths-per-second as recharge, so 1300 is 130 energy a second - which
         is deliberately close to what a hull recharges.  Holding the
         afterburner down should roughly cancel your regeneration, not empty
         the bar in three seconds. */
      AfterburnerEnergy: 1300,
      CloakEnergy: 0, StealthEnergy: 0, XRadarEnergy: 0, AntiWarpEnergy: 0,

      /* the ship is only allowed the toggles it lists */
      HasCloak: false, HasStealth: false, HasXRadar: false, HasAntiWarp: false,
      HasMultiFire: false, HasProximity: true, HasBouncingBullets: true,
      HasShrapnel: false,

      /* physical */
      Radius: 14,
      Gravity: 500, GravityTopSpeed: 2000,
      SeeBombLevel: 1,
      SuperTime: 8.0, ShieldsTime: 8.0
    };
    Object.keys(def).forEach(function (k) { s[k] = def[k]; });
    return s;
  }

  var SHIPS = {
    warbird: {
      code: 'w', index: 0, name: 'Warbird', color: '#ff5555',
      blurb: 'The duelist. Heavy guns, a punishing bomb, and enough energy ' +
             'to trade shots - but it recharges slowly, so every miss costs.',
      hint: 'Straightforward and forgiving. A good first ship.',
      settings: ship({
        InitialRotation: 250, MaximumRotation: 400,
        InitialThrust: 15, MaximumThrust: 27,
        InitialSpeed: 2800, MaximumSpeed: 4600,
        InitialRecharge: 900, MaximumRecharge: 1650, UpgradeRecharge: 75,
        InitialEnergy: 1100, MaximumEnergy: 2000,
        InitialGuns: 1, MaximumGuns: 3,
        InitialBombs: 1, MaximumBombs: 3,
        BulletSpeed: 4200, BombSpeed: 3000,
        BulletFireEnergy: 170, BombFireEnergy: 480,
        MaximumBurst: 3, MaximumRepel: 3, MaximumDecoy: 2, MaximumThor: 1,
        HasMultiFire: true, HasShrapnel: true,
        Radius: 14
      })
    },

    javelin: {
      code: 'j', index: 1, name: 'Javelin', color: '#ffaa33',
      blurb: 'A bomb rack with an engine bolted on. Fast, agile, lethal at ' +
             'range - and made of paper, with guns that barely scratch.',
      hint: 'Rewards leading your shots and knowing the map. Punishes brawling.',
      settings: ship({
        InitialRotation: 300, MaximumRotation: 450, UpgradeRotation: 30,
        InitialThrust: 18, MaximumThrust: 32,
        InitialSpeed: 3200, MaximumSpeed: 5200,
        InitialRecharge: 1000, MaximumRecharge: 1800,
        InitialEnergy: 850, MaximumEnergy: 1600, UpgradeEnergy: 75,
        InitialGuns: 1, MaximumGuns: 2,
        InitialBombs: 1, MaximumBombs: 4,
        BulletSpeed: 3800, BombSpeed: 3400,
        BulletFireEnergy: 220, BombFireEnergy: 380, BombFireEnergyUpgrade: 150,
        BombThrust: 450,
        MaximumBurst: 2, MaximumDecoy: 3, MaximumThor: 2, MaximumRocket: 2,
        HasShrapnel: true,
        Radius: 13
      })
    },

    spider: {
      code: 's', index: 2, name: 'Spider', color: '#55ff88',
      blurb: 'Recharges faster than anything else in the sky. Small energy ' +
             'pool, weak bombs, but it can keep firing when others are dry.',
      hint: 'Attrition. Stay at range, never stop shooting, never take a bomb.',
      settings: ship({
        InitialRotation: 320, MaximumRotation: 480, UpgradeRotation: 30,
        InitialThrust: 17, MaximumThrust: 30,
        InitialSpeed: 3300, MaximumSpeed: 5300,
        InitialRecharge: 1350, MaximumRecharge: 2500, UpgradeRecharge: 115,
        InitialEnergy: 750, MaximumEnergy: 1450, UpgradeEnergy: 70,
        InitialGuns: 1, MaximumGuns: 3,
        InitialBombs: 0, MaximumBombs: 1,
        BulletSpeed: 4400, BombSpeed: 2400,
        BulletFireEnergy: 140, MultiFireEnergy: 195, BombFireEnergy: 520,
        MaximumBurst: 2, MaximumRepel: 2, MaximumPortal: 2,
        HasMultiFire: true, HasXRadar: true, XRadarEnergy: 200,
        Radius: 12
      })
    },

    leviathan: {
      code: 'l', index: 3, name: 'Leviathan', color: '#cc66ff',
      blurb: 'A capital ship. Enormous energy, a bomb that clears a room, ' +
             'and the turning circle of a continent.',
      hint: 'Slow, obvious, and very hard to kill. Corridors are your enemy.',
      settings: ship({
        AfterburnerEnergy: 1700,
        InitialRotation: 170, MaximumRotation: 290, UpgradeRotation: 20,
        InitialThrust: 10, MaximumThrust: 20, UpgradeThrust: 1,
        InitialSpeed: 2200, MaximumSpeed: 3800, UpgradeSpeed: 120,
        InitialRecharge: 800, MaximumRecharge: 1500, UpgradeRecharge: 70,
        InitialEnergy: 1600, MaximumEnergy: 3000, UpgradeEnergy: 130,
        InitialGuns: 1, MaximumGuns: 2,
        InitialBombs: 1, MaximumBombs: 4,
        BulletSpeed: 3600, BombSpeed: 2200,
        BulletFireEnergy: 240, BombFireEnergy: 620, BombFireEnergyUpgrade: 230,
        BombThrust: 600,
        MaximumBurst: 3, MaximumRepel: 4, MaximumThor: 3, MaximumBrick: 2,
        HasShrapnel: true,
        Radius: 16, Gravity: 900
      })
    },

    terrier: {
      code: 't', index: 4, name: 'Terrier', color: '#ffff66',
      blurb: 'The support hull. It carries portals, bursts and repels, and ' +
             'recharges well - but it cannot hurt anything on its own.',
      hint: 'Survival and mobility over damage. The portal is your escape hatch.',
      settings: ship({
        InitialRotation: 280, MaximumRotation: 420,
        InitialThrust: 16, MaximumThrust: 28,
        InitialSpeed: 3000, MaximumSpeed: 4900,
        InitialRecharge: 1250, MaximumRecharge: 2250, UpgradeRecharge: 100,
        InitialEnergy: 1000, MaximumEnergy: 1900,
        InitialGuns: 1, MaximumGuns: 2,
        InitialBombs: 0, MaximumBombs: 1,
        BulletSpeed: 3700, BombSpeed: 2400,
        BulletFireEnergy: 200, BombFireEnergy: 570,
        InitialBurst: 2, MaximumBurst: 6,
        InitialRepel: 2, MaximumRepel: 6,
        InitialPortal: 1, MaximumPortal: 4,
        MaximumDecoy: 3, MaximumBrick: 3,
        HasXRadar: true, XRadarEnergy: 150,
        HasAntiWarp: true, AntiWarpEnergy: 300,
        Radius: 14
      })
    },

    weasel: {
      code: 'e', index: 5, name: 'Weasel', color: '#66ddff',
      blurb: 'Cloak, stealth and the fastest hull in the game. Everything ' +
             'else about it is a liability, including the energy pool.',
      hint: 'You choose every fight. Lose one and you are already dead.',
      settings: ship({
        InitialRotation: 350, MaximumRotation: 520, UpgradeRotation: 35,
        InitialThrust: 20, MaximumThrust: 36, UpgradeThrust: 3,
        InitialSpeed: 3600, MaximumSpeed: 5800, UpgradeSpeed: 180,
        InitialRecharge: 1100, MaximumRecharge: 2000,
        InitialEnergy: 700, MaximumEnergy: 1350, UpgradeEnergy: 65,
        InitialGuns: 1, MaximumGuns: 3,
        InitialBombs: 0, MaximumBombs: 2,
        BulletSpeed: 4600, BombSpeed: 3000,
        BulletFireEnergy: 155, MultiFireEnergy: 205, BombFireEnergy: 450,
        MaximumBurst: 2, MaximumDecoy: 4, MaximumPortal: 3, MaximumRocket: 3,
        HasMultiFire: true,
        HasCloak: true, CloakEnergy: 300,
        HasStealth: true, StealthEnergy: 200,
        HasXRadar: true, XRadarEnergy: 150,
        AfterburnerEnergy: 950,
        Radius: 11
      })
    },

    lancaster: {
      code: 'a', index: 6, name: 'Lancaster', color: '#88aaff',
      blurb: 'Bouncing bullets from the moment it launches, a decent bomb, ' +
             'and no weakness sharp enough to name.',
      hint: 'The all-rounder. Ricochets make tight corridors deadly for others.',
      settings: ship({
        InitialRotation: 270, MaximumRotation: 410,
        InitialThrust: 16, MaximumThrust: 28,
        InitialSpeed: 3000, MaximumSpeed: 4900,
        InitialRecharge: 1050, MaximumRecharge: 1900,
        InitialEnergy: 1000, MaximumEnergy: 1850,
        InitialGuns: 1, MaximumGuns: 3,
        InitialBombs: 1, MaximumBombs: 3,
        InitialMines: 0, MaximumMines: 2,
        BulletSpeed: 4000, BombSpeed: 2800,
        BulletFireEnergy: 185, BombFireEnergy: 460,
        MaximumBurst: 3, MaximumRepel: 2, MaximumDecoy: 2,
        MaximumThor: 1, MaximumPortal: 2,
        HasMultiFire: true, HasShrapnel: true,
        StartsBouncing: true,
        Radius: 14
      })
    },

    shark: {
      code: 'k', index: 7, name: 'Shark', color: '#ff77cc',
      blurb: 'Mines and repels. It cannot win a straight fight, so it makes ' +
             'sure there are no straight fights.',
      hint: 'Denial. Seed a corridor, pull the pursuit into it, leave.',
      settings: ship({
        InitialRotation: 310, MaximumRotation: 460, UpgradeRotation: 30,
        InitialThrust: 17, MaximumThrust: 30,
        InitialSpeed: 3200, MaximumSpeed: 5100,
        InitialRecharge: 1150, MaximumRecharge: 2050,
        InitialEnergy: 800, MaximumEnergy: 1500, UpgradeEnergy: 70,
        InitialGuns: 1, MaximumGuns: 2,
        InitialBombs: 0, MaximumBombs: 2,
        InitialMines: 2, MaximumMines: 4,
        BulletSpeed: 3900, BombSpeed: 2600,
        BulletFireEnergy: 205, BombFireEnergy: 490,
        LandmineFireEnergy: 550, LandmineFireEnergyUpgrade: 200,
        InitialRepel: 3, MaximumRepel: 8,
        InitialBurst: 1, MaximumBurst: 4,
        MaximumDecoy: 2, MaximumBrick: 4, MaximumPortal: 2,
        HasAntiWarp: true, AntiWarpEnergy: 250,
        HasShrapnel: true,
        Radius: 13
      })
    }
  };

  SS.SHIPS = SHIPS;

  SS.shipList = function () {
    return Object.keys(SHIPS).sort(function (a, b) {
      return SHIPS[a].index - SHIPS[b].index;
    });
  };

  SS.shipByIndex = function (i) {
    var names = SS.shipList();
    for (var k = 0; k < names.length; k++) {
      if (SHIPS[names[k]].index === i) return names[k];
    }
    return names[0];
  };

  /* ------------------------------------------------------------------ */
  /* pilot ranks                                                        */
  /* ------------------------------------------------------------------ */

  /* Rank comes from total points, the way a zone's ladder works, and is
     purely a title - it grants nothing.  It is the equivalent of a NetHack
     rank title, and exists for the same reason: so the death screen has
     something to say about who you were. */

  var RANKS = [
    { at: 0,      title: 'Recruit' },
    { at: 500,    title: 'Ensign' },
    { at: 1500,   title: 'Pilot' },
    { at: 3500,   title: 'Wing Pilot' },
    { at: 7000,   title: 'Lieutenant' },
    { at: 13000,  title: 'Squad Leader' },
    { at: 22000,  title: 'Commander' },
    { at: 36000,  title: 'Wing Commander' },
    { at: 58000,  title: 'Captain' },
    { at: 90000,  title: 'Fleet Captain' },
    { at: 140000, title: 'Admiral' },
    { at: 220000, title: 'Warlord' }
  ];
  SS.RANKS = RANKS;

  SS.rankTitle = function (points) {
    var title = RANKS[0].title;
    for (var i = 0; i < RANKS.length; i++) {
      if (points >= RANKS[i].at) title = RANKS[i].title;
    }
    return title;
  };

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
