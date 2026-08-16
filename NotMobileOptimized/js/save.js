/* 5Space - saving and restoring a run.
 *
 * A run is one JSON blob in localStorage: the RNG state, the player's hull
 * with everything the greens have done to it, and every sector generated so
 * far.  Restoring puts the universe back exactly as it was.
 *
 * The size problem is real and is solved by run-length encoding.  A sector is
 * 65,536 tiles and 26 of them would be 1.7MB of raw bytes - well past what
 * localStorage will take once base64 has added a third on top.  But a sector
 * is mostly empty space, so RLE crushes each tile array to a few kilobytes.
 * The `explored` mask compresses just as well for the same reason.
 *
 * Two things deliberately do not survive: shots in flight and decoys.  Warping
 * out clears the air anyway, and reconstituting a bomb mid-arc buys nothing.
 */
(function (SS) {
  'use strict';

  var save = {};
  SS.save = save;

  var SAVE_KEY = '5space.save.v1';
  var SCORE_KEY = '5space.scores.v1';
  var SAVE_VERSION = 1;

  /* ------------------------------------------------------------------ */
  /* sectors                                                            */
  /* ------------------------------------------------------------------ */

  /* Fields are listed rather than copied wholesale, so that a stray typed
     array or a back-reference can never end up in the blob by accident. */
  function packSector(sec) {
    return {
      depth: sec.depth,
      size: sec.size,
      tiles: SS.rleEncode(sec.tiles),
      doorGroup: SS.rleEncode(sec.doorGroup),
      explored: SS.rleEncode(sec.explored),
      greens: packGreens(sec.greens),
      wrecks: sec.wrecks,
      wormholes: sec.wormholes,
      safeZones: sec.safeZones,
      bases: sec.bases,
      spawn: sec.spawn,
      portalDown: sec.portalDown,
      portalUp: sec.portalUp,
      flagStand: sec.flagStand,
      coreSpot: sec.coreSpot || null,
      coreRoom: sec.coreRoom || null,
      clock: sec.clock,
      bricks: sec.bricks,
      visited: sec.visited,
      startingEnemies: sec.startingEnemies || 0,
      enemies: sec.enemies.map(function (e) { return packEnemy(e, sec); })
    };
  }

  function unpackSector(data) {
    var sec = new SS.Sector(data.depth);
    var n = data.size * data.size;
    sec.size = data.size;
    sec.tiles = SS.rleDecode(data.tiles, n);
    sec.doorGroup = SS.rleDecode(data.doorGroup, n);
    sec.explored = SS.rleDecode(data.explored, n);
    sec.greens = unpackGreens(data.greens);
    sec.wrecks = data.wrecks || [];
    sec.wormholes = data.wormholes || [];
    sec.safeZones = data.safeZones || [];
    sec.bases = data.bases || [];
    sec.spawn = data.spawn;
    sec.portalDown = data.portalDown;
    sec.portalUp = data.portalUp;
    sec.flagStand = data.flagStand;
    if (data.coreSpot) sec.coreSpot = data.coreSpot;
    if (data.coreRoom) sec.coreRoom = data.coreRoom;
    sec.clock = data.clock || 0;
    sec.bricks = data.bricks || [];
    sec.visited = !!data.visited;
    sec.startingEnemies = data.startingEnemies || 0;
    sec.enemies = (data.enemies || []).map(function (e) { return unpackEnemy(e, sec); });
    sec.shots = [];
    sec.decoys = [];
    return sec;
  }

  /* ---- greens ---------------------------------------------------------- */

  /* There are four hundred-odd greens in a sector and twenty-six sectors in a
     finished run, so the shape of one green decides whether the save fits in
     localStorage at all.  As a tuple it is four numbers; as an object with
     named keys it is four times that.

     Greens spilled by a kill carry an expiry and live about twenty seconds,
     so they are simply dropped rather than serialised. */
  function packGreens(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      if (g.expires) continue;
      out.push([round2(g.x), round2(g.y), round2(g.taken || 0),
                (g.inBase ? 1 : 0) | (g.special ? g.special << 1 : 0)]);
    }
    return out;
  }

  function unpackGreens(rows) {
    return (rows || []).map(function (r) {
      return {
        x: r[0], y: r[1], taken: r[2],
        inBase: (r[3] & 1) === 1,
        special: r[3] >> 1
      };
    });
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  /* ---- pilots ---------------------------------------------------------- */

  /* Most of what a flying pilot carries is scratch: which way it was banking,
     how long until it next wobbles its aim, where it was last heading. None
     of it is worth a byte in the save, and all of it can be rebuilt from the
     roster entry - so store only what a run has actually changed, and let
     makeEnemy's own defaults supply the rest on the way back in.

     A base-guarding pilot points at a base object that is also in the
     sector's list, so that is stored as an index and relinked on load. */
  var DURABLE = ['id', 'enemyKey', 'x', 'y', 'vx', 'vy', 'orient', 'energy',
                 'guns', 'bombs', 'mines', 'bounty', 'kills', 'alive', 'isBoss',
                 'portalDrop', 'home'];

  function packEnemy(e, sec) {
    var out = {};
    DURABLE.forEach(function (k) {
      var v = e[k];
      /* omit the falsy defaults; they cost as much as the real values */
      if (v === undefined || v === null || v === false || v === 0) return;
      out[k] = (k === 'x' || k === 'y' || k === 'vx' || k === 'vy' || k === 'orient' ||
                k === 'energy') ? round2(v) : v;
    });
    out.stat = e.stat;
    out.has = compactFlags(e.has);
    out.on = compactFlags(e.on);
    out.count = compactCounts(e.count);
    var gb = e.guardsBase ? sec.bases.indexOf(e.guardsBase) : -1;
    if (gb >= 0) out.gb = gb;
    return out;
  }

  function unpackEnemy(data, sec) {
    var def = SS.enemyByKey(data.enemyKey);
    if (!def) def = SS.ENEMIES[0];
    /* rebuild a stock pilot of this type, then lay the saved state over it */
    var e = SS.makeEnemy(def, sec, data.x || 0, data.y || 0, sec.depth, true);
    DURABLE.forEach(function (k) {
      if (data[k] !== undefined) e[k] = data[k];
    });
    if (data.x === undefined) e.x = 0;
    if (data.y === undefined) e.y = 0;
    e.vx = data.vx || 0;
    e.vy = data.vy || 0;
    e.orient = data.orient || 0;
    e.energy = data.energy || 0;
    e.bounty = data.bounty || 0;
    e.kills = data.kills || 0;
    e.alive = data.alive !== undefined ? data.alive : true;
    e.isBoss = !!data.isBoss;
    e.portalDrop = data.portalDrop || null;
    if (data.stat) e.stat = data.stat;
    expandFlags(e.has, data.has);
    expandFlags(e.on, data.on);
    expandCounts(e.count, data.count);
    e.guardsBase = (data.gb !== undefined && sec.bases[data.gb]) ? sec.bases[data.gb] : null;
    return e;
  }

  /* Booleans become a space-separated list of the ones that are true. */
  function compactFlags(obj) {
    var on = [];
    Object.keys(obj).forEach(function (k) { if (obj[k]) on.push(k); });
    return on.length ? on.join(' ') : undefined;
  }

  function expandFlags(target, str) {
    Object.keys(target).forEach(function (k) { target[k] = false; });
    if (!str) return;
    str.split(' ').forEach(function (k) { if (k in target) target[k] = true; });
  }

  function compactCounts(obj) {
    var out = null;
    Object.keys(obj).forEach(function (k) {
      if (!obj[k]) return;
      (out = out || {})[k] = obj[k];
    });
    return out || undefined;
  }

  function expandCounts(target, src) {
    Object.keys(target).forEach(function (k) { target[k] = 0; });
    if (!src) return;
    Object.keys(src).forEach(function (k) { if (k in target) target[k] = src[k]; });
  }

  /* ------------------------------------------------------------------ */
  /* serialisation                                                      */
  /* ------------------------------------------------------------------ */

  save.serialize = function () {
    var g = SS.game;
    var sectors = {};
    Object.keys(g.sectors).forEach(function (d) {
      sectors[d] = packSector(g.sectors[d]);
    });
    return {
      version: SAVE_VERSION,
      gameVersion: SS.VERSION,
      savedAt: Date.now(),
      seed: g.seed,
      rngState: SS.rng.getState(),
      depth: g.depth,
      maxDepthReached: g.maxDepthReached,
      points: g.points,
      elapsed: g.elapsed,
      kills: g.kills,
      prizeLog: g.prizeLog,
      greensTaken: g.greensTaken,
      flagTaken: g.flagTaken,
      player: g.player,
      sectors: sectors,
      nextShipId: SS.ship.peekId(),
      messages: SS.hud.history.slice(-40)
    };
  };

  save.deserialize = function (data) {
    var g = SS.game;
    g.seed = data.seed;
    g.depth = data.depth;
    g.maxDepthReached = data.maxDepthReached || data.depth;
    g.points = data.points || 0;
    g.elapsed = data.elapsed || 0;
    g.kills = data.kills || {};
    g.prizeLog = data.prizeLog || {};
    g.greensTaken = data.greensTaken || 0;
    g.flagTaken = !!data.flagTaken;

    g.player = data.player;
    g.sectors = {};
    Object.keys(data.sectors).forEach(function (d) {
      g.sectors[d] = unpackSector(data.sectors[d]);
    });
    g.sector = g.sectors[g.depth];

    SS.ship.resetIds(data.nextShipId || 1);
    SS.radar.reset();

    /* Restoring pilots rebuilds them through makeEnemy, which draws from the
       RNG, so the saved stream is put back *after* the world is - otherwise
       loading a game would silently advance it. */
    SS.rng.setState(data.rngState);

    g.started = true;
    g.over = false;
    g.ended = false;
    g.paused = false;
    g.won = false;
    g.escaped = false;
    g.quit = false;
    g.deathReason = null;
    return true;
  };

  /* ------------------------------------------------------------------ */
  /* storage                                                            */
  /* ------------------------------------------------------------------ */

  save.hasSave = function () {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  };

  save.saveGame = function () {
    var g = SS.game;
    if (!g || !g.started || g.over) return false;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save.serialize()));
      return true;
    } catch (e) {
      console.warn('5Space: could not save:', e);
      SS.msg('Warning: the run could not be saved (' + e.name + ').', '#ff8a6a');
      return false;
    }
  };

  save.loadGame = function () {
    try {
      var blob = localStorage.getItem(SAVE_KEY);
      if (!blob) return false;
      var data = JSON.parse(blob);
      if (data.version !== SAVE_VERSION) {
        console.warn('5Space: save version mismatch, ignoring.');
        return false;
      }
      return save.deserialize(data);
    } catch (e) {
      console.error('5Space: could not load save:', e);
      return false;
    }
  };

  save.deleteSave = function () {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  };

  save.saveInfo = function () {
    try {
      var blob = localStorage.getItem(SAVE_KEY);
      if (!blob) return null;
      var data = JSON.parse(blob);
      return {
        name: data.player.name,
        ship: data.player.shipKey,
        depth: data.depth,
        maxDepth: data.maxDepthReached,
        points: data.points,
        elapsed: data.elapsed,
        hasFlag: !!data.player.hasFlag,
        savedAt: data.savedAt
      };
    } catch (e) {
      return null;
    }
  };

  /* ------------------------------------------------------------------ */
  /* export / import                                                    */
  /* ------------------------------------------------------------------ */

  save.exportToFile = function () {
    var data = (SS.game.started && !SS.game.over)
      ? JSON.stringify(save.serialize())
      : localStorage.getItem(SAVE_KEY);
    if (!data) { SS.msg('There is no run to export.'); return; }
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var p = SS.game.player;
    a.href = url;
    a.download = '5space-' + (p ? p.name + '-' + p.shipKey : 'run') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  save.importFromFile = function () {
    return new Promise(function (resolve) {
      var el = document.createElement('input');
      el.type = 'file';
      el.accept = '.json,application/json';
      el.onchange = function () {
        var file = el.files && el.files[0];
        if (!file) { resolve(false); return; }
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var data = JSON.parse(String(reader.result));
            if (data.version !== SAVE_VERSION) { resolve(false); return; }
            localStorage.setItem(SAVE_KEY, String(reader.result));
            resolve(save.deserialize(data));
          } catch (e) {
            console.error('5Space: bad save file:', e);
            resolve(false);
          }
        };
        reader.readAsText(file);
      };
      el.click();
    });
  };

  /* ------------------------------------------------------------------ */
  /* high scores                                                        */
  /* ------------------------------------------------------------------ */

  save.getScores = function () {
    try {
      var raw = localStorage.getItem(SCORE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  };

  save.addScore = function (entry) {
    try {
      var scores = save.getScores();
      scores.push(entry);
      scores.sort(function (a, b) { return b.score - a.score; });
      if (scores.length > 25) scores.length = 25;
      localStorage.setItem(SCORE_KEY, JSON.stringify(scores));
      return scores;
    } catch (e) {
      return [entry];
    }
  };

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
