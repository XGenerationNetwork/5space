/* 5Space - the ship: energy, handling, prizes, status, and flight.
 *
 * One structure serves the player and every enemy, because in SubSpace there
 * was never a difference - the thing chasing you was another pilot in one of
 * the same eight hulls, running the same numbers.  Keeping that true is what
 * makes an enemy Weasel behave like a Weasel: it is not scripted to be
 * evasive, it is evasive because it is flying a Weasel's settings.
 *
 * A ship's *current* handling numbers live in `stat`, separately from the
 * hull's Initial/Maximum settings.  Greens move `stat` around inside those
 * bounds, and that drift is the whole character progression of a run.
 */
(function (SS) {
  'use strict';

  var ship = {};
  SS.ship = ship;

  var nextShipId = 1;
  ship.resetIds = function (n) { nextShipId = n || 1; };
  ship.peekId = function () { return nextShipId; };

  /* ------------------------------------------------------------------ */
  /* construction                                                       */
  /* ------------------------------------------------------------------ */

  ship.create = function (key, opts) {
    opts = opts || {};
    var def = SS.SHIPS[key];
    if (!def) { key = 'warbird'; def = SS.SHIPS[key]; }
    var s = def.settings;

    var sh = {
      id: nextShipId++,
      shipKey: key,
      name: opts.name || def.name,
      team: opts.team || 'enemy',

      /* body */
      x: opts.x || 0, y: opts.y || 0,
      vx: 0, vy: 0,
      orient: opts.orient !== undefined ? opts.orient : SS.rng.float(),
      radius: s.Radius / 16,

      /* handling, as modified by greens */
      stat: {
        rotation: s.InitialRotation,
        thrust: s.InitialThrust,
        speed: s.InitialSpeed,
        recharge: s.InitialRecharge,
        energyCap: s.InitialEnergy,
        shrapnel: 0
      },

      /* armament levels */
      guns: s.InitialGuns,
      bombs: s.InitialBombs,
      mines: s.InitialMines,

      /* abilities the ship currently has (not necessarily switched on) */
      has: {
        stealth: false, cloak: false, xradar: false, antiwarp: false,
        multifire: false, proximity: false,
        bouncing: !!s.StartsBouncing
      },

      /* limited-use stock */
      count: {
        repel: s.InitialRepel, burst: s.InitialBurst, decoy: s.InitialDecoy,
        thor: s.InitialThor, brick: s.InitialBrick, rocket: s.InitialRocket,
        portal: s.InitialPortal
      },

      /* held-down toggles */
      on: { stealth: false, cloak: false, xradar: false, antiwarp: false },

      /* timed status, all in seconds remaining */
      timer: {
        super: 0, shields: 0, shutdown: 0, rocket: 0, emp: 0,
        repelActive: 0, safety: 0, spawnGuard: 0
      },

      energy: s.InitialEnergy,
      bounty: 0,
      kills: 0,
      deaths: 0,

      /* cooldowns */
      cd: { bullet: 0, bomb: 0, mine: 0, utility: 0 },

      portalDrop: null,      // {x,y} beacon dropped in this sector
      hasFlag: false,
      alive: true,
      lastHitBy: null
    };

    if (opts.x !== undefined) sh.x = opts.x;
    if (opts.y !== undefined) sh.y = opts.y;
    return sh;
  };

  ship.def = function (sh) { return SS.SHIPS[sh.shipKey]; };
  ship.settings = function (sh) { return SS.SHIPS[sh.shipKey].settings; };

  /* Convenience accessors in real units. */
  ship.maxSpeed = function (sh) {
    if (sh.timer.rocket > 0) return SS.physics.speedToTiles(ship.settings(sh).MaximumSpeed * 1.6);
    return SS.physics.speedToTiles(sh.stat.speed);
  };
  ship.accel = function (sh) {
    if (sh.timer.rocket > 0) return SS.physics.thrustToAccel(ship.settings(sh).MaximumThrust * 1.8);
    return SS.physics.thrustToAccel(sh.stat.thrust);
  };
  ship.rotationRate = function (sh) {
    if (sh.timer.shutdown > 0) return SS.physics.SHUTDOWN_ROTATION;
    return SS.physics.rotationToRev(sh.stat.rotation);
  };
  ship.energyMax = function (sh) { return sh.stat.energyCap; };

  /* ------------------------------------------------------------------ */
  /* the per-tick update                                                */
  /* ------------------------------------------------------------------ */

  /* `input` is {forward, backward, left, right, afterburner} - booleans, so
     the same function drives the keyboard and the AI. */
  ship.update = function (sh, sec, input, dt) {
    var s = ship.settings(sh);
    var t = sh.timer;

    /* timers first, so a status that expires this tick expires before it is
       consulted */
    for (var k in t) if (t[k] > 0) t[k] = Math.max(0, t[k] - dt);
    for (var c in sh.cd) if (sh.cd[c] > 0) sh.cd[c] = Math.max(0, sh.cd[c] - dt);

    var shutdown = t.shutdown > 0;
    /* AfterburnerEnergy is in Continuum's tenths-per-second, the same scale
       as recharge, so it converts the same way. */
    var abCost = SS.physics.rechargeToEnergy(s.AfterburnerEnergy);
    var afterburner = !!input.afterburner && !shutdown && sh.energy > abCost * dt * 4;

    /* rotation */
    var rate = ship.rotationRate(sh);
    if (input.left) sh.orient = SS.wrapOrient(sh.orient - rate * dt);
    if (input.right) sh.orient = SS.wrapOrient(sh.orient + rate * dt);

    /* thrust */
    if (!shutdown) {
      var accel = afterburner
        ? SS.physics.thrustToAccel(s.MaximumThrust)
        : ship.accel(sh);
      var head = SS.orientToHeading(sh.orient);
      if (input.forward) { sh.vx += head.x * accel * dt; sh.vy += head.y * accel * dt; }
      if (input.backward) { sh.vx -= head.x * accel * dt; sh.vy -= head.y * accel * dt; }
      if (afterburner && (input.forward || input.backward)) {
        sh.energy -= abCost * dt;
      }
    }

    /* wormhole pull, which can lift the speed ceiling while it acts */
    var gravityCap = SS.physics.applyGravity(sec, sh, dt, s.Gravity, s.GravityTopSpeed);

    /* speed ceiling */
    var cap = afterburner ? SS.physics.speedToTiles(s.MaximumSpeed) : ship.maxSpeed(sh);
    if (gravityCap > cap) cap = gravityCap;
    SS.truncateVelocity(sh, cap);

    /* move, and lose a little speed to any wall we clip */
    SS.physics.moveBody(sec, sh, dt);

    /* held toggles drain while they are on */
    drainToggle(sh, 'cloak', s.CloakEnergy, dt);
    drainToggle(sh, 'stealth', s.StealthEnergy, dt);
    drainToggle(sh, 'xradar', s.XRadarEnergy, dt);
    drainToggle(sh, 'antiwarp', s.AntiWarpEnergy, dt);

    /* recharge.  An EMP freezes it; a safe pad triples it. */
    if (t.emp <= 0) {
      var rate2 = SS.physics.rechargeToEnergy(sh.stat.recharge);
      if (sec.inSafeZone(sh.x, sh.y)) rate2 *= 3;
      sh.energy += rate2 * dt;
    }
    var max = ship.energyMax(sh);
    if (sh.energy > max) sh.energy = max;
    if (sh.energy < 0) sh.energy = 0;

    /* the loiter clock: a safe zone is a breather, not a bunker */
    if (sec.inSafeZone(sh.x, sh.y)) {
      t.safety += dt * 2;   // the loop above already decremented it once
      if (t.safety > SS.ARENA.SafetyLimit) return 'safety-expired';
    } else {
      t.safety = 0;
    }

    return null;
  };

  function drainToggle(sh, name, costPerSecond, dt) {
    if (!sh.on[name]) return;
    if (!sh.has[name] || !costPerSecond) { sh.on[name] = false; return; }
    sh.energy -= costPerSecond * dt;
    if (sh.energy <= 0) { sh.energy = 0; sh.on[name] = false; }
  }

  ship.toggle = function (sh, name) {
    if (!sh.has[name]) return false;
    sh.on[name] = !sh.on[name];
    return sh.on[name];
  };

  /* ------------------------------------------------------------------ */
  /* damage                                                             */
  /* ------------------------------------------------------------------ */

  /* Returns true if this killed the ship.  Shields and Super both stop
     damage; Super also stops repels and shrapnel, which is why it is the
     rarest green in the table. */
  ship.damage = function (sh, amount, source, sec) {
    if (!sh.alive) return false;
    if (sh.timer.super > 0 || sh.timer.shields > 0) return false;
    if (sh.timer.spawnGuard > 0) return false;
    if (sec && sec.inSafeZone(sh.x, sh.y)) return false;

    sh.energy -= amount;
    if (source) sh.lastHitBy = source;
    if (sh.energy <= 0) {
      sh.energy = 0;
      sh.alive = false;
      return true;
    }
    return false;
  };

  /* ------------------------------------------------------------------ */
  /* prizes                                                             */
  /* ------------------------------------------------------------------ */

  /* Mirrors ShipController::ApplyPrize.  A signed id: positive gives,
     negative takes away.  Returns the message to show, or '' for silence. */
  ship.applyPrize = function (sh, prizeId, sec) {
    var negative = prizeId < 0;
    var def = SS.prizeById(prizeId);
    if (!def) return '';
    var s = ship.settings(sh);

    if (!negative) sh.bounty += SS.ARENA.BountyIncreaseForKill / 2;

    switch (def.kind) {
      case 'stat':
        return applyStat(sh, s, def, negative);

      case 'level':
        return applyLevel(sh, s, def, negative);

      case 'toggle': {
        if (!s[def.requires]) return '';
        if (negative) {
          if (!sh.has[def.flag]) return '';
          sh.has[def.flag] = false;
          sh.on[def.flag] = false;
          return def.down;
        }
        /* Already have it?  Continuum turns the duplicate into a full charge
           rather than wasting the green. */
        if (sh.has[def.flag]) return ship.applyPrize(sh, SS.P.FullCharge, sec);
        sh.has[def.flag] = true;
        return def.up;
      }

      case 'count': {
        var cap = capFor(s, def.count);
        if (!cap) return '';
        if (negative) {
          if (sh.count[def.count] <= 0) return '';
          sh.count[def.count]--;
          return def.down;
        }
        if (sh.count[def.count] >= cap) return ship.applyPrize(sh, SS.P.FullCharge, sec);
        sh.count[def.count]++;
        return def.up;
      }

      case 'timed': {
        if (def.status === 'shutdown') {
          sh.timer.shutdown = SS.ARENA.EngineShutdownTime * (negative ? 2 : 1);
          sh.vx *= 0.3; sh.vy *= 0.3;
          return negative ? def.down : def.up;
        }
        if (def.status === 'super') { sh.timer.super = s.SuperTime; return def.up; }
        if (def.status === 'shields') { sh.timer.shields = s.ShieldsTime; return def.up; }
        return '';
      }

      case 'burst': {
        if (def.id === SS.P.FullCharge) {
          if (negative) { sh.energy = 0; return def.down; }
          sh.energy = ship.energyMax(sh);
          return def.up;
        }
        if (def.id === SS.P.Warp && sec) {
          var spot = SS.randomOpenSpot(sec, {});
          sh.x = spot.x; sh.y = spot.y; sh.vx = 0; sh.vy = 0;
          sh.timer.spawnGuard = 0.6;
          return def.up;
        }
        return '';
      }

      case 'meta': {
        /* MultiPrize resolves into a handful of ordinary greens. */
        var n = 3 + SS.rn2(3);
        var last = '';
        for (var i = 0; i < n; i++) {
          var roll = SS.rollPrize(ship.def(sh), 0);
          last = ship.applyPrize(sh, roll, sec) || last;
        }
        return def.up;
      }
    }
    return '';
  };

  function capFor(s, name) {
    switch (name) {
      case 'repel': return s.MaximumRepel;
      case 'burst': return s.MaximumBurst;
      case 'decoy': return s.MaximumDecoy;
      case 'thor': return s.MaximumThor;
      case 'brick': return s.MaximumBrick;
      case 'rocket': return s.MaximumRocket;
      case 'portal': return s.MaximumPortal;
    }
    return 0;
  }
  ship.capFor = capFor;

  function applyStat(sh, s, def, negative) {
    var st = sh.stat;
    switch (def.stat) {
      case 'recharge':
        return step(st, 'recharge', s.UpgradeRecharge, s.InitialRecharge, s.MaximumRecharge, negative, def);
      case 'energy': {
        var msg = step(st, 'energyCap', s.UpgradeEnergy, s.InitialEnergy, s.MaximumEnergy, negative, def);
        if (sh.energy > st.energyCap) sh.energy = st.energyCap;
        return msg;
      }
      case 'rotation':
        return step(st, 'rotation', s.UpgradeRotation, s.InitialRotation, s.MaximumRotation, negative, def);
      case 'thrust':
        return step(st, 'thrust', s.UpgradeThrust, s.InitialThrust, s.MaximumThrust, negative, def);
      case 'speed':
        return step(st, 'speed', s.UpgradeSpeed, s.InitialSpeed, s.MaximumSpeed, negative, def);
      case 'shrapnel': {
        if (!s.HasShrapnel) return '';
        if (negative) {
          if (st.shrapnel <= 0) return '';
          st.shrapnel = Math.max(0, st.shrapnel - SS.ARENA.ShrapnelRate);
          return def.down;
        }
        if (st.shrapnel >= SS.ARENA.ShrapnelMax) return '';
        st.shrapnel = Math.min(SS.ARENA.ShrapnelMax, st.shrapnel + SS.ARENA.ShrapnelRate);
        return def.up;
      }
    }
    return '';
  }

  /* A stat green moves the number by one Upgrade step, clamped to the hull's
     Initial floor and Maximum ceiling.  You can never be prized below the
     ship you launched in - a run can stall, but it cannot spiral. */
  function step(store, field, delta, floor, ceiling, negative, def) {
    if (!delta) return '';
    var before = store[field];
    if (negative) {
      store[field] = Math.max(floor, before - delta);
    } else {
      store[field] = Math.min(ceiling, before + delta);
    }
    if (store[field] === before) return '';
    return negative ? def.down : def.up;
  }

  function applyLevel(sh, s, def, negative) {
    var field = def.level;                       // 'guns' or 'bombs'
    var initial = field === 'guns' ? s.InitialGuns : s.InitialBombs;
    var max = field === 'guns' ? s.MaximumGuns : s.MaximumBombs;
    if (!max) return '';
    var before = sh[field];
    if (negative) sh[field] = Math.max(initial, before - 1);
    else sh[field] = Math.min(max, before + 1);
    if (sh[field] === before) return '';
    return negative ? def.down : def.up;
  }

  /* ------------------------------------------------------------------ */
  /* death                                                              */
  /* ------------------------------------------------------------------ */

  /* When a ship dies it spills its upgrades as greens, exactly as SubSpace
     does - which is why a kill near a wall is worth chasing and a kill over
     a wormhole is not. */
  ship.spillPrizes = function (sh, sec) {
    var count = Math.min(24, 2 + Math.floor(sh.bounty / 2));
    for (var i = 0; i < count; i++) {
      var a = SS.rng.float() * Math.PI * 2;
      var r = SS.rnf(0.5, 5);
      var gx = SS.clamp(sh.x + Math.cos(a) * r, 2, sec.size - 3);
      var gy = SS.clamp(sh.y + Math.sin(a) * r, 2, sec.size - 3);
      if (sec.solidAtPos(gx, gy)) continue;
      var g = SS.makeGreen(gx, gy, false);
      g.expires = sec.clock + SS.ARENA.DeathPrizeTime;
      sec.greens.push(g);
    }
  };

  /* Respawning restores the hull to factory settings.  Everything a run has
     accumulated is in `stat`, `has` and `count`, so this is what makes death
     matter even when it is not the run-ending one. */
  ship.resetToInitial = function (sh) {
    var s = ship.settings(sh);
    sh.stat.rotation = s.InitialRotation;
    sh.stat.thrust = s.InitialThrust;
    sh.stat.speed = s.InitialSpeed;
    sh.stat.recharge = s.InitialRecharge;
    sh.stat.energyCap = s.InitialEnergy;
    sh.stat.shrapnel = 0;
    sh.guns = s.InitialGuns;
    sh.bombs = s.InitialBombs;
    sh.mines = s.InitialMines;
    sh.has = {
      stealth: false, cloak: false, xradar: false, antiwarp: false,
      multifire: false, proximity: false, bouncing: !!s.StartsBouncing
    };
    sh.on = { stealth: false, cloak: false, xradar: false, antiwarp: false };
    sh.count = {
      repel: s.InitialRepel, burst: s.InitialBurst, decoy: s.InitialDecoy,
      thor: s.InitialThor, brick: s.InitialBrick, rocket: s.InitialRocket,
      portal: s.InitialPortal
    };
    sh.energy = s.InitialEnergy;
    sh.bounty = 0;
    sh.portalDrop = null;
    Object.keys(sh.timer).forEach(function (k) { sh.timer[k] = 0; });
    sh.alive = true;
  };

  /* ------------------------------------------------------------------ */
  /* description                                                        */
  /* ------------------------------------------------------------------ */

  /* Percentage of the way from a fresh hull to a fully prized one, per stat.
     The status panel draws these as little bars, which is the fastest way to
     read "what have I actually built here". */
  ship.progress = function (sh) {
    var s = ship.settings(sh);
    function pct(cur, lo, hi) { return hi > lo ? SS.clamp((cur - lo) / (hi - lo), 0, 1) : 1; }
    return {
      recharge: pct(sh.stat.recharge, s.InitialRecharge, s.MaximumRecharge),
      energy: pct(sh.stat.energyCap, s.InitialEnergy, s.MaximumEnergy),
      rotation: pct(sh.stat.rotation, s.InitialRotation, s.MaximumRotation),
      thrust: pct(sh.stat.thrust, s.InitialThrust, s.MaximumThrust),
      speed: pct(sh.stat.speed, s.InitialSpeed, s.MaximumSpeed),
      guns: pct(sh.guns, s.InitialGuns, s.MaximumGuns),
      bombs: s.MaximumBombs ? pct(sh.bombs, s.InitialBombs, s.MaximumBombs) : 0
    };
  };

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
