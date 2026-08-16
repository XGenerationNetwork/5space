/* 5Space - everything a ship can fire, drop or set off.
 *
 * Bullets, bombs, proximity bombs, mines, shrapnel, bursts, repels, thors,
 * decoys, bricks, rockets and portals - the same list Continuum simulates,
 * with the same energy costs coming out of the same pool that keeps you
 * alive.  That single shared pool is the reason SubSpace combat feels the way
 * it does: every shot you take is health you are choosing not to have.
 *
 * Shots live in `sector.shots`.  They are deliberately not saved: warping out
 * of a sector clears the air, which is both simpler and fairer.
 */
(function (SS) {
  'use strict';

  var W = {};
  SS.weapons = W;

  var PX = 16;

  /* ------------------------------------------------------------------ */
  /* firing                                                             */
  /* ------------------------------------------------------------------ */

  function spawnShot(sec, o) {
    if (!sec.shots) sec.shots = [];
    sec.shots.push(o);
    return o;
  }

  /* The muzzle sits on the hull's nose so that a shot never spawns inside
     the ship that fired it. */
  function muzzle(sh, head, extra) {
    return {
      x: sh.x + head.x * (sh.radius + (extra || 0.35)),
      y: sh.y + head.y * (sh.radius + (extra || 0.35))
    };
  }

  W.canFire = function (sh, cost, cooldownKey) {
    if (!sh.alive) return false;
    if (sh.timer.shutdown > 0) return false;
    if (sh.cd[cooldownKey] > 0) return false;
    return sh.energy > cost;
  };

  W.fireBullet = function (sh, sec) {
    var s = SS.ship.settings(sh);
    var multi = sh.has.multifire && sh.on.multifireShot !== false && sh.wantsMulti;
    var cost = multi ? s.MultiFireEnergy : s.BulletFireEnergy;
    if (sh.timer.super > 0) cost = 0;
    if (!W.canFire(sh, cost, 'bullet')) return false;

    sh.energy -= cost;
    sh.cd.bullet = 0.14;

    var level = sh.timer.super > 0 ? Math.max(sh.guns, s.MaximumGuns) : sh.guns;
    var speed = SS.physics.speedToTiles(s.BulletSpeed);
    var damage = SS.ARENA.BulletDamageLevel + (level - 1) * SS.ARENA.BulletDamageUpgrade;

    var offsets = [0];
    if (multi) {
      /* MultiFireAngle is quoted in thousandths of a rotation point, and a
         rotation point is 1/40 of a turn. */
      var spread = (s.MultiFireAngle / 1000) / SS.ROTATIONS;
      offsets = [0, -spread, spread];
    }

    offsets.forEach(function (off) {
      var head = SS.orientToHeading(sh.orient + off);
      var m = muzzle(sh, head);
      spawnShot(sec, {
        type: 'bullet',
        x: m.x, y: m.y,
        vx: sh.vx + head.x * speed,
        vy: sh.vy + head.y * speed,
        owner: sh.id, team: sh.team,
        level: level, damage: damage,
        life: SS.ARENA.BulletAliveTime,
        bouncing: sh.has.bouncing,
        bounces: 0
      });
    });
    return true;
  };

  W.fireBomb = function (sh, sec) {
    var s = SS.ship.settings(sh);
    if (!s.MaximumBombs || sh.bombs <= 0) return false;
    var level = sh.timer.super > 0 ? s.MaximumBombs : sh.bombs;
    var cost = s.BombFireEnergy + (level - 1) * s.BombFireEnergyUpgrade;
    if (sh.timer.super > 0) cost = 0;
    if (!W.canFire(sh, cost, 'bomb')) return false;

    sh.energy -= cost;
    sh.cd.bomb = 0.6;

    var head = SS.orientToHeading(sh.orient);
    var speed = SS.physics.speedToTiles(s.BombSpeed);
    var m = muzzle(sh, head, 0.5);

    spawnShot(sec, {
      type: 'bomb',
      x: m.x, y: m.y,
      vx: sh.vx + head.x * speed,
      vy: sh.vy + head.y * speed,
      owner: sh.id, team: sh.team,
      level: level,
      damage: SS.ARENA.BombDamageLevel,
      life: SS.ARENA.BombAliveTime,
      bouncing: false,
      proximity: sh.has.proximity,
      armed: 0.25,             // will not trigger on the ship that fired it
      shrapnel: sh.stat.shrapnel
    });

    /* the kick.  A Leviathan firing backwards is a legitimate manoeuvre. */
    var kick = (s.BombThrust / 100) * 10 / PX;
    sh.vx -= head.x * kick;
    sh.vy -= head.y * kick;
    return true;
  };

  W.fireMine = function (sh, sec) {
    var s = SS.ship.settings(sh);
    if (!s.MaximumMines || sh.mines <= 0) return false;
    var level = sh.mines;
    var cost = s.LandmineFireEnergy + (level - 1) * s.LandmineFireEnergyUpgrade;
    if (!W.canFire(sh, cost, 'mine')) return false;

    /* Mines are capped per ship, not per shot: laying a fourth removes the
       first, so a Shark cannot simply carpet a sector. */
    var mine = countMines(sec, sh.id);
    if (mine >= level + 1) removeOldestMine(sec, sh.id);

    sh.energy -= cost;
    sh.cd.mine = 1.0;

    spawnShot(sec, {
      type: 'mine',
      x: sh.x, y: sh.y, vx: 0, vy: 0,
      owner: sh.id, team: sh.team,
      level: level,
      damage: SS.ARENA.BombDamageLevel,
      life: SS.ARENA.MineAliveTime,
      proximity: true,
      armed: 1.0,
      shrapnel: sh.stat.shrapnel
    });
    return true;
  };

  function countMines(sec, ownerId) {
    var n = 0;
    (sec.shots || []).forEach(function (w) {
      if (w.type === 'mine' && w.owner === ownerId) n++;
    });
    return n;
  }

  function removeOldestMine(sec, ownerId) {
    for (var i = 0; i < sec.shots.length; i++) {
      if (sec.shots[i].type === 'mine' && sec.shots[i].owner === ownerId) {
        sec.shots.splice(i, 1);
        return;
      }
    }
  }

  /* A ring of bouncing bullets in every direction at once - the panic button
     that also happens to be an excellent way to clear a corridor. */
  W.fireBurst = function (sh, sec) {
    if (sh.count.burst <= 0 || sh.cd.utility > 0) return false;
    var s = SS.ship.settings(sh);
    sh.count.burst--;
    sh.cd.utility = 0.5;

    var speed = SS.physics.speedToTiles(s.BurstSpeed);
    for (var r = 0; r < SS.ROTATIONS; r++) {
      var head = SS.rotationToHeading(r);
      spawnShot(sec, {
        type: 'burst',
        x: sh.x + head.x * (sh.radius + 0.3),
        y: sh.y + head.y * (sh.radius + 0.3),
        vx: head.x * speed, vy: head.y * speed,
        owner: sh.id, team: sh.team,
        level: 1, damage: SS.ARENA.BurstDamageLevel,
        life: SS.ARENA.BurstAliveTime,
        bouncing: true, bounces: 0
      });
    }
    return true;
  };

  /* Thor's hammer: goes through walls, ignores shields, and there are only
     ever a couple of them. */
  W.fireThor = function (sh, sec) {
    if (sh.count.thor <= 0 || sh.cd.utility > 0) return false;
    var s = SS.ship.settings(sh);
    sh.count.thor--;
    sh.cd.utility = 0.5;

    var head = SS.orientToHeading(sh.orient);
    var speed = SS.physics.speedToTiles(s.BombSpeed * 1.2);
    spawnShot(sec, {
      type: 'thor',
      x: sh.x + head.x * (sh.radius + 0.5),
      y: sh.y + head.y * (sh.radius + 0.5),
      vx: head.x * speed, vy: head.y * speed,
      owner: sh.id, team: sh.team,
      level: 4, damage: SS.ARENA.BombDamageLevel,
      life: SS.ARENA.BombAliveTime,
      phasing: true, proximity: true, armed: 0.2,
      ignoresShields: true,
      shrapnel: Math.max(4, sh.stat.shrapnel)
    });
    return true;
  };

  /* Shoves every ship and every shot nearby straight away from you. */
  W.useRepel = function (sh, sec, ships) {
    if (sh.count.repel <= 0 || sh.cd.utility > 0) return false;
    sh.count.repel--;
    sh.cd.utility = 0.4;
    sh.timer.repelActive = SS.ARENA.RepelTime;

    var range = SS.physics.pixelsToTiles(SS.ARENA.RepelDistance);
    var push = SS.physics.speedToTiles(SS.ARENA.RepelSpeed);

    ships.forEach(function (other) {
      if (other === sh || !other.alive) return;
      var d = SS.dist(other, sh);
      if (d > range || d < 0.001) return;
      var f = (1 - d / range) * push;
      other.vx += ((other.x - sh.x) / d) * f;
      other.vy += ((other.y - sh.y) / d) * f;
      other.timer.repelActive = SS.ARENA.RepelTime;
    });

    (sec.shots || []).forEach(function (w) {
      if (w.owner === sh.id || w.type === 'mine') return;
      var d = SS.dist(w, sh);
      if (d > range || d < 0.001) return;
      var speed = SS.length(w.vx, w.vy);
      w.vx = ((w.x - sh.x) / d) * speed;
      w.vy = ((w.y - sh.y) / d) * speed;
      w.owner = sh.id;        // a repelled shot belongs to whoever turned it
      w.team = sh.team;
    });
    return true;
  };

  W.useDecoy = function (sh, sec) {
    if (sh.count.decoy <= 0 || sh.cd.utility > 0) return false;
    sh.count.decoy--;
    sh.cd.utility = 0.4;
    if (!sec.decoys) sec.decoys = [];
    var head = SS.orientToHeading(sh.orient);
    var speed = SS.length(sh.vx, sh.vy) || SS.ship.maxSpeed(sh) * 0.6;
    sec.decoys.push({
      x: sh.x, y: sh.y,
      vx: head.x * speed, vy: head.y * speed,
      orient: sh.orient,
      shipKey: sh.shipKey,
      owner: sh.id, team: sh.team,
      radius: sh.radius,
      life: SS.ARENA.DecoyAliveTime
    });
    return true;
  };

  W.useBrick = function (sh, sec) {
    if (sh.count.brick <= 0 || sh.cd.utility > 0) return false;
    var head = SS.orientToHeading(sh.orient);
    var bx = Math.floor(sh.x + head.x * 2.5);
    var by = Math.floor(sh.y + head.y * 2.5);
    /* lay the wall across the heading, not along it */
    var px = -head.y, py = head.x;
    var laid = 0;
    for (var i = -2; i <= 2; i++) {
      if (sec.addBrick(Math.round(bx + px * i), Math.round(by + py * i), 20)) laid++;
    }
    if (!laid) return false;
    sh.count.brick--;
    sh.cd.utility = 0.5;
    return true;
  };

  W.useRocket = function (sh) {
    if (sh.count.rocket <= 0 || sh.cd.utility > 0) return false;
    sh.count.rocket--;
    sh.cd.utility = 0.5;
    sh.timer.rocket = 4.0;
    return true;
  };

  /* First press drops a beacon; the second warps you back to it.  A Terrier
     with two portals is the most mobile thing in the sector. */
  W.usePortal = function (sh, sec) {
    if (sh.cd.utility > 0) return null;
    sh.cd.utility = 0.4;
    if (sh.portalDrop) {
      var d = sh.portalDrop;
      sh.portalDrop = null;
      sh.x = d.x; sh.y = d.y;
      sh.vx = 0; sh.vy = 0;
      sh.timer.spawnGuard = 0.5;
      return 'warp';
    }
    if (sh.count.portal <= 0) return null;
    sh.count.portal--;
    sh.portalDrop = { x: sh.x, y: sh.y };
    return 'drop';
  };

  /* ------------------------------------------------------------------ */
  /* the shot update                                                    */
  /* ------------------------------------------------------------------ */

  /* `onHit(ship, damage, shot)` is called for every ship a shot damages, and
     `onExplode(shot)` once for anything that bursts, so the game layer can
     award kills and make noise without weapons.js knowing what a score is. */
  W.update = function (sec, dt, ships, cb) {
    cb = cb || {};
    var shots = sec.shots || (sec.shots = []);

    for (var i = shots.length - 1; i >= 0; i--) {
      var w = shots[i];
      w.life -= dt;
      if (w.armed > 0) w.armed -= dt;

      if (w.life <= 0) {
        if (w.type === 'bomb' || w.type === 'mine' || w.type === 'thor') {
          explode(sec, w, ships, cb);
        }
        shots.splice(i, 1);
        continue;
      }

      if (w.type !== 'mine') {
        var res = SS.physics.moveShot(sec, w, dt);
        if (res === 'stop') {
          if (w.type === 'bomb' || w.type === 'thor') explode(sec, w, ships, cb);
          shots.splice(i, 1);
          continue;
        }
        if (res === 'bounce') {
          w.bounces = (w.bounces || 0) + 1;
          /* a bullet that has rattled around long enough gives up */
          if (w.bounces > 12) { shots.splice(i, 1); continue; }
        }
      }

      if (checkShotHits(sec, w, ships, cb)) {
        shots.splice(i, 1);
      }
    }

    updateDecoys(sec, dt);
  };

  function checkShotHits(sec, w, ships, cb) {
    var prox = 0;
    if (w.proximity && w.armed <= 0) {
      prox = SS.ARENA.ProximityDistance + (w.level - 1);
    }

    for (var i = 0; i < ships.length; i++) {
      var sh = ships[i];
      if (!sh.alive) continue;
      if (sh.id === w.owner) {
        /* your own bomb can still kill you, but only once it has armed */
        if (w.armed > 0) continue;
        if (w.type === 'bullet' || w.type === 'burst') continue;
      }
      if (sh.team === w.team && sh.id !== w.owner) continue;
      if (sec.inSafeZone(sh.x, sh.y)) continue;

      var d = SS.dist(sh, w);

      if (d <= sh.radius + 0.25) {
        if (w.type === 'bomb' || w.type === 'mine' || w.type === 'thor') {
          explode(sec, w, ships, cb);
        } else {
          hit(sh, w.damage, w, cb);
        }
        return true;
      }

      if (prox && d <= prox) {
        /* Continuum waits a beat after the trigger before it goes off, which
           is just long enough to fly through if you are quick. */
        w.proximityTriggered = true;
        w.life = Math.min(w.life, SS.ARENA.BombExplodeDelay);
        w.vx *= 0.35; w.vy *= 0.35;
        return false;
      }
    }

    /* decoys eat bullets like the real thing */
    var decoys = sec.decoys || [];
    for (var k = decoys.length - 1; k >= 0; k--) {
      var dc = decoys[k];
      if (dc.team === w.team) continue;
      if (SS.dist(dc, w) <= dc.radius + 0.25) {
        decoys.splice(k, 1);
        if (w.type === 'bomb' || w.type === 'mine' || w.type === 'thor') {
          explode(sec, w, ships, cb);
        }
        return true;
      }
    }

    return false;
  }

  /* Every point of damage in the game passes through here, whoever fired it.
   *
   * The difficulty multiplier is applied to shots belonging to the player, so
   * on Easy an enemy takes half the damage to destroy.  Doing it here rather
   * than by halving enemy energy pools matters: the pool is also what a pilot
   * spends to shoot, so shrinking it would quietly change how often they can
   * fire.  This changes exactly what was asked for and nothing else.
   *
   * A repelled shot changes hands - `w.team` becomes whoever turned it - so
   * an enemy bomb you push back is your shot, and counts as yours. */
  function hit(sh, damage, w, cb) {
    if (w.ignoresShields) {
      sh.timer.shields = 0;
    }
    if (w.team === 'player') {
      damage = Math.round(damage * SS.diff('damageToEnemies'));
    }
    var killed = SS.ship.damage(sh, damage, w.owner, null);
    if (cb.onHit) cb.onHit(sh, damage, w, killed);
  }

  /* A bomb does full damage at the centre and tapers to nothing at the edge
     of its blast, with the radius scaling by bomb level. */
  function explode(sec, w, ships, cb) {
    if (w.exploded) return;
    w.exploded = true;

    var radius = SS.physics.pixelsToTiles(SS.ARENA.BombExplodePixels) * w.level;
    for (var i = 0; i < ships.length; i++) {
      var sh = ships[i];
      if (!sh.alive) continue;
      if (sh.team === w.team && sh.id !== w.owner) continue;
      if (sec.inSafeZone(sh.x, sh.y)) continue;
      var d = SS.dist(sh, w);
      if (d > radius) continue;
      var falloff = 1 - (d / radius);
      hit(sh, Math.round(w.damage * falloff), w, cb);
    }

    if (w.shrapnel > 0) spawnShrapnel(sec, w);
    if (cb.onExplode) cb.onExplode(w, radius);
  }

  function spawnShrapnel(sec, w) {
    var n = Math.min(SS.ARENA.ShrapnelMax, w.shrapnel);
    var speed = SS.physics.speedToTiles(SS.ARENA.ShrapnelSpeed);
    var base = SS.rng.float();
    for (var i = 0; i < n; i++) {
      var a = (base + i / n) * Math.PI * 2;
      sec.shots.push({
        type: 'shrap',
        x: w.x, y: w.y,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        owner: w.owner, team: w.team,
        level: 1, damage: SS.ARENA.ShrapnelDamage,
        life: 1.2,
        bouncing: true, bounces: 0
      });
    }
  }

  function updateDecoys(sec, dt) {
    var decoys = sec.decoys || [];
    for (var i = decoys.length - 1; i >= 0; i--) {
      var d = decoys[i];
      d.life -= dt;
      if (d.life <= 0) { decoys.splice(i, 1); continue; }
      SS.physics.moveBody(sec, d, dt);
    }
  }

  /* ------------------------------------------------------------------ */
  /* description                                                        */
  /* ------------------------------------------------------------------ */

  /* What the HUD calls each stock, in firing order. */
  W.UTILITIES = [
    { key: 'burst', label: 'Burst', hotkey: 'Shift+Del' },
    { key: 'repel', label: 'Repel', hotkey: 'Shift+Ctrl' },
    { key: 'decoy', label: 'Decoy', hotkey: 'F5' },
    { key: 'thor', label: 'Thor', hotkey: 'F6' },
    { key: 'brick', label: 'Brick', hotkey: 'F4' },
    { key: 'rocket', label: 'Rocket', hotkey: 'F3' },
    { key: 'portal', label: 'Portal', hotkey: 'Shift+Ins' }
  ];

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
