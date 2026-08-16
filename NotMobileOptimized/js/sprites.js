/* 5Space - artwork, generated at startup.
 *
 * The original shipped a pile of BMPs.  This one has no assets at all: every
 * ship, tile and pickup is drawn into an offscreen canvas the first time the
 * game runs, which keeps the whole thing a single file you can open from a
 * USB stick and still lets each hull have its own silhouette.
 *
 * Ships are pre-rendered at all forty rotations, exactly as Continuum stores
 * them, so the sprite you see is quantised to the same forty headings the
 * simulation fires along.  Rotating the canvas per frame would look smoother
 * and would be wrong.
 */
(function (SS) {
  'use strict';

  var sprites = {};
  SS.sprites = sprites;

  var SHIP_PX = 44;          // sprite cell, in pixels, at 1x
  sprites.SHIP_PX = SHIP_PX;

  /* Hull outlines in a nose-up unit space: x right, y down, nose at (0,-1).
     Each entry is a list of polygons; the first is the hull, the rest are
     detail drawn in a lighter shade. */
  var HULLS = {
    warbird: {
      hull: [[0, -1], [0.62, 0.55], [0.28, 0.34], [0, 0.62], [-0.28, 0.34], [-0.62, 0.55]],
      detail: [[[0, -0.55], [0.2, 0.2], [-0.2, 0.2]]]
    },
    javelin: {
      hull: [[0, -1], [0.3, 0.1], [0.78, 0.62], [0.16, 0.44], [0, 0.7],
             [-0.16, 0.44], [-0.78, 0.62], [-0.3, 0.1]],
      detail: [[[0, -0.62], [0.12, 0.3], [-0.12, 0.3]]]
    },
    spider: {
      hull: [[0, -0.9], [0.42, -0.24], [0.9, 0.2], [0.34, 0.28], [0.5, 0.86],
             [0, 0.44], [-0.5, 0.86], [-0.34, 0.28], [-0.9, 0.2], [-0.42, -0.24]],
      detail: [[[0, -0.5], [0.22, 0.12], [-0.22, 0.12]]]
    },
    leviathan: {
      hull: [[0, -0.94], [0.46, -0.62], [0.86, 0.1], [0.7, 0.72], [0.24, 0.9],
             [-0.24, 0.9], [-0.7, 0.72], [-0.86, 0.1], [-0.46, -0.62]],
      detail: [[[0, -0.6], [0.34, 0.1], [0.2, 0.5], [-0.2, 0.5], [-0.34, 0.1]]]
    },
    terrier: {
      hull: [[0, -0.86], [0.5, -0.4], [0.62, 0.36], [0.3, 0.8], [-0.3, 0.8],
             [-0.62, 0.36], [-0.5, -0.4]],
      detail: [[[0, -0.42], [0.3, 0.06], [0, 0.5], [-0.3, 0.06]]]
    },
    weasel: {
      hull: [[0, -1], [0.24, 0.24], [0.56, 0.72], [0, 0.4], [-0.56, 0.72], [-0.24, 0.24]],
      detail: [[[0, -0.7], [0.1, 0.1], [-0.1, 0.1]]]
    },
    lancaster: {
      hull: [[0, -0.92], [0.26, -0.3], [0.96, 0.16], [0.96, 0.44], [0.24, 0.36],
             [0.16, 0.82], [-0.16, 0.82], [-0.24, 0.36], [-0.96, 0.44],
             [-0.96, 0.16], [-0.26, -0.3]],
      detail: [[[0, -0.56], [0.16, 0.24], [-0.16, 0.24]]]
    },
    shark: {
      hull: [[0, -1], [0.5, 0.16], [0.24, 0.2], [0.66, 0.88], [0, 0.46],
             [-0.66, 0.88], [-0.24, 0.2], [-0.5, 0.16]],
      detail: [[[0, -0.6], [0.18, 0.16], [-0.18, 0.16]]]
    }
  };

  /* ------------------------------------------------------------------ */
  /* building the sheets                                                */
  /* ------------------------------------------------------------------ */

  var shipSheets = {};       // "shipKey|color" -> canvas of 40 frames
  var tileCanvases = {};     // tile id -> array of variant canvases
  var greenCanvas = null;
  var flagCanvas = null;
  var wreckCanvas = null;
  var ready = false;

  sprites.init = function () {
    if (ready) return;
    SS.shipList().forEach(function (key) {
      buildShipSheet(key, SS.SHIPS[key].color);
    });
    buildTiles();
    buildPickups();
    ready = true;
  };

  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function polyPath(ctx, pts, cx, cy, scale, rot) {
    var cos = Math.cos(rot), sin = Math.sin(rot);
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var px = pts[i][0] * scale, py = pts[i][1] * scale;
      var rx = px * cos - py * sin;
      var ry = px * sin + py * cos;
      if (i === 0) ctx.moveTo(cx + rx, cy + ry);
      else ctx.lineTo(cx + rx, cy + ry);
    }
    ctx.closePath();
  }

  function buildShipSheet(key, color) {
    var id = key + '|' + color;
    if (shipSheets[id]) return shipSheets[id];

    var hull = HULLS[key] || HULLS.warbird;
    var sheet = newCanvas(SHIP_PX * SS.ROTATIONS, SHIP_PX);
    var ctx = sheet.getContext('2d');
    var scale = SHIP_PX * 0.42;

    for (var r = 0; r < SS.ROTATIONS; r++) {
      var cx = r * SHIP_PX + SHIP_PX / 2;
      var cy = SHIP_PX / 2;
      var rot = (r / SS.ROTATIONS) * Math.PI * 2;

      /* body */
      polyPath(ctx, hull.hull, cx, cy, scale, rot);
      var grad = ctx.createLinearGradient(cx, cy - scale, cx, cy + scale);
      grad.addColorStop(0, lighten(color, 0.45));
      grad.addColorStop(0.55, color);
      grad.addColorStop(1, darken(color, 0.5));
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = darken(color, 0.68);
      ctx.lineWidth = 1.4;
      ctx.stroke();

      /* detail plating */
      ctx.fillStyle = lighten(color, 0.62);
      hull.detail.forEach(function (poly) {
        polyPath(ctx, poly, cx, cy, scale, rot);
        ctx.fill();
      });

      /* cockpit */
      var head = SS.rotationToHeading(r);
      ctx.beginPath();
      ctx.arc(cx + head.x * scale * 0.22, cy + head.y * scale * 0.22, scale * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = '#f4fbff';
      ctx.fill();
    }

    shipSheets[id] = sheet;
    return sheet;
  }

  sprites.shipSheet = function (key, color) {
    var id = key + '|' + (color || SS.SHIPS[key].color);
    return shipSheets[id] || buildShipSheet(key, color || SS.SHIPS[key].color);
  };

  /* ---- tiles ----------------------------------------------------------- */

  var TILE_PX = 16;
  sprites.TILE_PX = TILE_PX;

  function buildTiles() {
    var T = SS.T;
    tileCanvases[T.ROCK] = [];
    for (var v = 0; v < 4; v++) tileCanvases[T.ROCK].push(rockTile(v));
    tileCanvases[T.WALL] = [wallTile('#4a5a72', '#63769a')];
    tileCanvases[T.DOOR] = [doorTile(false), doorTile(true)];
    tileCanvases[T.SAFE] = [flatTile('#12321f', '#2fae70', true)];
    tileCanvases[T.WORMHOLE] = [flatTile('#1b0f2e', '#8a4bd8', false)];
    tileCanvases[T.PORTAL_DOWN] = [flatTile('#3a2c05', '#f0c040', false)];
    tileCanvases[T.PORTAL_UP] = [flatTile('#052c3a', '#40c0f0', false)];
    tileCanvases[T.FLAGSTAND] = [flatTile('#3a0808', '#ff5555', false)];
    tileCanvases[T.BRICK] = [wallTile('#6b4322', '#a5703c')];
    tileCanvases[T.SCREEN] = [screenTile()];
  }

  /* A deterministic wobble per tile so a rock field is not a grid of clones. */
  function rockTile(variant) {
    var c = newCanvas(TILE_PX, TILE_PX);
    var ctx = c.getContext('2d');
    var base = ['#6b6257', '#5f574d', '#766c60', '#585148'][variant];
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
    /* speckle, using Math.random: this runs once at startup and must not
       touch the seeded stream */
    for (var i = 0; i < 26; i++) {
      var x = Math.floor(Math.random() * TILE_PX);
      var y = Math.floor(Math.random() * TILE_PX);
      ctx.fillStyle = Math.random() < 0.5
        ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.14)';
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, TILE_PX - 1, TILE_PX - 1);
    return c;
  }

  function wallTile(fill, edge) {
    var c = newCanvas(TILE_PX, TILE_PX);
    var ctx = c.getContext('2d');
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, TILE_PX - 1, TILE_PX - 1);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(2, 2, TILE_PX - 4, 3);
    return c;
  }

  function doorTile(open) {
    var c = newCanvas(TILE_PX, TILE_PX);
    var ctx = c.getContext('2d');
    if (open) {
      ctx.strokeStyle = 'rgba(140,170,220,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, TILE_PX - 2, TILE_PX - 2);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(140,170,220,0.25)';
      ctx.beginPath();
      ctx.moveTo(0, TILE_PX / 2); ctx.lineTo(TILE_PX, TILE_PX / 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#8899bb';
      ctx.fillRect(0, 0, TILE_PX, TILE_PX);
      ctx.fillStyle = '#5d6c8c';
      for (var y = 2; y < TILE_PX; y += 5) ctx.fillRect(1, y, TILE_PX - 2, 2);
      ctx.strokeStyle = '#c3d2ee';
      ctx.strokeRect(0.5, 0.5, TILE_PX - 1, TILE_PX - 1);
    }
    return c;
  }

  function flatTile(fill, edge, hatch) {
    var c = newCanvas(TILE_PX, TILE_PX);
    var ctx = c.getContext('2d');
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
    if (hatch) {
      ctx.strokeStyle = edge;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, TILE_PX); ctx.lineTo(TILE_PX, 0);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = edge;
      ctx.globalAlpha = 0.22;
      ctx.fillRect(3, 3, TILE_PX - 6, TILE_PX - 6);
      ctx.globalAlpha = 1;
    }
    return c;
  }

  function screenTile() {
    var c = newCanvas(TILE_PX, TILE_PX);
    var ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(90,190,210,0.75)';
    ctx.lineWidth = 1;
    for (var i = 2; i < TILE_PX; i += 4) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i, TILE_PX);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(60,140,160,0.18)';
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
    return c;
  }

  sprites.tile = function (tileId, tx, ty, doorOpen) {
    var set = tileCanvases[tileId];
    if (!set) return null;
    if (tileId === SS.T.DOOR) return set[doorOpen ? 1 : 0];
    if (set.length === 1) return set[0];
    /* stable hash so the same rock always looks the same */
    var h = (tx * 73856093) ^ (ty * 19349663);
    return set[(h >>> 0) % set.length];
  };

  /* ---- pickups --------------------------------------------------------- */

  function buildPickups() {
    greenCanvas = newCanvas(20, 20);
    var g = greenCanvas.getContext('2d');
    var grad = g.createRadialGradient(10, 10, 1, 10, 10, 9);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, '#7dffa8');
    grad.addColorStop(1, 'rgba(40,200,90,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 20, 20);
    g.fillStyle = '#c8ffd8';
    g.beginPath();
    g.moveTo(10, 3); g.lineTo(16, 10); g.lineTo(10, 17); g.lineTo(4, 10);
    g.closePath();
    g.fill();
    g.strokeStyle = '#2fae70';
    g.lineWidth = 1;
    g.stroke();

    flagCanvas = newCanvas(24, 24);
    var f = flagCanvas.getContext('2d');
    f.strokeStyle = '#e8e8e8';
    f.lineWidth = 2;
    f.beginPath(); f.moveTo(6, 22); f.lineTo(6, 2); f.stroke();
    f.fillStyle = '#ff4444';
    f.beginPath();
    f.moveTo(7, 3); f.lineTo(21, 8); f.lineTo(7, 13);
    f.closePath();
    f.fill();
    f.strokeStyle = '#ffdddd';
    f.lineWidth = 1;
    f.stroke();

    wreckCanvas = newCanvas(28, 28);
    var w = wreckCanvas.getContext('2d');
    w.fillStyle = '#5a5a66';
    w.beginPath();
    w.moveTo(14, 2); w.lineTo(25, 20); w.lineTo(17, 17);
    w.lineTo(12, 26); w.lineTo(9, 15); w.lineTo(3, 19);
    w.closePath();
    w.fill();
    w.strokeStyle = '#8a8a99';
    w.lineWidth = 1;
    w.stroke();
    w.fillStyle = 'rgba(255,140,60,0.5)';
    w.fillRect(11, 10, 5, 5);
  }

  sprites.green = function () { return greenCanvas; };
  sprites.flag = function () { return flagCanvas; };
  sprites.wreck = function () { return wreckCanvas; };

  /* ---- colour helpers -------------------------------------------------- */

  function parse(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }

  function toHex(rgb) {
    return '#' + rgb.map(function (v) {
      var s = Math.round(SS.clamp(v, 0, 255)).toString(16);
      return s.length < 2 ? '0' + s : s;
    }).join('');
  }

  function lighten(hex, amount) {
    var c = parse(hex);
    return toHex(c.map(function (v) { return v + (255 - v) * amount; }));
  }
  function darken(hex, amount) {
    var c = parse(hex);
    return toHex(c.map(function (v) { return v * (1 - amount); }));
  }
  sprites.lighten = lighten;
  sprites.darken = darken;

  sprites.rgba = function (hex, alpha) {
    var c = parse(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
  };

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
