/* 5Space - populating a sector, and flying the ships in it.
 *
 * Every enemy is a real ship running ship.update with a real input struct, so
 * an AI pilot is under exactly the constraints you are: it has to turn before
 * it can thrust, it spends energy to shoot, and it cannot exceed its own
 * hull's top speed.  Nothing here cheats.  A pilot that is hard to kill is
 * hard to kill because it launched with more greens than you have.
 *
 * The flight model is the interesting part.  A ship can only push along its
 * nose, but a SubSpace pilot spends most of a fight pointing at the enemy
 * while drifting somewhere else entirely.  So the AI computes two headings -
 * where it wants to be pointing to shoot, and where it would have to point to
 * change its velocity - and picks between them based on whether it is already
 * moving fast enough to be somewhere useful.
 */
(function (SS) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* populating a sector                                                */
  /* ------------------------------------------------------------------ */

  SS.populateSector = function (sec, depth) {
    var budget = SS.enemyBudget(depth);
    var i;

    for (i = 0; i < budget.roaming; i++) {
      var def = SS.pickEnemy(depth, { turret: false });
      var spot = SS.randomOpenSpot(sec, {
        away: sec.spawn,
        minDist: Math.round(70 * SS.diff('spawnDistance', depth))
      });
      sec.enemies.push(makeEnemy(def, sec, spot.x, spot.y, depth));
    }

    /* pilots stationed inside bases, which is why flying into one uninvited
       is a different proposition from cruising past it */
    for (i = 0; i < budget.inBase && sec.bases.length; i++) {
      var base = SS.pick(sec.bases);
      var room = base.rooms.length ? SS.pick(base.rooms) : null;
      if (!room) continue;
      var bx = room.x + room.w / 2, by = room.y + room.h / 2;
      if (sec.solidAtPos(bx, by)) continue;
      var bdef = SS.pickEnemy(depth, { turret: false, noDrones: true });
      var e = makeEnemy(bdef, sec, bx, by, depth);
      e.guardsBase = base;
      sec.enemies.push(e);
    }

    for (i = 0; i < budget.turrets; i++) {
      var tspot = turretMount(sec);
      if (!tspot) break;
      var tdef = SS.pickEnemy(depth, { turret: true });
      if (!tdef || !tdef.turret) continue;
      sec.enemies.push(makeEnemy(tdef, sec, tspot.x, tspot.y, depth));
    }

    if (depth === SS.MAXDEPTH && sec.flagStand) {
      var g = SS.enemyByKey('core-guardian');
      var guardian = makeEnemy(g, sec, sec.flagStand.x, sec.flagStand.y - 4, depth);
      guardian.isBoss = true;
      sec.enemies.push(guardian);
      /* and an honour guard */
      for (i = 0; i < 4; i++) {
        var hd = SS.pickEnemy(depth, { turret: false, noDrones: true });
        var ang = (i / 4) * Math.PI * 2;
        var hx = sec.flagStand.x + Math.cos(ang) * 7;
        var hy = sec.flagStand.y + Math.sin(ang) * 7;
        if (sec.solidAtPos(hx, hy)) continue;
        sec.enemies.push(makeEnemy(hd, sec, hx, hy, depth));
      }
    }

    sec.startingEnemies = sec.enemies.length;
  };

  /* A turret wants to sit just outside a base wall with open air in front of
     it, so it can actually see something to shoot at. */
  function turretMount(sec) {
    for (var attempt = 0; attempt < 200; attempt++) {
      if (!sec.bases.length) return null;
      var b = SS.pick(sec.bases);
      var side = SS.rn2(4);
      var x, y;
      if (side === 0) { x = b.x + SS.rn2(b.w); y = b.y - 2; }
      else if (side === 1) { x = b.x + SS.rn2(b.w); y = b.y + b.h + 1; }
      else if (side === 2) { x = b.x - 2; y = b.y + SS.rn2(b.h); }
      else { x = b.x + b.w + 1; y = b.y + SS.rn2(b.h); }
      if (!sec.inBounds(x, y)) continue;
      if (sec.solidAtPos(x + 0.5, y + 0.5)) continue;
      return { x: x + 0.5, y: y + 0.5 };
    }
    return null;
  }

  /* `bare` skips rolling the pilot's build.  Loading a save rebuilds every
     pilot through here purely to recover the derived fields the save does not
     store, and then lays the saved build over the top - so rolling one first
     would be thousands of wasted prize applications per load. */
  function makeEnemy(def, sec, x, y, depth, bare) {
    var sh = SS.ship.create(def.ship, {
      team: 'enemy', name: def.name, x: x, y: y
    });
    sh.enemyKey = def.key;
    sh.ai = def.ai;
    sh.isDrone = !!def.drone;
    sh.isTurret = !!def.turret;
    sh.color = def.color;

    /* Give the pilot its build.  Positive greens only - an enemy that had
       been prized downwards would just be a worse enemy. */
    if (!bare) {
      var n = Math.round((def.prizes + SS.rn2(3)) * SS.difficulty().enemyPrizes);
      for (var i = 0; i < n; i++) {
        SS.ship.applyPrize(sh, Math.abs(SS.rollPrize(SS.ship.def(sh), 0)), sec);
      }
      sh.bounty = Math.max(1, Math.round(def.prizes / 2) + SS.rn2(4));
    }
    sh.energy = SS.ship.energyMax(sh);

    /* Drones keep a single popgun and no bomb tube.  Ships pass straight
       through each other in SubSpace, so a rammer with no weapon would be
       scenery - what makes a drone dangerous is that it closes to point-blank
       and there are eight more behind it. */
    if (def.drone) {
      sh.guns = 1;
      sh.bombs = 0;
      sh.stat.energyCap = Math.round(sh.stat.energyCap * 0.45);
      sh.energy = sh.stat.energyCap;
    }
    if (def.turret) {
      sh.vx = sh.vy = 0;
      sh.stat.thrust = 0;
      sh.stat.speed = 0;
    }

    /* Skill, from 0 at the surface to 1 at the Core.  It is the tuning dial
       for how dangerous a pilot is *as a pilot*, separately from how good its
       hull is, and it drives the two things that actually separate a rookie
       from a warlord: how straight they shoot, and how long they take to
       decide to. */
    sh.skill = SS.clamp((def.difficulty - 1) / (SS.MAXDEPTH - 1), 0, 1) *
      SS.difficulty().enemySkill;
    sh.aimJitter = 0;
    sh.jitterTimer = 0;
    sh.reaction = 0;

    sh.home = { x: x, y: y };
    sh.state = def.ai === 'ambush' ? 'lurk' : 'patrol';
    sh.think = 0;
    sh.strafe = SS.rn2(2) ? 1 : -1;
    sh.strafeTimer = SS.rnf(0.8, 2.5);
    sh.patrolTarget = null;
    sh.alertTimer = 0;
    sh.depth = depth;

    if (def.ai === 'ambush') {
      if (sh.has.cloak) sh.on.cloak = true;
      else if (sh.has.stealth) sh.on.stealth = true;
    }
    return sh;
  }
  SS.makeEnemy = makeEnemy;

  /* ------------------------------------------------------------------ */
  /* per-tick AI                                                        */
  /* ------------------------------------------------------------------ */

  /* Behaviour constants, in tiles.
     `range` is the distance a pilot tries to hold, `gun` and `bomb` are how
     far it is willing to shoot.  The ranges are short by the standards of
     most shooters, and deliberately: with only forty firing headings a bullet
     aimed as well as the hull allows is still up to 4.5 degrees off, which is
     a clean miss on a ship beyond about twenty tiles.  SubSpace gunfights
     happen close for exactly this reason.

     A pilot's holding range must sit inside its own gun range, or it will
     spend the fight at a distance it has already decided not to shoot from. */
  var PROFILE = {
    ram:      { range: 5,   detect: 42, gun: 20, bomb: 34 },
    duel:     { range: 9,   detect: 55, gun: 22, bomb: 30 },
    bomb:     { range: 19,  detect: 62, gun: 16, bomb: 42 },
    snipe:    { range: 17,  detect: 66, gun: 22, bomb: 40 },
    ambush:   { range: 6,   detect: 30, gun: 18, bomb: 26 },
    mine:     { range: 13,  detect: 52, gun: 18, bomb: 28 },
    turret:   { range: 30,  detect: 46, gun: 26, bomb: 38 },
    ace:      { range: 10,  detect: 72, gun: 24, bomb: 34 },
    guardian: { range: 12,  detect: 90, gun: 26, bomb: 40 }
  };

  SS.updateEnemies = function (sec, dt, player, ships, cb) {
    for (var i = 0; i < sec.enemies.length; i++) {
      var e = sec.enemies[i];
      if (!e.alive) continue;
      flyOne(e, sec, dt, player, ships, cb);
    }
  };

  function flyOne(e, sec, dt, player, ships, cb) {
    var prof = PROFILE[e.ai] || PROFILE.duel;
    var input = { forward: false, backward: false, left: false, right: false, afterburner: false };

    var target = chooseTarget(e, sec, player, prof);
    e.think -= dt;
    e.strafeTimer -= dt;
    if (e.strafeTimer <= 0) {
      e.strafe = -e.strafe;
      e.strafeTimer = SS.rnf(0.9, 2.6);
    }

    /* Aim wander: a slow drift that a rookie never quite corrects and a
       warlord effectively does not have. */
    e.jitterTimer -= dt;
    if (e.jitterTimer <= 0) {
      e.jitterTimer = SS.rnf(0.35, 1.1);
      e.aimJitter = SS.rnf(-1, 1) * 0.030 * (1 - e.skill);
    }

    if (target) {
      /* Reaction time on first acquiring a target, so a pilot that rounds a
         corner onto you does not fire in the same tick it sees you. */
      if (e.alertTimer <= 0) e.reaction = SS.rnf(0.15, 0.75) * (1.3 - e.skill);
      e.alertTimer = 4.0;
      e.lastSeen = { x: target.x, y: target.y };
    } else if (e.alertTimer > 0) {
      e.alertTimer -= dt;
    }
    if (e.reaction > 0) e.reaction -= dt;

    if (e.isTurret) {
      flyTurret(e, sec, dt, target, prof, input);
    } else if (target) {
      engage(e, sec, dt, target, prof, input, ships);
    } else if (e.alertTimer > 0 && e.lastSeen) {
      seekPoint(e, sec, dt, e.lastSeen, input);
    } else {
      patrol(e, sec, dt, input);
    }

    SS.ship.update(e, sec, input, dt);
  }

  /* ---- target selection ----------------------------------------------- */

  /* A cloaked ship is invisible; a stealthed one is off radar but still
     visible up close.  Decoys are indistinguishable, which is the point. */
  function chooseTarget(e, sec, player, prof) {
    var best = null, bestD = Infinity;

    /* A rookie does not notice you across half a sector.  Scaling detection
       by skill is what stops a shallow sector from collapsing into a dogpile
       the moment you launch, and it gives Stealth something to be better than
       further down. */
    var detect = prof.detect * (0.5 + 0.5 * e.skill) * SS.diff('enemyDetect', e.depth);

    if (player && player.alive) {
      var d = SS.dist(e, player);
      var visible = d <= detect;
      if (player.on.cloak) visible = visible && d < 6;
      else if (player.on.stealth) visible = visible && d < detect * 0.35;
      if (visible && SS.physics.lineOfSight(sec, e.x, e.y, player.x, player.y)) {
        best = player; bestD = d;
      }
    }

    var decoys = sec.decoys || [];
    for (var i = 0; i < decoys.length; i++) {
      var dc = decoys[i];
      if (dc.team === e.team) continue;
      var dd = SS.dist(e, dc);
      if (dd > detect || dd >= bestD) continue;
      if (!SS.physics.lineOfSight(sec, e.x, e.y, dc.x, dc.y)) continue;
      best = dc; bestD = dd;
    }

    /* A lurker only wakes when something comes close enough to be worth the
       one pass it is going to get. */
    if (e.ai === 'ambush' && best && bestD > detect * 0.7 && e.state === 'lurk') {
      return null;
    }
    if (e.ai === 'ambush' && best) e.state = 'hunt';

    return best;
  }

  /* ---- engagement ------------------------------------------------------ */

  function engage(e, sec, dt, target, prof, input, ships) {
    var s = SS.ship.settings(e);
    var maxSpeed = SS.ship.maxSpeed(e);
    var toX = target.x - e.x, toY = target.y - e.y;
    var dist = SS.length(toX, toY) || 0.001;

    /* Low on energy?  Break off and recharge - the single most SubSpace
       behaviour there is. */
    var frac = e.energy / SS.ship.energyMax(e);
    var retreating = frac < 0.32 && e.ai !== 'ram' && e.ai !== 'guardian';

    var want = prof.range;
    if (retreating) want = prof.range * 2.4;
    if (e.ai === 'ram') want = 0;

    /* radial component: close the gap, or open it */
    var radial = (dist - want) / Math.max(4, want || 8);
    radial = SS.clamp(radial, -1, 1);

    var ux = toX / dist, uy = toY / dist;
    /* perpendicular component: strafe, so it is never a head-on joust */
    var px = -uy * e.strafe, py = ux * e.strafe;
    var strafeWeight = e.ai === 'ram' ? 0 : 0.75;

    var desiredVx = (ux * radial + px * strafeWeight) * maxSpeed;
    var desiredVy = (uy * radial + py * strafeWeight) * maxSpeed;

    var avoid = wallAvoidance(e, sec, maxSpeed);
    desiredVx += avoid.x;
    desiredVy += avoid.y;

    var shotSpeed = SS.physics.speedToTiles(e.bombs > 0 && e.ai === 'bomb' ? s.BombSpeed : s.BulletSpeed);
    var aimOrient = aimAt(e, target, shotSpeed);

    /* Inside shooting distance the nose belongs on the target and the engine
       becomes opportunistic - burn when the heading happens to point somewhere
       useful, coast otherwise.  That decoupling of "where I point" from "where
       I am going" is the whole feel of a SubSpace dogfight; a pilot that
       always faces its own thrust vector never gets a shot off. */
    var holdAim = !retreating && dist < prof.gun * 1.3;
    steer(e, dt, desiredVx, desiredVy, aimOrient, input, maxSpeed, holdAim);

    if (retreating) {
      input.afterburner = e.energy > SS.ship.energyMax(e) * 0.6;
      return;
    }

    fireIfAble(e, sec, dt, target, dist, aimOrient, prof, ships);
  }

  function seekPoint(e, sec, dt, pt, input) {
    var maxSpeed = SS.ship.maxSpeed(e);
    var dx = pt.x - e.x, dy = pt.y - e.y;
    var d = SS.length(dx, dy) || 0.001;
    if (d < 3) { patrol(e, sec, dt, input); return; }
    var avoid = wallAvoidance(e, sec, maxSpeed);
    var vx = (dx / d) * maxSpeed * 0.8 + avoid.x;
    var vy = (dy / d) * maxSpeed * 0.8 + avoid.y;
    steer(e, dt, vx, vy, SS.headingToOrient(dx, dy), input, maxSpeed);
  }

  function patrol(e, sec, dt, input) {
    if (e.isTurret) return;
    if (e.ai === 'ambush' && e.state === 'lurk') {
      /* hold position, quietly */
      e.vx *= 0.96; e.vy *= 0.96;
      return;
    }
    if (!e.patrolTarget || SS.dist(e, e.patrolTarget) < 4) {
      var anchor = e.guardsBase
        ? { x: e.guardsBase.x + e.guardsBase.w / 2, y: e.guardsBase.y + e.guardsBase.h / 2 }
        : e.home;
      var range = e.guardsBase ? 14 : 40;
      for (var attempt = 0; attempt < 24; attempt++) {
        var a = SS.rng.float() * Math.PI * 2;
        var r = SS.rnf(6, range);
        var px = SS.clamp(anchor.x + Math.cos(a) * r, 4, sec.size - 5);
        var py = SS.clamp(anchor.y + Math.sin(a) * r, 4, sec.size - 5);
        if (sec.solidAtPos(px, py)) continue;
        e.patrolTarget = { x: px, y: py };
        break;
      }
      if (!e.patrolTarget) e.patrolTarget = { x: e.home.x, y: e.home.y };
    }
    var maxSpeed = SS.ship.maxSpeed(e) * 0.45;
    var dx = e.patrolTarget.x - e.x, dy = e.patrolTarget.y - e.y;
    var d = SS.length(dx, dy) || 0.001;
    var avoid = wallAvoidance(e, sec, maxSpeed);
    steer(e, dt,
      (dx / d) * maxSpeed + avoid.x,
      (dy / d) * maxSpeed + avoid.y,
      SS.headingToOrient(dx, dy), input, maxSpeed);
  }

  function flyTurret(e, sec, dt, target, prof, input) {
    e.vx = e.vy = 0;
    if (!target) return;
    var s = SS.ship.settings(e);
    var aim = aimAt(e, target, SS.physics.speedToTiles(s.BulletSpeed));
    turnToward(e, dt, aim, input);
    var dist = SS.dist(e, target);
    fireIfAble(e, sec, dt, target, dist, aim, prof, null);
  }

  /* ---- steering -------------------------------------------------------- */

  /* Point the ship, then thrust if the nose happens to be usefully aligned
     with the direction the velocity needs to change in.  `holdAim` keeps the
     nose on the target and lets the engine take whatever it can get;
     otherwise the ship faces where it wants to go, which is how it travels. */
  function steer(e, dt, desiredVx, desiredVy, aimOrient, input, maxSpeed, holdAim) {
    var needX = desiredVx - e.vx, needY = desiredVy - e.vy;
    var needMag = SS.length(needX, needY);

    var face;
    if (holdAim || needMag < maxSpeed * 0.25) {
      face = aimOrient;
    } else {
      face = SS.headingToOrient(needX, needY);
    }

    turnToward(e, dt, face, input);

    if (needMag > maxSpeed * 0.08) {
      var thrustDir = SS.headingToOrient(needX, needY);
      var off = Math.abs(SS.orientDelta(e.orient, thrustDir));
      if (off < 0.14) input.forward = true;
      else if (off > 0.36) input.backward = true;
      /* The afterburner competes with the guns for the same pool, so a pilot
         only reaches for it when it is not trying to shoot and has energy to
         spare.  Getting this threshold wrong makes a pilot that burns its way
         around the sector and never fires a shot. */
      if (!holdAim && needMag > maxSpeed * 0.9 && off < 0.06) {
        input.afterburner = e.energy > SS.ship.energyMax(e) * 0.7;
      }
    }
  }

  /* Steering targets the middle of a firing bucket rather than the raw
     bearing, so that the heading the gun actually uses is the closest of the
     forty to where the pilot wants the shot to go. */
  function turnToward(e, dt, orient, input) {
    var want = SS.snapOrient(orient);
    var delta = SS.orientDelta(e.orient, want);
    var rate = SS.ship.rotationRate(e);
    /* stop dithering once we are inside a single tick of rotation */
    if (Math.abs(delta) < rate * dt) {
      e.orient = want;
      return;
    }
    if (delta > 0) input.right = true; else input.left = true;
  }

  /* Look along the current velocity; if there is rock coming, add a push away
     from it.  Cheap, and it is the difference between a pilot and a moth. */
  function wallAvoidance(e, sec, maxSpeed) {
    var speed = SS.length(e.vx, e.vy);
    if (speed < 0.2) return { x: 0, y: 0 };
    var ux = e.vx / speed, uy = e.vy / speed;
    var look = SS.clamp(speed * 0.9, 4, 18);

    for (var d = 2; d <= look; d += 1.5) {
      var px = e.x + ux * d, py = e.y + uy * d;
      if (!sec.solidAtPos(px, py)) continue;
      /* try both perpendiculars and take whichever is clearer */
      var leftX = -uy, leftY = ux;
      var clearLeft = probeClear(sec, e.x, e.y, leftX, leftY, 6);
      var clearRight = probeClear(sec, e.x, e.y, -leftX, -leftY, 6);
      var sx = clearLeft >= clearRight ? leftX : -leftX;
      var sy = clearLeft >= clearRight ? leftY : -leftY;
      var urgency = (1 - d / look);
      return {
        x: (sx * 1.2 - ux) * maxSpeed * urgency,
        y: (sy * 1.2 - uy) * maxSpeed * urgency
      };
    }
    return { x: 0, y: 0 };
  }

  function probeClear(sec, x, y, dx, dy, maxDist) {
    for (var d = 1; d <= maxDist; d++) {
      if (sec.solidAtPos(x + dx * d, y + dy * d)) return d;
    }
    return maxDist + 1;
  }

  /* ---- shooting -------------------------------------------------------- */

  /* Where to point the nose so that the shot arrives.

     A shot leaves the tube carrying the shooter's own velocity - that is true
     in SubSpace and it is true here - so a strafing pilot that aims straight
     at the lead point throws every bullet wide by the angle of its own drift.
     Working in the shooter's frame, with the target's velocity taken relative
     to it, folds both corrections into one solve: lead the target *and*
     cancel your own sideways motion. */
  function aimAt(e, target, shotSpeed) {
    var rel = {
      x: (target.vx || 0) - e.vx,
      y: (target.vy || 0) - e.vy
    };
    var lead = SS.physics.leadTarget(e, target, rel, shotSpeed);
    return SS.wrapOrient(SS.headingToOrient(lead.x - e.x, lead.y - e.y) + (e.aimJitter || 0));
  }

  /* How far off the bearing a shot may be and still connect, as a fraction of
     a full turn: the angle the target subtends at this range.  Comparing the
     *fired* heading against this is the difference between a pilot that
     shoots when it is lined up and one that empties its energy bar into
     empty space. */
  function aimError(e, target, aimOrient, dist) {
    var fired = SS.firedOrient(e.orient);
    return Math.abs(SS.orientDelta(fired, aimOrient));
  }

  function aimTolerance(target, dist) {
    var r = (target.radius || 0.8) + 0.35;
    return Math.atan2(r, Math.max(1.5, dist)) / (Math.PI * 2);
  }

  function fireIfAble(e, sec, dt, target, dist, aimOrient, prof, ships) {
    var s = SS.ship.settings(e);
    if (e.reaction > 0) return;

    var off = aimError(e, target, aimOrient, dist);
    var tolerance = aimTolerance(target, dist);
    var energyFrac = e.energy / SS.ship.energyMax(e);

    /* Do not shoot the energy you need to survive.  Better pilots cut it
       finer, which is exactly what makes them frightening - but nobody dumps
       the whole bar, because a bar dumped into a miss is a death. */
    var floor = 0.52 - 0.17 * e.skill;
    if (energyFrac < floor) return;

    var clear = SS.physics.lineOfSight(sec, e.x, e.y, target.x, target.y);

    /* utilities first - an ace that only shoots bullets is not an ace */
    if (e.ai === 'ace' || e.ai === 'guardian') {
      if (dist < 6 && e.count.repel > 0 && energyFrac < 0.6) {
        if (ships) SS.weapons.useRepel(e, sec, ships);
        return;
      }
      if (dist < 12 && e.count.burst > 0 && SS.rn2(200) === 0) {
        SS.weapons.fireBurst(e, sec);
        return;
      }
      if (clear && dist < 30 && e.count.thor > 0 && SS.rn2(400) === 0) {
        SS.weapons.fireThor(e, sec);
        return;
      }
      if (e.count.rocket > 0 && dist > 30 && SS.rn2(300) === 0) {
        SS.weapons.useRocket(e);
      }
    }

    if (e.ai === 'mine') {
      if (dist < 22 && e.mines > 0 && SS.rn2(150) === 0) {
        SS.weapons.fireMine(e, sec);
        return;
      }
    }

    if (!clear) return;

    /* A bomb has a blast radius, so it forgives a wider miss than a bullet -
       but only outside its own blast, or the pilot kills itself. */
    if (e.bombs > 0 && dist > 9 && dist < prof.bomb && off < tolerance * 3.5) {
      var wantsBomb = e.ai === 'bomb' || e.ai === 'guardian' ||
        (e.ai === 'ace' && SS.rn2(3) === 0);
      if (wantsBomb && SS.weapons.fireBomb(e, sec)) return;
    }

    if (e.guns > 0 && dist < prof.gun && off <= tolerance) {
      e.wantsMulti = e.has.multifire && dist < 16;
      SS.weapons.fireBullet(e, sec);
    }
  }

  /* ------------------------------------------------------------------ */
  /* reinforcements                                                     */
  /* ------------------------------------------------------------------ */

  /* Carrying the Prime Flag turns the whole map hostile, the same way the
     Amulet does.  Otherwise a sector trickles in replacements slowly, so
     clearing one is possible but backtracking is never free. */
  SS.spawnWanderer = function (sec, depth, player, urgent) {
    var cap = urgent ? 60 : 26 + depth;
    var living = 0;
    sec.enemies.forEach(function (e) { if (e.alive) living++; });
    if (living >= cap) return null;

    var def = SS.pickEnemy(depth + (urgent ? 3 : 0), { turret: false, noDrones: urgent });
    var spot = SS.randomOpenSpot(sec, {
      away: player,
      minDist: Math.round((urgent ? 30 : 60) * SS.diff('spawnDistance', depth))
    });
    var e = makeEnemy(def, sec, spot.x, spot.y, depth);
    if (urgent) e.alertTimer = 8;
    sec.enemies.push(e);
    return e;
  };

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
