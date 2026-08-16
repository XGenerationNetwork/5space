/* 5Space - sectors: tiles, procedural generation, doors, wormholes, greens.
 *
 * A sector is a SubSpace map: a large grid of 16-pixel tiles that is mostly
 * empty space, with asteroid fields drifting through it and hard-walled bases
 * bolted into the rock.  Where NetHack's mklev carves rooms out of solid
 * stone and joins them with corridors, a SubSpace map does the opposite - it
 * starts open and *adds* obstruction - so the generator here inverts the
 * roguelike shape while keeping its guarantees: the down portal is always
 * reachable, every base has a way in, and nothing is ever sealed off.
 *
 * The staircase is a warp portal.  Fly into it and you are in the next
 * sector down; the arrival portal beside you takes you back up.
 */
(function (SS) {
  'use strict';

  var SIZE = 256;                 // tiles on a side
  SS.SECTOR_SIZE = SIZE;
  SS.MAXDEPTH = 26;

  /* ---- tiles ---------------------------------------------------------- */

  var T = {
    EMPTY: 0,       // open space
    ROCK: 1,        // asteroid; solid, indestructible
    WALL: 2,        // base plating; solid
    DOOR: 3,        // cycles open and shut on the sector clock
    SAFE: 4,        // safe pad: no damage, fast recharge, and a loiter timer
    WORMHOLE: 5,    // gravity well that eventually swallows you
    PORTAL_DOWN: 6, // the way deeper
    PORTAL_UP: 7,   // the way back
    FLAGSTAND: 8,   // where the Prime Flag sits
    BRICK: 9,       // temporary wall dropped by a ship
    SCREEN: 10      // energy screen: stops shots, ships fly through
  };
  SS.T = T;

  var TILES = {};
  TILES[T.EMPTY]       = { solid: false, blocksShot: false, color: null };
  TILES[T.ROCK]        = { solid: true,  blocksShot: true,  color: '#6b6257' };
  TILES[T.WALL]        = { solid: true,  blocksShot: true,  color: '#4a5a72' };
  TILES[T.DOOR]        = { solid: true,  blocksShot: true,  color: '#8899bb' };
  TILES[T.SAFE]        = { solid: false, blocksShot: false, color: '#2b6b4a' };
  TILES[T.WORMHOLE]    = { solid: false, blocksShot: false, color: '#4b2b6b' };
  TILES[T.PORTAL_DOWN] = { solid: false, blocksShot: false, color: '#c8a02a' };
  TILES[T.PORTAL_UP]   = { solid: false, blocksShot: false, color: '#2a8ac8' };
  TILES[T.FLAGSTAND]   = { solid: false, blocksShot: false, color: '#c83a3a' };
  TILES[T.BRICK]       = { solid: true,  blocksShot: true,  color: '#aa7744' };
  TILES[T.SCREEN]      = { solid: false, blocksShot: true,  color: '#3a7a8a' };
  SS.TILES = TILES;

  /* ---- the sector object ---------------------------------------------- */

  function Sector(depth) {
    var n = SIZE * SIZE;
    this.depth = depth;
    this.size = SIZE;
    this.tiles = new Uint8Array(n);
    /* Door group 1..7 per tile, 0 for "not a door".  Groups cycle out of
       phase so that a base never opens every door at once. */
    this.doorGroup = new Uint8Array(n);
    /* Radar memory: 1 once the tile has been inside radar range. */
    this.explored = new Uint8Array(n);

    this.greens = [];
    this.enemies = [];
    this.wrecks = [];
    this.wormholes = [];
    this.safeZones = [];
    this.bases = [];
    this.spawn = null;
    this.portalDown = null;
    this.portalUp = null;
    this.flagStand = null;

    this.doorPhase = 0;
    this.clock = 0;               // seconds this sector has been simulated
    this.cleared = false;         // every enemy that started here is dead
    this.bricks = [];             // {x,y,expires} temporary walls
    this.visited = false;
  }

  Sector.prototype.idx = function (tx, ty) { return ty * SIZE + tx; };

  Sector.prototype.inBounds = function (tx, ty) {
    return tx >= 0 && tx < SIZE && ty >= 0 && ty < SIZE;
  };

  Sector.prototype.tileAt = function (tx, ty) {
    if (!this.inBounds(tx, ty)) return T.ROCK;
    return this.tiles[ty * SIZE + tx];
  };

  Sector.prototype.setTile = function (tx, ty, t) {
    if (this.inBounds(tx, ty)) this.tiles[ty * SIZE + tx] = t;
  };

  /* A closed door is solid; an open one is not.  Doors belong to a group and
     the group's bit in doorPhase says whether it is currently open, which is
     how a whole base's doors stay in step without storing per-door state. */
  Sector.prototype.doorOpen = function (tx, ty) {
    var g = this.doorGroup[ty * SIZE + tx];
    if (!g) return false;
    return (this.doorPhase & (1 << (g - 1))) !== 0;
  };

  Sector.prototype.solidAt = function (tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    var t = this.tiles[ty * SIZE + tx];
    if (t === T.DOOR) return !this.doorOpen(tx, ty);
    return TILES[t].solid;
  };

  Sector.prototype.blocksShotAt = function (tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    var t = this.tiles[ty * SIZE + tx];
    if (t === T.DOOR) return !this.doorOpen(tx, ty);
    return TILES[t].blocksShot;
  };

  /* World coordinates are in tiles, so a position maps to a tile by flooring. */
  Sector.prototype.solidAtPos = function (x, y) {
    return this.solidAt(Math.floor(x), Math.floor(y));
  };

  Sector.prototype.blocksShotAtPos = function (x, y) {
    return this.blocksShotAt(Math.floor(x), Math.floor(y));
  };

  /* Doors advance on a sector clock rather than a global one, so a sector you
     have not visited for ten minutes is not mid-cycle when you arrive. */
  Sector.prototype.tickDoors = function (dt) {
    this.clock += dt;
    var phase = 0;
    for (var g = 1; g <= 7; g++) {
      /* each group has its own period and offset */
      var period = 6 + g * 1.5;
      var offset = g * 0.9;
      if (((this.clock + offset) % period) < period * 0.45) phase |= (1 << (g - 1));
    }
    this.doorPhase = phase;
  };

  Sector.prototype.expireBricks = function () {
    for (var i = this.bricks.length - 1; i >= 0; i--) {
      if (this.clock >= this.bricks[i].expires) {
        var b = this.bricks[i];
        if (this.tileAt(b.x, b.y) === T.BRICK) this.setTile(b.x, b.y, T.EMPTY);
        this.bricks.splice(i, 1);
      }
    }
  };

  Sector.prototype.addBrick = function (tx, ty, seconds) {
    if (!this.inBounds(tx, ty)) return false;
    if (this.tileAt(tx, ty) !== T.EMPTY) return false;
    this.setTile(tx, ty, T.BRICK);
    this.bricks.push({ x: tx, y: ty, expires: this.clock + seconds });
    return true;
  };

  Sector.prototype.inSafeZone = function (x, y) {
    return this.tileAt(Math.floor(x), Math.floor(y)) === T.SAFE;
  };

  SS.Sector = Sector;

  /* ------------------------------------------------------------------ */
  /* generation                                                         */
  /* ------------------------------------------------------------------ */

  /* Depth drives everything: how much rock is in the way, how many bases
     there are, how mean the greens get, and what is flying around. */
  SS.makeSector = function (depth) {
    var sec = new Sector(depth);
    var t = (depth - 1) / (SS.MAXDEPTH - 1);   // 0 at the surface, 1 at the Core

    /* Order matters here.  Bases register their footprint, and every later
       placement refuses to sit inside a registered footprint - so the Core
       vault, the portals, the safe pads and the wormholes can none of them be
       stamped over a base and seal its rooms off behind their own walls. */
    borderRock(sec);
    scatterAsteroids(sec, t);
    var baseCount = 2 + Math.round(t * 4) + SS.rn2(2);
    for (var i = 0; i < baseCount; i++) placeBase(sec, t, depth);
    placePortals(sec, depth);
    if (depth === SS.MAXDEPTH) placeCore(sec);
    placeSafeZones(sec, depth);
    placeWormholes(sec, t);
    ensureReachable(sec);
    scatterGreens(sec, depth);
    scatterWrecks(sec, depth);
    if (SS.populateSector) SS.populateSector(sec, depth);

    return sec;
  };

  /* ---- the frame ------------------------------------------------------ */

  function borderRock(sec) {
    var w = 3;
    for (var x = 0; x < SIZE; x++) {
      for (var d = 0; d < w; d++) {
        sec.setTile(x, d, T.ROCK);
        sec.setTile(x, SIZE - 1 - d, T.ROCK);
      }
    }
    for (var y = 0; y < SIZE; y++) {
      for (var e = 0; e < w; e++) {
        sec.setTile(e, y, T.ROCK);
        sec.setTile(SIZE - 1 - e, y, T.ROCK);
      }
    }
  }

  /* ---- asteroid fields ------------------------------------------------ */

  /* Clusters of noise smoothed by a couple of cellular-automata passes.  The
     result reads as drifting rock rather than as a maze, which is what a
     SubSpace map looks like and what keeps flight lanes open. */
  function scatterAsteroids(sec, t) {
    var fields = 6 + Math.round(t * 10);
    for (var f = 0; f < fields; f++) {
      var cx = SS.rn1(SIZE - 40, 20);
      var cy = SS.rn1(SIZE - 40, 20);
      var rx = SS.rn1(22, 10);
      var ry = SS.rn1(22, 10);
      var fill = 0.36 + SS.rng.float() * 0.16 + t * 0.08;
      carveField(sec, cx, cy, rx, ry, fill);
    }
    /* a few lone rocks to break up the empty lanes */
    var singles = 60 + Math.round(t * 90);
    for (var s = 0; s < singles; s++) {
      var x = SS.rn1(SIZE - 20, 10), y = SS.rn1(SIZE - 20, 10);
      if (sec.tileAt(x, y) !== T.EMPTY) continue;
      var size = SS.rnd(3);
      for (var dy = 0; dy < size; dy++) {
        for (var dx = 0; dx < size; dx++) {
          if (sec.tileAt(x + dx, y + dy) === T.EMPTY) sec.setTile(x + dx, y + dy, T.ROCK);
        }
      }
    }
  }

  function carveField(sec, cx, cy, rx, ry, fill) {
    var w = rx * 2 + 1, h = ry * 2 + 1;
    var buf = new Uint8Array(w * h);
    var x, y, i;

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        /* taper towards the edge of the ellipse so fields have soft borders */
        var nx = (x - rx) / rx, ny = (y - ry) / ry;
        var d = nx * nx + ny * ny;
        if (d > 1) continue;
        var p = fill * (1 - d * 0.65);
        if (SS.rng.float() < p) buf[y * w + x] = 1;
      }
    }

    for (var pass = 0; pass < 3; pass++) {
      var next = new Uint8Array(buf);
      for (y = 1; y < h - 1; y++) {
        for (x = 1; x < w - 1; x++) {
          var n = 0;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              if (buf[(y + dy) * w + (x + dx)]) n++;
            }
          }
          i = y * w + x;
          next[i] = n >= 5 ? 1 : (n <= 2 ? 0 : buf[i]);
        }
      }
      buf = next;
    }

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (!buf[y * w + x]) continue;
        var tx = cx - rx + x, ty = cy - ry + y;
        if (sec.tileAt(tx, ty) === T.EMPTY) sec.setTile(tx, ty, T.ROCK);
      }
    }
  }

  /* ---- bases ---------------------------------------------------------- */

  /* A base is a walled rectangle with internal partitions, at least two door
     entrances, and something worth flying in for.  Deeper bases are bigger
     and better subdivided, which is where the tight corridors - and the
     bouncing-bullet nightmares - come from. */
  function placeBase(sec, t, depth) {
    for (var attempt = 0; attempt < 40; attempt++) {
      var w = SS.rn1(18, 16) + Math.round(t * 12);
      var h = SS.rn1(14, 12) + Math.round(t * 10);
      var x0 = SS.rn1(SIZE - w - 24, 12);
      var y0 = SS.rn1(SIZE - h - 24, 12);
      if (!areaClearOfBases(sec, x0 - 6, y0 - 6, w + 12, h + 12)) continue;

      var base = { x: x0, y: y0, w: w, h: h, rooms: [] };

      /* clear the footprint of any rock, then wall the shell */
      var x, y;
      for (y = y0; y < y0 + h; y++) {
        for (x = x0; x < x0 + w; x++) sec.setTile(x, y, T.EMPTY);
      }
      for (x = x0; x < x0 + w; x++) {
        sec.setTile(x, y0, T.WALL);
        sec.setTile(x, y0 + h - 1, T.WALL);
      }
      for (y = y0; y < y0 + h; y++) {
        sec.setTile(x0, y, T.WALL);
        sec.setTile(x0 + w - 1, y, T.WALL);
      }

      partition(sec, x0 + 1, y0 + 1, w - 2, h - 2, 0, base, depth);
      punchEntrances(sec, base);
      connectRooms(sec, base);
      stockBase(sec, base, depth);

      sec.bases.push(base);
      return base;
    }
    return null;
  }

  function areaClearOfBases(sec, x, y, w, h) {
    if (x < 6 || y < 6 || x + w > SIZE - 6 || y + h > SIZE - 6) return false;
    for (var i = 0; i < sec.bases.length; i++) {
      var b = sec.bases[i];
      if (x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y) return false;
    }
    return true;
  }

  /* Recursive splits, the same idea as NetHack's rectangle partition, but the
     leaves become rooms inside a building instead of rooms in bedrock. */
  function partition(sec, x, y, w, h, level, base, depth) {
    var minRoom = 6;
    if (level >= 3 || w < minRoom * 2 + 1 || h < minRoom * 2 + 1) {
      base.rooms.push({ x: x, y: y, w: w, h: h });
      return;
    }
    var vertical = w > h ? true : (h > w ? false : SS.rn2(2) === 0);
    if (vertical) {
      var sx = x + SS.rn1(w - minRoom * 2, minRoom);
      for (var yy = y; yy < y + h; yy++) sec.setTile(sx, yy, T.WALL);
      cutOpening(sec, sx, y, sx, y + h - 1, true, depth);
      partition(sec, x, y, sx - x, h, level + 1, base, depth);
      partition(sec, sx + 1, y, x + w - sx - 1, h, level + 1, base, depth);
    } else {
      var sy = y + SS.rn1(h - minRoom * 2, minRoom);
      for (var xx = x; xx < x + w; xx++) sec.setTile(xx, sy, T.WALL);
      cutOpening(sec, x, sy, x + w - 1, sy, false, depth);
      partition(sec, x, y, w, sy - y, level + 1, base, depth);
      partition(sec, x, sy + 1, w, y + h - sy - 1, level + 1, base, depth);
    }
  }

  /* Every partition gets a gap so no room is sealed.  Some gaps are doors,
     some are energy screens you can fly through but not shoot through, and
     the rest are simply holes.

     The arithmetic has to stay inside the wall.  An opening that runs off the
     end writes its tiles into the neighbouring structure and leaves the wall
     it was supposed to open still solid - which is how a room ends up sealed,
     and it only happens on the short walls that a deep, heavily subdivided
     base produces a lot of. */
  function cutOpening(sec, x1, y1, x2, y2, vertical, depth) {
    var span = (vertical ? (y2 - y1) : (x2 - x1)) + 1;
    if (span < 3) {
      /* too short to hold a gap with margins - drop the wall entirely */
      for (var k = 0; k < span; k++) {
        sec.setTile(vertical ? x1 : x1 + k, vertical ? y1 + k : y1, T.EMPTY);
      }
      return;
    }

    var maxGap = Math.min(4, span - 2);
    var openings = span > 20 ? 2 : 1;
    for (var o = 0; o < openings; o++) {
      var gap = 1 + SS.rn2(maxGap);
      var at = 1 + SS.rn2(Math.max(1, span - gap - 1));
      var roll = SS.rn2(10);
      var kind = roll < 4 ? T.DOOR : (roll < 6 ? T.SCREEN : T.EMPTY);
      var group = 1 + SS.rn2(7);
      for (var i = 0; i < gap; i++) {
        var tx = vertical ? x1 : x1 + at + i;
        var ty = vertical ? y1 + at + i : y1;
        sec.setTile(tx, ty, kind);
        if (kind === T.DOOR) sec.doorGroup[sec.idx(tx, ty)] = group;
      }
    }
  }

  /* Doors in the outer shell, so a base is enterable but not a free lane.

     A door that opens straight into an asteroid is not an entrance, so each
     one gets a short apron cleared outside it, and the position is recorded
     so the connectivity pass can find its way here later. */
  function punchEntrances(sec, base) {
    base.entrances = [];
    var sides = SS.shuffle([0, 1, 2, 3]);
    var count = 2 + SS.rn2(2);
    for (var i = 0; i < count; i++) {
      var side = sides[i % 4];
      var group = 1 + SS.rn2(7);
      var gap = 3 + SS.rn2(2);
      var tx, ty, k, ox = 0, oy = 0;

      if (side === 0 || side === 1) {            // top / bottom
        var sx = base.x + 2 + SS.rn2(Math.max(1, base.w - gap - 4));
        ty = side === 0 ? base.y : base.y + base.h - 1;
        oy = side === 0 ? -1 : 1;
        for (k = 0; k < gap; k++) {
          tx = sx + k;
          if (tx <= base.x || tx >= base.x + base.w - 1) continue;
          sec.setTile(tx, ty, T.DOOR);
          sec.doorGroup[sec.idx(tx, ty)] = group;
          clearApron(sec, tx, ty, ox, oy);
          base.entrances.push({ x: tx, y: ty });
        }
      } else {                                    // left / right
        var sy = base.y + 2 + SS.rn2(Math.max(1, base.h - gap - 4));
        tx = side === 2 ? base.x : base.x + base.w - 1;
        ox = side === 2 ? -1 : 1;
        for (k = 0; k < gap; k++) {
          ty = sy + k;
          if (ty <= base.y || ty >= base.y + base.h - 1) continue;
          sec.setTile(tx, ty, T.DOOR);
          sec.doorGroup[sec.idx(tx, ty)] = group;
          clearApron(sec, tx, ty, ox, oy);
          base.entrances.push({ x: tx, y: ty });
        }
      }
    }
  }

  function clearApron(sec, tx, ty, ox, oy) {
    for (var d = 1; d <= 3; d++) {
      var ax = tx + ox * d, ay = ty + oy * d;
      if (sec.tileAt(ax, ay) === T.ROCK) sec.setTile(ax, ay, T.EMPTY);
      /* widen it a little so the lane is flyable, not a keyhole */
      var px = oy, py = ox;
      if (sec.tileAt(ax + px, ay + py) === T.ROCK) sec.setTile(ax + px, ay + py, T.EMPTY);
      if (sec.tileAt(ax - px, ay - py) === T.ROCK) sec.setTile(ax - px, ay - py, T.EMPTY);
    }
  }

  /* Belt and braces on the base interior.

     The partitioning is supposed to leave every room connected, and now it
     does - but "supposed to" is not a guarantee, and a room sealed inside a
     base is worse than a merely ugly one: it holds greens you can see and can
     never reach.  So flood the interior from one room and knock a hole
     through to anything the flood did not find.  On a well-formed base this
     does nothing at all. */
  function connectRooms(sec, base) {
    if (base.rooms.length < 2) return;

    var x0 = base.x, y0 = base.y, w = base.w, h = base.h;
    function inside(tx, ty) {
      return tx > x0 && tx < x0 + w - 1 && ty > y0 && ty < y0 + h - 1;
    }
    function passable(tx, ty) {
      var t = sec.tileAt(tx, ty);
      return t === T.EMPTY || t === T.DOOR || t === T.SCREEN;
    }

    var centres = base.rooms.map(function (r) {
      return { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
    });

    var seen = {};
    function flood(sx, sy) {
      var stack = [[sx, sy]];
      seen[sx + ',' + sy] = true;
      while (stack.length) {
        var cur = stack.pop();
        for (var d = 0; d < 4; d++) {
          var nx = cur[0] + (d === 0 ? 1 : d === 1 ? -1 : 0);
          var ny = cur[1] + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (!inside(nx, ny) || seen[nx + ',' + ny] || !passable(nx, ny)) continue;
          seen[nx + ',' + ny] = true;
          stack.push([nx, ny]);
        }
      }
    }
    flood(centres[0].x, centres[0].y);

    for (var i = 1; i < centres.length; i++) {
      var c = centres[i];
      if (seen[c.x + ',' + c.y]) continue;
      /* walk towards the first room, opening whatever is in the way */
      var tx = c.x, ty = c.y;
      var guard = 0;
      while ((tx !== centres[0].x || ty !== centres[0].y) && guard++ < w + h + 8) {
        if (tx !== centres[0].x) tx += SS.sgn(centres[0].x - tx);
        else ty += SS.sgn(centres[0].y - ty);
        if (inside(tx, ty) && sec.tileAt(tx, ty) === T.WALL) {
          sec.setTile(tx, ty, T.EMPTY);
          sec.doorGroup[sec.idx(tx, ty)] = 0;
        }
      }
      flood(c.x, c.y);
    }
  }

  /* Bases are where the good greens live, which is the whole reason to risk
     flying into one. */
  function stockBase(sec, base, depth) {
    base.rooms.forEach(function (r) {
      if (r.w < 4 || r.h < 4) return;
      var n = 1 + SS.rn2(3);
      for (var i = 0; i < n; i++) {
        var x = r.x + 1 + SS.rn2(Math.max(1, r.w - 2));
        var y = r.y + 1 + SS.rn2(Math.max(1, r.h - 2));
        if (sec.tileAt(x, y) !== T.EMPTY) continue;
        sec.greens.push(makeGreen(x + 0.5, y + 0.5, true));
      }
      /* the odd deep room holds something that never appears in open space */
      if (depth >= 4 && SS.rn2(9) === 0) {
        var sx = r.x + Math.floor(r.w / 2), sy = r.y + Math.floor(r.h / 2);
        if (sec.tileAt(sx, sy) === T.EMPTY) {
          var g = makeGreen(sx + 0.5, sy + 0.5, true);
          g.special = SS.pick(SS.SPECIAL_PRIZES);
          sec.greens.push(g);
        }
      }
    });
  }

  /* ---- safe zones, wormholes, portals --------------------------------- */

  function placeSafeZones(sec, depth) {
    /* Fewer safe pads the deeper you go; the Core has none at all. */
    var count = depth >= SS.MAXDEPTH ? 0 : Math.max(1, 3 - Math.floor(depth / 9));
    for (var i = 0; i < count; i++) {
      var spot = findOpenArea(sec, 7);
      if (!spot) continue;
      for (var dy = -3; dy <= 3; dy++) {
        for (var dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy > 11) continue;
          if (sec.tileAt(spot.x + dx, spot.y + dy) === T.EMPTY) {
            sec.setTile(spot.x + dx, spot.y + dy, T.SAFE);
          }
        }
      }
      sec.safeZones.push({ x: spot.x, y: spot.y });
    }
  }

  /* A wormhole's pull follows Continuum's inverse-square law, and inside
     about eleven tiles it beats any hull's thrust outright - a fully prized
     Warbird on full afterburner cannot climb out.  That is fine, and it is
     the point: a wormhole is not an obstacle to be escaped, it is a thing
     that moves you.  But it makes the destination a safety-critical number.
     Anything dropped inside that radius is dropped into a trap, and if the
     destination is another wormhole's mouth the two of them will throw a ship
     back and forth for as long as the sector exists. */
  var WORMHOLE_ESCAPE = 12;         // tiles: thrust starts to win out here
  var WORMHOLE_SAFE_DIST = 26;      // tiles: how far a destination must sit
  SS.WORMHOLE_ESCAPE = WORMHOLE_ESCAPE;
  SS.WORMHOLE_SAFE_DIST = WORMHOLE_SAFE_DIST;

  function placeWormholes(sec, t) {
    var count = SS.rn2(3) + (t > 0.4 ? 1 : 0);
    for (var i = 0; i < count; i++) {
      var spot = findOpenArea(sec, 6);
      if (!spot) continue;
      for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy > 5) continue;
          if (sec.tileAt(spot.x + dx, spot.y + dy) === T.EMPTY) {
            sec.setTile(spot.x + dx, spot.y + dy, T.WORMHOLE);
          }
        }
      }
      sec.wormholes.push({
        x: spot.x + 0.5, y: spot.y + 0.5,
        dest: null, nextSwitch: 0
      });
    }
    retargetWormholes(sec, true);
  }

  /* Where a wormhole throws you: open space, well clear of every wormhole in
     the sector - including itself.  Continuum re-rolls this on a timer rather
     than wiring holes to each other permanently, which is both what the
     WormholeSwitchTime setting is for and the reason a wormhole never becomes
     a predictable shuttle service. */
  function wormholeDestination(sec) {
    var best = null, bestClearance = -1;
    for (var attempt = 0; attempt < 300; attempt++) {
      /* room to arrive at speed, and the wormhole check done here rather than
         in the helper so the near-misses can be ranked */
      var spot = SS.randomOpenSpot(sec, { clearance: 4, minWormholeDist: 0 });
      var clearance = distanceToNearestWormhole(sec, spot);
      if (clearance >= WORMHOLE_SAFE_DIST) return spot;
      if (clearance > bestClearance) { bestClearance = clearance; best = spot; }
    }
    /* A cramped sector might have nowhere that far from every hole; take the
       roomiest spot found rather than dropping someone down a well. */
    return best || { x: sec.size / 2, y: sec.size / 2 };
  }
  SS.wormholeDestination = wormholeDestination;

  function distanceToNearestWormhole(sec, pos) {
    var best = Infinity;
    for (var i = 0; i < sec.wormholes.length; i++) {
      var d = SS.dist(pos, sec.wormholes[i]);
      if (d < best) best = d;
    }
    return best;
  }
  SS.distanceToNearestWormhole = distanceToNearestWormhole;

  function retargetWormholes(sec, force) {
    for (var i = 0; i < sec.wormholes.length; i++) {
      var w = sec.wormholes[i];
      if (!force && sec.clock < w.nextSwitch) continue;
      w.dest = wormholeDestination(sec);
      w.nextSwitch = sec.clock + SS.ARENA.WormholeSwitchTime;
    }
  }
  SS.retargetWormholes = retargetWormholes;

  /* Called once per tick from the game loop. */
  Sector.prototype.tickWormholes = function () {
    retargetWormholes(this, false);
  };

  function placePortals(sec, depth) {
    var up = findOpenArea(sec, 6);
    if (!up) up = { x: 20, y: 20 };
    stampPortal(sec, up.x, up.y, T.PORTAL_UP);
    sec.portalUp = { x: up.x + 0.5, y: up.y + 0.5 };
    sec.spawn = { x: up.x + 0.5, y: up.y + 0.5 };

    /* The way down goes as far from the way up as the sector allows, so that
       arriving never means immediately leaving. */
    var best = null, bestD = -1;
    for (var a = 0; a < 300; a++) {
      var c = findOpenArea(sec, 5);
      if (!c) continue;
      var d = SS.length2(c.x - up.x, c.y - up.y);
      if (d > bestD) { bestD = d; best = c; }
      if (bestD > (SIZE * 0.55) * (SIZE * 0.55)) break;
    }
    if (!best) best = { x: SIZE - 20, y: SIZE - 20 };
    if (depth < SS.MAXDEPTH) {
      stampPortal(sec, best.x, best.y, T.PORTAL_DOWN);
      sec.portalDown = { x: best.x + 0.5, y: best.y + 0.5 };
    } else {
      sec.portalDown = null;
      sec.coreSpot = { x: best.x + 0.5, y: best.y + 0.5 };
    }
  }

  function stampPortal(sec, cx, cy, tile) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > 5) continue;
        sec.setTile(cx + dx, cy + dy, tile);
      }
    }
    /* keep a landing pad clear around it */
    for (var y = -5; y <= 5; y++) {
      for (var x = -5; x <= 5; x++) {
        if (x * x + y * y > 25) continue;
        if (sec.tileAt(cx + x, cy + y) === T.ROCK) sec.setTile(cx + x, cy + y, T.EMPTY);
      }
    }
  }

  /* The bottom of the dungeon: a sealed vault holding the Prime Flag.

     It needs a site big enough for a 26x22 building with room to breathe, and
     as far from the arrival portal as the sector will allow, so that reaching
     it is a journey.  The footprint is registered like any other base so that
     nothing generated afterwards is stamped through its walls. */
  function placeCore(sec) {
    var w = 26, h = 22;
    var anchor = sec.portalUp || sec.spawn || { x: SIZE / 2, y: SIZE / 2 };
    var spot = null, bestD = -1;
    for (var attempt = 0; attempt < 60; attempt++) {
      var c = findOpenArea(sec, 16, 20);
      if (!c) break;
      var d = SS.length2(c.x - anchor.x, c.y - anchor.y);
      if (d > bestD) { bestD = d; spot = c; }
    }
    if (!spot) spot = findOpenArea(sec, 13, 15);
    if (!spot && sec.coreSpot) {
      spot = { x: Math.floor(sec.coreSpot.x), y: Math.floor(sec.coreSpot.y) };
    }
    if (!spot) spot = { x: SIZE - 40, y: SIZE - 40 };

    var x0 = SS.clamp(spot.x - w / 2 | 0, 8, SIZE - w - 8);
    var y0 = SS.clamp(spot.y - h / 2 | 0, 8, SIZE - h - 8);
    var x, y;
    for (y = y0; y < y0 + h; y++) {
      for (x = x0; x < x0 + w; x++) sec.setTile(x, y, T.EMPTY);
    }
    for (x = x0; x < x0 + w; x++) {
      sec.setTile(x, y0, T.WALL); sec.setTile(x, y0 + h - 1, T.WALL);
    }
    for (y = y0; y < y0 + h; y++) {
      sec.setTile(x0, y, T.WALL); sec.setTile(x0 + w - 1, y, T.WALL);
    }
    /* one door on each side, all on the same group, so the vault breathes in
       and out as a single lung */
    var group = 1;
    for (var k = -1; k <= 1; k++) {
      door(sec, x0 + (w >> 1) + k, y0, group);
      door(sec, x0 + (w >> 1) + k, y0 + h - 1, group);
      door(sec, x0, y0 + (h >> 1) + k, group);
      door(sec, x0 + w - 1, y0 + (h >> 1) + k, group);
    }

    var cx = x0 + (w >> 1), cy = y0 + (h >> 1);
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) sec.setTile(cx + dx, cy + dy, T.FLAGSTAND);
    }
    sec.flagStand = { x: cx + 0.5, y: cy + 0.5 };
    sec.coreRoom = { x: x0, y: y0, w: w, h: h };
    /* claim the footprint so later placements route around it */
    sec.bases.push({ x: x0, y: y0, w: w, h: h, rooms: [], vault: true });
  }

  function door(sec, tx, ty, group) {
    sec.setTile(tx, ty, T.DOOR);
    sec.doorGroup[sec.idx(tx, ty)] = group;
  }

  /* ---- greens and wrecks ---------------------------------------------- */

  /* Greens are anonymous - nothing ever refers to one except by its index in
     the sector's list - so they carry no id.  With four hundred of them per
     sector and twenty-six sectors in a save, the field that nobody reads is
     not free. */
  function makeGreen(x, y, inBase) {
    return {
      x: x, y: y,
      taken: 0,          // sector clock time at which it was taken
      inBase: !!inBase,
      special: 0         // non-zero forces a particular prize
    };
  }
  SS.makeGreen = makeGreen;

  /* Open space gets a scattering of greens at the arena's prize factor, the
     way a zone seeds its map. */
  function scatterGreens(sec, depth) {
    var open = countOpen(sec);
    /* Clamp first, scale second.  Widening the clamp to make room for a
       difficulty multiplier would change the figure Normal has always used,
       and with it every sector Normal generates. */
    var want = Math.round((open / 1000) * SS.ARENA.PrizeFactor);
    want = SS.clamp(want, 60, 460);
    want = Math.round(want * SS.difficulty().greens);
    var placed = 0, attempts = 0;
    while (placed < want && attempts++ < want * 40) {
      var x = SS.rn1(SIZE - 16, 8), y = SS.rn1(SIZE - 16, 8);
      if (sec.tileAt(x, y) !== T.EMPTY) continue;
      sec.greens.push(makeGreen(x + 0.5, y + 0.5, false));
      placed++;
    }
  }

  /* Derelict hulls: fly into one and it breaks open into a burst of greens.
     They are the closest thing this game has to a treasure chest, and unlike
     a green they are visible from a long way off. */
  function scatterWrecks(sec, depth) {
    var count = 3 + SS.rn2(4) + Math.floor(depth / 6);
    for (var i = 0; i < count; i++) {
      var spot = findOpenArea(sec, 3);
      if (!spot) continue;
      sec.wrecks.push({
        x: spot.x + 0.5, y: spot.y + 0.5,
        prizes: 3 + SS.rn2(4) + Math.floor(depth / 4),
        broken: false,
        orient: SS.rng.float()
      });
    }
  }

  /* ---- helpers -------------------------------------------------------- */

  function countOpen(sec) {
    var n = 0;
    for (var i = 0; i < sec.tiles.length; i++) if (sec.tiles[i] === T.EMPTY) n++;
    return n;
  }

  /* Find a spot with `radius` tiles of clear space around it, outside any
     structure already claimed.  A base interior is made of empty tiles, so
     without the footprint check "open space" would happily mean "the middle
     of somebody's base". */
  function findOpenArea(sec, radius, margin) {
    margin = margin === undefined ? radius + 2 : margin;
    for (var attempt = 0; attempt < 400; attempt++) {
      var x = SS.rn1(SIZE - (radius + 6) * 2, radius + 6);
      var y = SS.rn1(SIZE - (radius + 6) * 2, radius + 6);
      if (!clearAround(sec, x, y, radius)) continue;
      if (overlapsStructure(sec, x, y, margin)) continue;
      return { x: x, y: y };
    }
    return null;
  }

  function overlapsStructure(sec, cx, cy, margin) {
    for (var i = 0; i < sec.bases.length; i++) {
      var b = sec.bases[i];
      if (cx >= b.x - margin && cx < b.x + b.w + margin &&
          cy >= b.y - margin && cy < b.y + b.h + margin) return true;
    }
    return false;
  }

  function clearAround(sec, cx, cy, radius) {
    for (var dy = -radius; dy <= radius; dy++) {
      for (var dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        if (sec.tileAt(cx + dx, cy + dy) !== T.EMPTY) return false;
      }
    }
    return true;
  }

  SS.findOpenArea = findOpenArea;

  /* A random spot a ship can legally sit in.
   *
   * Wormhole clearance is a *default*, not an option, because every caller
   * here is putting a ship somewhere - spawning a pilot, warping the hero,
   * ejecting someone from a safe pad - and a wormhole's pull beats any hull's
   * thrust well before you reach it.  Dropping a ship inside one is never
   * what the caller meant, so the helper refuses to do it unless asked.
   *
   * Options: away/minDist keep clear of a point, clearance sets how much
   * open space is needed, insideBase:false stays out of buildings,
   * minWormholeDist:0 opts out of the wormhole check entirely.
   */
  SS.randomOpenSpot = function (sec, opts) {
    opts = opts || {};
    var minDist = opts.minDist || 0;
    var clearance = opts.clearance || 2;
    var wormholeDist = opts.minWormholeDist !== undefined
      ? opts.minWormholeDist
      : WORMHOLE_ESCAPE;

    /* Track the roomiest near-miss: a sector crowded with wells may have
       nowhere that satisfies everything, and returning the map centre would
       be worse than returning the best spot actually found. */
    var fallback = null, fallbackClearance = -1;

    for (var attempt = 0; attempt < 600; attempt++) {
      var x = SS.rn1(SIZE - 20, 10), y = SS.rn1(SIZE - 20, 10);
      if (!clearAround(sec, x, y, clearance)) continue;
      var pos = { x: x + 0.5, y: y + 0.5 };
      if (opts.away && SS.dist(pos, opts.away) < minDist) continue;
      if (opts.insideBase === false && insideAnyBase(sec, x, y)) continue;

      if (!wormholeDist) return pos;
      var gap = distanceToNearestWormhole(sec, pos);
      if (gap >= wormholeDist) return pos;
      if (gap > fallbackClearance) { fallbackClearance = gap; fallback = pos; }
    }
    return fallback || { x: SIZE / 2, y: SIZE / 2 };
  };

  function insideAnyBase(sec, x, y) {
    for (var i = 0; i < sec.bases.length; i++) {
      var b = sec.bases[i];
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return true;
    }
    return false;
  }

  /* ---- connectivity --------------------------------------------------- */

  /* Space is open enough that a sector is nearly always connected, but
     "nearly always" is not a guarantee, and a down portal walled off behind
     an asteroid field would be unwinnable.  Flood-fill from the spawn; if the
     portal is not in the reached set, blast a lane straight to it.
     Doors count as passable here - they all open eventually. */
  function ensureReachable(sec) {
    var target = sec.portalDown || sec.coreSpot || sec.portalUp;
    if (!sec.spawn || !target) return;
    var sx = Math.floor(sec.spawn.x), sy = Math.floor(sec.spawn.y);
    var reached = floodFrom(sec, sx, sy);

    var tx = Math.floor(target.x), ty = Math.floor(target.y);
    if (!reached[sec.idx(tx, ty)]) {
      boreTunnel(sec, sx, sy, tx, ty);
      reached = floodFrom(sec, sx, sy);
    }

    /* A base that an asteroid field has buried holds greens you can see and
       can never take, so every base gets the same guarantee the portal does.
       This almost never fires; when it does, an obviously mined-out lane is
       better than an unreachable building. */
    for (var i = 0; i < sec.bases.length; i++) {
      var base = sec.bases[i];
      var doors = base.entrances || [];
      if (!doors.length) continue;
      var open = false, nearest = doors[0], nearestD = Infinity;
      for (var d = 0; d < doors.length; d++) {
        if (reached[sec.idx(doors[d].x, doors[d].y)]) { open = true; break; }
        var dd = SS.length2(doors[d].x - sx, doors[d].y - sy);
        if (dd < nearestD) { nearestD = dd; nearest = doors[d]; }
      }
      if (open) continue;
      boreTunnel(sec, sx, sy, nearest.x, nearest.y);
      reached = floodFrom(sec, sx, sy);
    }
  }

  function floodFrom(sec, sx, sy) {
    var seen = new Uint8Array(SIZE * SIZE);
    if (passableForFlood(sec, sx, sy) === false) {
      /* the spawn itself is buried - clear a pocket and go on */
      for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) sec.setTile(sx + dx, sy + dy, T.EMPTY);
      }
    }
    var stack = [sy * SIZE + sx];
    seen[sy * SIZE + sx] = 1;
    while (stack.length) {
      var i = stack.pop();
      var x = i % SIZE, y = (i / SIZE) | 0;
      for (var k = 0; k < 4; k++) {
        var nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        var ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        var j = ny * SIZE + nx;
        if (seen[j]) continue;
        if (!passableForFlood(sec, nx, ny)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    return seen;
  }

  function passableForFlood(sec, tx, ty) {
    var t = sec.tileAt(tx, ty);
    if (t === T.DOOR || t === T.SCREEN) return true;
    return !TILES[t].solid;
  }

  /* A straight, three-wide lane. Ugly, but it only ever runs on the rare
     sector that needed rescuing, and an obviously mined-out corridor is
     better than an unreachable objective. */
  function boreTunnel(sec, x0, y0, x1, y1) {
    var steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (var s = 0; s <= steps; s++) {
      var t = steps ? s / steps : 0;
      var x = Math.round(SS.lerp(x0, x1, t));
      var y = Math.round(SS.lerp(y0, y1, t));
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var tile = sec.tileAt(x + dx, y + dy);
          if (tile === T.ROCK) sec.setTile(x + dx, y + dy, T.EMPTY);
        }
      }
    }
  }

  SS.floodFrom = floodFrom;

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
