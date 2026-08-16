/* 5Space - radar, map memory, and who can see whom.
 *
 * SubSpace's radar showed you a zoomed-out slice of the map and every ship in
 * it, walls or no walls.  That is fine when the map is one you have flown a
 * thousand times and the other dots are people; it is no good at all when the
 * sector was generated ninety seconds ago and the dots are hunting you.
 *
 * So radar here keeps the SubSpace shape - a corner display, an Alt key for
 * the whole sector - and borrows the roguelike's memory: terrain is drawn
 * only once your radar has swept it, and it stays drawn afterwards.  Contacts
 * are live, limited by range, and defeated by Stealth.  X-Radar does what it
 * always did and shows you what is behind the wall.
 */
(function (SS) {
  'use strict';

  var radar = {};
  SS.radar = radar;

  radar.RANGE = 46;            // tiles of contact range
  radar.SWEEP = 52;            // tiles of terrain the sweep records
  radar.XRADAR_BONUS = 1.5;

  var lastSweepX = -999, lastSweepY = -999;

  radar.reset = function () { lastSweepX = -999; lastSweepY = -999; };

  /* ------------------------------------------------------------------ */
  /* map memory                                                         */
  /* ------------------------------------------------------------------ */

  /* Recording the swept circle is the single most expensive thing the game
     does per frame, so it only runs when the ship has actually moved a
     couple of tiles since the last sweep. */
  radar.update = function (sec, player) {
    if (!player || !player.alive) return;
    var px = Math.floor(player.x), py = Math.floor(player.y);
    if (Math.abs(px - lastSweepX) < 2 && Math.abs(py - lastSweepY) < 2) return;
    lastSweepX = px; lastSweepY = py;

    var r = radar.SWEEP;
    var r2 = r * r;
    var size = sec.size;
    var x0 = Math.max(0, px - r), x1 = Math.min(size - 1, px + r);
    var y0 = Math.max(0, py - r), y1 = Math.min(size - 1, py + r);

    for (var y = y0; y <= y1; y++) {
      var dy = y - py;
      var row = y * size;
      for (var x = x0; x <= x1; x++) {
        var dx = x - px;
        if (dx * dx + dy * dy > r2) continue;
        sec.explored[row + x] = 1;
      }
    }
  };

  radar.explored = function (sec, tx, ty) {
    if (!sec.inBounds(tx, ty)) return false;
    return sec.explored[ty * sec.size + tx] === 1;
  };

  /* Warping in should not leave you blind on the pad. */
  radar.revealAround = function (sec, x, y, r) {
    var px = Math.floor(x), py = Math.floor(y);
    var r2 = r * r;
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        var tx = px + dx, ty = py + dy;
        if (sec.inBounds(tx, ty)) sec.explored[ty * sec.size + tx] = 1;
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /* visibility                                                         */
  /* ------------------------------------------------------------------ */

  /* Can the player's eyes find this ship?  Cloak is near-total: only a
     collision-range proximity gives a cloaked hull away. */
  radar.visible = function (player, other) {
    if (!other.alive) return false;
    if (other.team === player.team) return true;
    if (!other.on || !other.on.cloak) return true;
    if (player.on && player.on.xradar) return true;
    return SS.dist(player, other) < 5;
  };

  /* Does this ship put a blip on the radar?  Stealth is the counter to
     radar specifically - a stealthed ship is perfectly visible if you are
     looking out of the window at it. */
  radar.contact = function (sec, player, other) {
    if (!other.alive) return false;
    var range = radar.RANGE * (player.on && player.on.xradar ? radar.XRADAR_BONUS : 1);
    var d = SS.dist(player, other);
    if (d > range) return false;
    if (other.on && other.on.stealth && !(player.on && player.on.xradar)) return false;
    if (other.on && other.on.cloak && !(player.on && player.on.xradar)) return false;
    /* without X-Radar, a wall is a wall */
    if (!(player.on && player.on.xradar)) {
      if (!SS.physics.lineOfSight(sec, player.x, player.y, other.x, other.y)) return false;
    }
    return true;
  };

  /* Antiwarp: an enemy holding it down within range stops you using a portal
     or being warped by a green.  It is the reason a Shark parked on the exit
     is a genuine problem. */
  radar.warpBlocked = function (sec, player) {
    for (var i = 0; i < sec.enemies.length; i++) {
      var e = sec.enemies[i];
      if (!e.alive || !e.on.antiwarp) continue;
      if (SS.dist(player, e) < 14) return e;
    }
    return null;
  };

  /* ------------------------------------------------------------------ */
  /* what to draw                                                       */
  /* ------------------------------------------------------------------ */

  /* Collects the blips for a radar pane: enemies in contact, plus the fixed
     features of the sector that are always worth knowing about once found. */
  radar.blips = function (sec, player) {
    var out = [];
    var i;

    for (i = 0; i < sec.enemies.length; i++) {
      var e = sec.enemies[i];
      if (!radar.contact(sec, player, e)) continue;
      out.push({
        x: e.x, y: e.y,
        color: e.isBoss ? '#ffffff' : (e.bounty > 14 ? '#ff5555' : '#ff9955'),
        size: e.isBoss ? 3 : (e.isTurret ? 1 : 2)
      });
    }

    var decoys = sec.decoys || [];
    for (i = 0; i < decoys.length; i++) {
      if (decoys[i].team === player.team) {
        out.push({ x: decoys[i].x, y: decoys[i].y, color: '#66aaff', size: 2 });
      }
    }

    if (sec.portalDown && radar.explored(sec, Math.floor(sec.portalDown.x), Math.floor(sec.portalDown.y))) {
      out.push({ x: sec.portalDown.x, y: sec.portalDown.y, color: '#ffd24a', size: 3, ring: true });
    }
    if (sec.portalUp && radar.explored(sec, Math.floor(sec.portalUp.x), Math.floor(sec.portalUp.y))) {
      out.push({ x: sec.portalUp.x, y: sec.portalUp.y, color: '#4ac8ff', size: 3, ring: true });
    }
    if (sec.flagStand && radar.explored(sec, Math.floor(sec.flagStand.x), Math.floor(sec.flagStand.y))) {
      out.push({ x: sec.flagStand.x, y: sec.flagStand.y, color: '#ff4444', size: 3, ring: true });
    }
    if (player.portalDrop) {
      out.push({ x: player.portalDrop.x, y: player.portalDrop.y, color: '#aa66ff', size: 2, ring: true });
    }

    return out;
  };

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
