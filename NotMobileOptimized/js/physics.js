/* 5Space - movement, tile collision, bouncing, and wormhole gravity.
 *
 * Everything here is in tiles and seconds.  The conversions from Continuum's
 * integer settings are done once, at the top, and then never thought about
 * again:
 *
 *   acceleration  tiles/s^2 = thrust * 10 / 16
 *   top speed     tiles/s   = speed / 160
 *   rotation      rev/s     = rotation / 400
 *   recharge      energy/s  = recharge / 10
 *   any pixel figure         / 16
 *
 * The simulation runs at a fixed 100 Hz, which is Continuum's tick, so a
 * setting quoted "per tick" means per 1/100 s here too.
 */
(function (SS) {
  'use strict';

  var phys = {};
  SS.physics = phys;

  var PX = 16;

  phys.thrustToAccel = function (thrust) { return thrust * 10 / PX; };
  phys.speedToTiles = function (speed) { return speed / (10 * PX); };
  phys.rotationToRev = function (rot) { return rot / 400; };
  phys.rechargeToEnergy = function (r) { return r / 10; };
  phys.pixelsToTiles = function (p) { return p / PX; };

  /* Continuum shuts a ship's steering down to a crawl while its engines are
     out; 40/400 of a revolution per second is barely enough to matter, which
     is the point. */
  phys.SHUTDOWN_ROTATION = 40 / 400;

  /* ------------------------------------------------------------------ */
  /* tile collision                                                     */
  /* ------------------------------------------------------------------ */

  /* Bodies are axis-aligned boxes of half-width `radius` (in tiles) centred
     on {x,y}.  Testing the box rather than a circle is what the original
     does, and it is why hugging a wall at speed feels sticky rather than
     slippery. */
  function boxHitsSolid(sec, x, y, radius) {
    var x0 = Math.floor(x - radius), x1 = Math.floor(x + radius);
    var y0 = Math.floor(y - radius), y1 = Math.floor(y + radius);
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        if (sec.solidAt(tx, ty)) return true;
      }
    }
    return false;
  }
  phys.boxHitsSolid = boxHitsSolid;

  /* Move a body one step, resolving each axis on its own so that sliding
     along a wall works and a corner does not stop you dead.  Returns a mask:
     1 = bounced horizontally, 2 = bounced vertically. */
  phys.moveBody = function (sec, body, dt, bounceFactor) {
    var bounce = (bounceFactor === undefined ? SS.ARENA.BounceFactor : bounceFactor) / 16;
    var r = body.radius;
    var hit = 0;

    /* Sub-step so that nothing outruns a tile in a single frame.  At the top
       speed of a prized Weasel a body covers about a third of a tile per
       tick, but rockets, shrapnel and thors go a great deal faster. */
    var speed = SS.length(body.vx, body.vy);
    var steps = Math.max(1, Math.ceil((speed * dt) / 0.4));
    var sdt = dt / steps;

    for (var s = 0; s < steps; s++) {
      var nx = body.x + body.vx * sdt;
      if (boxHitsSolid(sec, nx, body.y, r)) {
        body.vx = -body.vx * bounce;
        hit |= 1;
      } else {
        body.x = nx;
      }

      var ny = body.y + body.vy * sdt;
      if (boxHitsSolid(sec, body.x, ny, r)) {
        body.vy = -body.vy * bounce;
        hit |= 2;
      } else {
        body.y = ny;
      }
    }

    /* A body that has somehow ended up inside rock - a brick dropped on it, a
       door closing on it - gets nudged to the nearest clear tile rather than
       being left stuck forever. */
    if (boxHitsSolid(sec, body.x, body.y, r)) {
      var free = phys.nearestFreeSpot(sec, body.x, body.y, r);
      if (free) { body.x = free.x; body.y = free.y; }
    }

    return hit;
  };

  phys.nearestFreeSpot = function (sec, x, y, radius) {
    for (var ring = 1; ring <= 12; ring++) {
      for (var dy = -ring; dy <= ring; dy++) {
        for (var dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          var cx = Math.floor(x) + dx + 0.5;
          var cy = Math.floor(y) + dy + 0.5;
          if (!boxHitsSolid(sec, cx, cy, radius)) return { x: cx, y: cy };
        }
      }
    }
    return null;
  };

  /* ------------------------------------------------------------------ */
  /* projectile stepping                                                */
  /* ------------------------------------------------------------------ */

  /* Shots are points, not boxes, and they care about `blocksShot` rather than
     `solid` - an energy screen stops a bullet but not a ship.  Returns
     'none', 'bounce', or 'stop'. */
  phys.moveShot = function (sec, shot, dt) {
    var speed = SS.length(shot.vx, shot.vy);
    var steps = Math.max(1, Math.ceil((speed * dt) / 0.5));
    var sdt = dt / steps;
    var result = 'none';

    for (var s = 0; s < steps; s++) {
      var nx = shot.x + shot.vx * sdt;
      var ny = shot.y + shot.vy * sdt;

      if (shot.phasing) {          // a thor ignores the map entirely
        shot.x = nx; shot.y = ny;
        continue;
      }

      var blockedX = sec.blocksShotAtPos(nx, shot.y);
      var blockedY = sec.blocksShotAtPos(shot.x, ny);

      if (!blockedX && !blockedY && sec.blocksShotAtPos(nx, ny)) {
        /* clipped a corner diagonally - treat it as both axes */
        blockedX = blockedY = true;
      }

      if (!blockedX && !blockedY) {
        shot.x = nx; shot.y = ny;
        continue;
      }
      if (!shot.bouncing) return 'stop';

      if (blockedX) shot.vx = -shot.vx;
      if (blockedY) shot.vy = -shot.vy;
      result = 'bounce';
      /* Spend the rest of the step on the reflected heading rather than
         swallowing it, or a shot in a tight corridor loses all its range. */
      var rx = shot.x + shot.vx * sdt;
      var ry = shot.y + shot.vy * sdt;
      if (!sec.blocksShotAtPos(rx, ry)) { shot.x = rx; shot.y = ry; }
    }
    return result;
  };

  /* ------------------------------------------------------------------ */
  /* wormholes                                                          */
  /* ------------------------------------------------------------------ */

  /* Continuum's gravity, unit for unit: the pull is (Gravity * 1000) over the
     squared pixel distance, applied only inside a radius that scales with the
     setting, and while it is pulling you the ship's speed ceiling is raised
     to GravityTopSpeed - which is exactly why a wormhole can fling you across
     a sector faster than you can fly.
     Returns the raised speed cap in tiles/s, or 0 if no wormhole is acting. */
  phys.applyGravity = function (sec, body, dt, gravity, gravityTopSpeed) {
    if (!gravity) return 0;
    var raisedCap = 0;
    for (var i = 0; i < sec.wormholes.length; i++) {
      var w = sec.wormholes[i];
      var dx = (body.x - w.x) * PX;
      var dy = (body.y - w.y) * PX;
      var distSq = dx * dx + dy * dy + 1;
      if (distSq >= Math.abs(gravity) * 1000) continue;

      var gravityThrust = (gravity * 1000) / distSq;
      var len = Math.sqrt(distSq) / PX;
      if (len <= 0) continue;
      var ux = (w.x - body.x) / len, uy = (w.y - body.y) / len;
      var perSecond = gravityThrust * 10 / PX;
      body.vx += ux * perSecond * dt;
      body.vy += uy * perSecond * dt;

      if (Math.abs(gravityThrust) >= 1) {
        raisedCap = phys.speedToTiles(gravityTopSpeed);
      }
    }
    return raisedCap;
  };

  /* Fly into the eye of one and it spits you out at its partner. */
  phys.wormholeAt = function (sec, x, y) {
    for (var i = 0; i < sec.wormholes.length; i++) {
      var w = sec.wormholes[i];
      if (SS.length2(x - w.x, y - w.y) < 2.25) return w;
    }
    return null;
  };

  /* ------------------------------------------------------------------ */
  /* aiming                                                             */
  /* ------------------------------------------------------------------ */

  /* Where to point so that a shot of `shotSpeed` meets a target that is
     moving.  Solves the usual quadratic; falls back to aiming straight at the
     target when there is no solution, which is what a real pilot does too. */
  phys.leadTarget = function (from, to, targetVel, shotSpeed) {
    var dx = to.x - from.x, dy = to.y - from.y;
    var vx = targetVel.x, vy = targetVel.y;

    var a = vx * vx + vy * vy - shotSpeed * shotSpeed;
    var b = 2 * (dx * vx + dy * vy);
    var c = dx * dx + dy * dy;

    var t = 0;
    if (Math.abs(a) < 1e-6) {
      if (Math.abs(b) > 1e-6) t = -c / b;
    } else {
      var disc = b * b - 4 * a * c;
      if (disc >= 0) {
        var sq = Math.sqrt(disc);
        var t1 = (-b + sq) / (2 * a);
        var t2 = (-b - sq) / (2 * a);
        if (t1 > 0 && t2 > 0) t = Math.min(t1, t2);
        else t = Math.max(t1, t2);
      }
    }
    if (!(t > 0) || t > 6) t = 0;

    return { x: to.x + vx * t, y: to.y + vy * t };
  };

  /* Is there clear air between two points?  Used by the AI to decide whether
     a shot is worth taking, and by radar to decide what you can see. */
  phys.lineOfSight = function (sec, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var dist = SS.length(dx, dy);
    if (dist < 0.001) return true;
    var steps = Math.ceil(dist * 2);
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      if (sec.blocksShotAtPos(ax + dx * t, ay + dy * t)) return false;
    }
    return true;
  };

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
