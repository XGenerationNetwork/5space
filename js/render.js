/* 5Space - drawing the world.
 *
 * One canvas, drawn from scratch every frame: a parallax starfield, the tile
 * map, ships, shots, pickups, then the SubSpace furniture on top - corner
 * radar, energy gauge and the ship's own status readout.  Everything is
 * generated art from sprites.js, so there is nothing to load and nothing to
 * go missing.
 *
 * The camera is locked to the ship and clamped to the sector edges, which is
 * how Continuum did it and is the reason the map borders are three tiles of
 * solid rock: so the view never runs out of world.
 */
(function (SS) {
  'use strict';

  var render = {};
  SS.render = render;

  var canvas, ctx;
  var W = 0, H = 0, dpr = 1;

  /* Screen pixels per tile.  Sixteen is Continuum's, and it is what a desktop
     gets; a phone would see twenty-three tiles across at that scale, which is
     not enough of the world to fly in.  So the zoom drops on small viewports
     and `scale` carries the difference through to everything drawn in pixels
     rather than tiles - ships, shots, pickups, text. */
  var BASE_TILE = 16;
  var MIN_TILES_SHORT_SIDE = 34;    // how much world the short axis must show
  var TILE = BASE_TILE;
  var scale = 1;
  var camX = 0, camY = 0;

  /* Where the on-screen controls are, so the HUD can keep out from under a
     thumb.  The pads sit in the bottom *corners*, so `gutter` (how far in
     they reach from each side) matters more than `bottom` (how tall they
     are): in landscape there is plenty of room between them at the very
     bottom of the screen, and only in portrait do they meet in the middle
     and force the gauges upward. */
  var insets = { top: 0, bottom: 0, gutter: 0, controls: false };

  render.setInsets = function (next) {
    insets.top = next.top || 0;
    insets.bottom = next.bottom || 0;
    insets.gutter = next.gutter || 0;
    insets.controls = !!next.controls;
  };

  render.tileSize = function () { return TILE; };

  var stars = [];
  var effects = [];
  render.effects = effects;

  render.showFullMap = false;

  /* ------------------------------------------------------------------ */
  /* setup                                                              */
  /* ------------------------------------------------------------------ */

  render.init = function () {
    canvas = document.getElementById('screen');
    ctx = canvas.getContext('2d', { alpha: false });
    SS.sprites.init();
    buildStars();
    window.addEventListener('resize', render.resize);
    render.resize();
  };

  render.resize = function () {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(320, window.innerWidth);
    H = Math.max(240, window.innerHeight);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    TILE = SS.clamp(Math.floor(Math.min(W, H) / MIN_TILES_SHORT_SIDE), 10, BASE_TILE);
    scale = TILE / BASE_TILE;
  };

  /* Font sizes are in desktop pixels and get scaled with everything else, but
     never below the point where they stop being readable. */
  function font(size, bold) {
    return (bold ? 'bold ' : '') + Math.max(10, Math.round(size * scale)) +
      'px "DejaVu Sans Mono", "Courier New", monospace';
  }

  render.viewport = function () { return { w: W, h: H }; };

  /* Three parallax layers, seeded from Math.random so that regenerating them
     never disturbs the simulation's stream. */
  function buildStars() {
    stars = [];
    for (var layer = 0; layer < 3; layer++) {
      var count = [140, 90, 50][layer];
      var depth = [0.15, 0.32, 0.55][layer];
      var size = [1, 1.4, 2][layer];
      var alpha = [0.35, 0.55, 0.8][layer];
      for (var i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * 2000, y: Math.random() * 2000,
          depth: depth, size: size, alpha: alpha,
          tint: Math.random() < 0.12
        });
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* camera                                                             */
  /* ------------------------------------------------------------------ */

  function updateCamera(sec, player) {
    var halfW = W / (2 * TILE), halfH = H / (2 * TILE);
    camX = SS.clamp(player.x, halfW, sec.size - halfW);
    camY = SS.clamp(player.y, halfH, sec.size - halfH);
    if (sec.size < W / TILE) camX = sec.size / 2;
    if (sec.size < H / TILE) camY = sec.size / 2;
  }

  function sx(wx) { return (wx - camX) * TILE + W / 2; }
  function sy(wy) { return (wy - camY) * TILE + H / 2; }
  render.toScreen = function (wx, wy) { return { x: sx(wx), y: sy(wy) }; };

  /* ------------------------------------------------------------------ */
  /* the frame                                                          */
  /* ------------------------------------------------------------------ */

  render.draw = function (game) {
    if (!ctx) return;
    var sec = game.sector, player = game.player;

    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, W, H);
    if (!sec || !player) return;

    updateCamera(sec, player);

    drawStars();
    drawTiles(sec, player);
    drawGreens(sec);
    drawWrecks(sec);
    drawFlag(game);
    drawDecoys(sec);
    drawShots(sec);
    drawShips(sec, player);
    drawEffects();
    drawWormholePull(sec, player);

    if (render.showFullMap) drawFullMap(sec, player);
    else drawRadar(sec, player);

    drawGauges(game);
    drawStatus(game);
    if (game.paused) drawPaused();
  };

  /* A held game has to look held, and has to say how to leave.  The message
     log fades after seven seconds, so "Paused." on its own left the screen
     looking merely frozen. */
  function drawPaused() {
    ctx.fillStyle = 'rgba(4, 6, 12, 0.55)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#eaf4ff';
    ctx.font = 'bold ' + Math.round(Math.min(46, W * 0.075)) +
      'px "DejaVu Sans Mono", "Courier New", monospace';
    ctx.fillText('PAUSED', W / 2, H / 2 - 8);

    ctx.font = font(14);
    ctx.fillStyle = '#9fb6d0';
    ctx.fillText(SS.hud.isTouchDevice()
      ? 'Tap anywhere to resume'
      : 'Click anywhere, or press P, to resume',
      W / 2, H / 2 + 26);
    ctx.fillStyle = '#7f96b0';
    ctx.fillText('Esc for the menu', W / 2, H / 2 + 48);
  }

  function drawStars() {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var x = ((s.x - camX * TILE * s.depth) % 2000 + 2000) % 2000;
      var y = ((s.y - camY * TILE * s.depth) % 2000 + 2000) % 2000;
      if (x > W + 4 || y > H + 4) continue;
      ctx.fillStyle = s.tint
        ? 'rgba(150,190,255,' + s.alpha + ')'
        : 'rgba(255,255,255,' + s.alpha + ')';
      ctx.fillRect(x, y, s.size, s.size);
    }
  }

  /* Only non-empty tiles are drawn, and only inside the view, so an open
     sector costs almost nothing and a base costs a few hundred blits. */
  function drawTiles(sec, player) {
    var x0 = Math.max(0, Math.floor(camX - W / (2 * TILE)) - 1);
    var x1 = Math.min(sec.size - 1, Math.ceil(camX + W / (2 * TILE)) + 1);
    var y0 = Math.max(0, Math.floor(camY - H / (2 * TILE)) - 1);
    var y1 = Math.min(sec.size - 1, Math.ceil(camY + H / (2 * TILE)) + 1);

    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        var t = sec.tiles[ty * sec.size + tx];
        if (t === SS.T.EMPTY) continue;
        var img = SS.sprites.tile(t, tx, ty, t === SS.T.DOOR && sec.doorOpen(tx, ty));
        if (!img) continue;
        ctx.drawImage(img, Math.round(sx(tx)), Math.round(sy(ty)), TILE, TILE);
      }
    }

    /* portals and the flag stand get a pulse so they read at a glance */
    if (sec.portalDown) pulseRing(sec.portalDown, '#ffd24a', 3.2);
    if (sec.portalUp) pulseRing(sec.portalUp, '#4ac8ff', 3.2);
    if (sec.flagStand) pulseRing(sec.flagStand, '#ff5555', 2.4);
    for (var i = 0; i < sec.wormholes.length; i++) {
      pulseRing(sec.wormholes[i], '#a060ff', 3.0);
    }
    if (player.portalDrop) pulseRing(player.portalDrop, '#aa66ff', 1.6);
  }

  function pulseRing(pos, color, radius) {
    var t = (Date.now() % 1600) / 1600;
    var r = radius * TILE * (0.7 + t * 0.5);
    var a = 0.55 * (1 - t);
    ctx.strokeStyle = SS.sprites.rgba(color, a);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx(pos.x), sy(pos.y), r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawGreens(sec) {
    var img = SS.sprites.green();
    var spin = (Date.now() % 1200) / 1200;
    for (var i = 0; i < sec.greens.length; i++) {
      var g = sec.greens[i];
      if (g.taken && sec.clock - g.taken < SS.ARENA.PrizeDelay) continue;
      var px = sx(g.x), py = sy(g.y);
      if (px < -20 || py < -20 || px > W + 20 || py > H + 20) continue;
      /* the squash makes it read as a rotating gem without a second sprite */
      var w = (16 * Math.abs(Math.cos(spin * Math.PI * 2)) + 4) * scale;
      var h = 20 * scale;
      ctx.drawImage(img, px - w / 2, py - h / 2, w, h);
    }
  }

  function drawWrecks(sec) {
    var img = SS.sprites.wreck();
    for (var i = 0; i < sec.wrecks.length; i++) {
      var wr = sec.wrecks[i];
      if (wr.broken) continue;
      var px = sx(wr.x), py = sy(wr.y);
      if (px < -30 || py < -30 || px > W + 30 || py > H + 30) continue;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(wr.orient * Math.PI * 2);
      ctx.scale(scale, scale);
      ctx.drawImage(img, -14, -14);
      ctx.restore();
    }
  }

  function drawFlag(game) {
    var sec = game.sector;
    if (game.player.hasFlag || !sec.flagStand || game.flagTaken) return;
    if (sec.depth !== SS.MAXDEPTH) return;
    var img = SS.sprites.flag();
    var bob = Math.sin(Date.now() / 400) * 3;
    ctx.drawImage(img, sx(sec.flagStand.x) - 12 * scale, sy(sec.flagStand.y) - 12 * scale + bob,
      24 * scale, 24 * scale);
  }

  function drawDecoys(sec) {
    var decoys = sec.decoys || [];
    for (var i = 0; i < decoys.length; i++) {
      var d = decoys[i];
      ctx.globalAlpha = 0.75;
      blitShip(d.shipKey, SS.SHIPS[d.shipKey].color, d.orient, d.x, d.y);
      ctx.globalAlpha = 1;
    }
  }

  var SHOT_STYLE = {
    bullet: { r: 2.4, core: '#ffffff', glow: '#ffe066' },
    burst:  { r: 2.2, core: '#ffffff', glow: '#88ddff' },
    shrap:  { r: 1.8, core: '#ffdddd', glow: '#ff8844' },
    bomb:   { r: 5.0, core: '#ffffff', glow: '#ff5533' },
    mine:   { r: 4.5, core: '#ffdddd', glow: '#ff3366' },
    thor:   { r: 6.0, core: '#ffffff', glow: '#66ccff' }
  };

  function drawShots(sec) {
    var shots = sec.shots || [];
    for (var i = 0; i < shots.length; i++) {
      var w = shots[i];
      var px = sx(w.x), py = sy(w.y);
      if (px < -30 || py < -30 || px > W + 30 || py > H + 30) continue;
      var st = SHOT_STYLE[w.type] || SHOT_STYLE.bullet;
      var r = st.r * scale * (w.type === 'bomb' || w.type === 'mine' ? (0.7 + w.level * 0.3) : 1);

      /* bullets get a short streak along their heading */
      if (w.type === 'bullet' || w.type === 'shrap' || w.type === 'burst') {
        var speed = SS.length(w.vx, w.vy);
        if (speed > 0.01) {
          ctx.strokeStyle = SS.sprites.rgba(st.glow, 0.5);
          ctx.lineWidth = r * 1.1;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - (w.vx / speed) * r * 4, py - (w.vy / speed) * r * 4);
          ctx.stroke();
        }
      }

      var grad = ctx.createRadialGradient(px, py, 0, px, py, r * 2.6);
      grad.addColorStop(0, st.core);
      grad.addColorStop(0.4, st.glow);
      grad.addColorStop(1, SS.sprites.rgba(st.glow, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, r * 2.6, 0, Math.PI * 2);
      ctx.fill();

      /* a mine that has been triggered flashes so you get your one warning */
      if (w.type === 'mine' && !w.proximityTriggered && (Date.now() % 800) < 120) {
        ctx.strokeStyle = 'rgba(255,80,120,0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, r * 3.4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawShips(sec, player) {
    for (var i = 0; i < sec.enemies.length; i++) {
      var e = sec.enemies[i];
      if (!e.alive) continue;
      if (!SS.radar.visible(player, e)) continue;
      var px = sx(e.x), py = sy(e.y);
      if (px < -60 || py < -60 || px > W + 60 || py > H + 60) continue;
      if (e.on.cloak) ctx.globalAlpha = 0.35;
      blitShip(e.shipKey, e.color || SS.SHIPS[e.shipKey].color, e.orient, e.x, e.y);
      ctx.globalAlpha = 1;
      drawShipDecoration(e, px, py, false);
    }

    if (player.alive) {
      if (player.on.cloak) ctx.globalAlpha = 0.4;
      drawThrustFlame(player);
      blitShip(player.shipKey, SS.SHIPS[player.shipKey].color, player.orient, player.x, player.y);
      ctx.globalAlpha = 1;
      drawShipDecoration(player, sx(player.x), sy(player.y), true);
      if (player.hasFlag) {
        ctx.drawImage(SS.sprites.flag(), sx(player.x) - 4 * scale, sy(player.y) - 26 * scale,
          24 * scale, 24 * scale);
      }
    }
  }

  function blitShip(key, color, orient, wx, wy) {
    var sheet = SS.sprites.shipSheet(key, color);
    var rot = SS.orientToRotation(orient);
    var px = SS.sprites.SHIP_PX;
    var d = Math.round(px * scale);
    ctx.drawImage(sheet, rot * px, 0, px, px,
      Math.round(sx(wx) - d / 2), Math.round(sy(wy) - d / 2), d, d);
  }

  function drawThrustFlame(sh) {
    if (!sh.thrusting) return;
    var head = SS.orientToHeading(sh.orient);
    var bx = sx(sh.x) - head.x * 18 * scale, by = sy(sh.y) - head.y * 18 * scale;
    var flicker = 0.6 + Math.random() * 0.4;
    var len = (sh.timer.rocket > 0 ? 26 : 14) * flicker * scale;
    var grad = ctx.createRadialGradient(bx, by, 0, bx, by, len);
    grad.addColorStop(0, sh.timer.rocket > 0 ? '#ffffff' : '#ffe9a0');
    grad.addColorStop(0.4, sh.afterburning ? '#66ccff' : '#ff9a3c');
    grad.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, len, 0, Math.PI * 2);
    ctx.fill();
  }

  /* Bounty, shields, super and the emp flash all read off the hull itself. */
  function drawShipDecoration(sh, px, py, isPlayer) {
    if (sh.timer.shields > 0 || sh.timer.super > 0) {
      var t = (Date.now() % 500) / 500;
      ctx.strokeStyle = sh.timer.super > 0
        ? 'rgba(255,240,120,' + (0.5 + t * 0.3) + ')'
        : 'rgba(120,200,255,' + (0.4 + t * 0.3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 24 * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (sh.timer.shutdown > 0) {
      ctx.strokeStyle = 'rgba(255,80,80,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, (26 + Math.sin(Date.now() / 90) * 3) * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (!isPlayer) {
      /* the bounty tag, in SubSpace's own idiom */
      ctx.font = font(11);
      ctx.textAlign = 'center';
      ctx.fillStyle = sh.isBoss ? '#ffffff' : 'rgba(255,220,140,0.85)';
      ctx.fillText(String(Math.round(sh.bounty)), px, py + 30 * scale);
      if (sh.isBoss) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(sh.name, px, py - 26 * scale);
      }
    }
  }

  /* A faint tug-line towards a wormhole that has you, so the pull is legible
     rather than just baffling. */
  function drawWormholePull(sec, player) {
    for (var i = 0; i < sec.wormholes.length; i++) {
      var w = sec.wormholes[i];
      var d = SS.dist(player, w);
      if (d > 22) continue;
      ctx.strokeStyle = 'rgba(160,96,255,' + SS.clamp(0.5 - d / 50, 0, 0.45) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx(player.x), sy(player.y));
      ctx.lineTo(sx(w.x), sy(w.y));
      ctx.stroke();
    }
  }

  /* ------------------------------------------------------------------ */
  /* effects                                                            */
  /* ------------------------------------------------------------------ */

  render.explosion = function (x, y, radius, color) {
    effects.push({
      kind: 'boom', x: x, y: y, radius: radius,
      color: color || '#ff8844', t: 0, life: 0.55
    });
  };

  render.flash = function (x, y, color) {
    effects.push({ kind: 'flash', x: x, y: y, color: color || '#88ccff', t: 0, life: 0.35 });
  };

  render.pickup = function (x, y, text, color) {
    effects.push({
      kind: 'float', x: x, y: y, text: text,
      color: color || '#9fffc0', t: 0, life: 1.1
    });
  };

  render.stepEffects = function (dt) {
    for (var i = effects.length - 1; i >= 0; i--) {
      effects[i].t += dt;
      if (effects[i].t >= effects[i].life) effects.splice(i, 1);
    }
  };

  function drawEffects() {
    for (var i = 0; i < effects.length; i++) {
      var e = effects[i];
      var t = e.t / e.life;
      var px = sx(e.x), py = sy(e.y);

      if (e.kind === 'boom') {
        var r = e.radius * TILE * (0.25 + t * 1.05);
        var grad = ctx.createRadialGradient(px, py, 0, px, py, r);
        grad.addColorStop(0, 'rgba(255,255,255,' + (1 - t) * 0.9 + ')');
        grad.addColorStop(0.35, SS.sprites.rgba(e.color, (1 - t) * 0.75));
        grad.addColorStop(1, SS.sprites.rgba(e.color, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'flash') {
        ctx.strokeStyle = SS.sprites.rgba(e.color, 1 - t);
        ctx.lineWidth = 3 * (1 - t) + 1;
        ctx.beginPath();
        ctx.arc(px, py, (8 + t * 40) * scale, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.kind === 'float') {
        ctx.font = font(13, true);
        ctx.textAlign = 'center';
        ctx.fillStyle = SS.sprites.rgba(e.color, 1 - t);
        ctx.fillText(e.text, px, py - (30 + t * 26) * scale);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* radar                                                              */
  /* ------------------------------------------------------------------ */

  var RADAR_PX = 190;

  function drawRadar(sec, player) {
    var size = Math.min(RADAR_PX, Math.floor(Math.min(W, H) * (insets.controls ? 0.22 : 0.28)));
    var x0 = W - size - 12, y0 = 12;
    var span = 110;                       // tiles across the pane
    var pxPerTile = size / span;   // radar pixels per world tile

    panel(x0, y0, size, size);

    var ox = player.x - span / 2, oy = player.y - span / 2;

    /* explored terrain, sampled rather than drawn tile by tile */
    var stepT = Math.max(1, Math.round(1 / pxPerTile));
    for (var ty = 0; ty < span; ty += stepT) {
      for (var tx = 0; tx < span; tx += stepT) {
        var wx = Math.floor(ox + tx), wy = Math.floor(oy + ty);
        if (!sec.inBounds(wx, wy)) continue;
        if (!sec.explored[wy * sec.size + wx]) continue;
        var t = sec.tiles[wy * sec.size + wx];
        if (t === SS.T.EMPTY) continue;
        var c = SS.TILES[t].color;
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x0 + tx * pxPerTile, y0 + ty * pxPerTile,
          Math.max(1, stepT * pxPerTile), Math.max(1, stepT * pxPerTile));
      }
    }

    var blips = SS.radar.blips(sec, player);
    for (var i = 0; i < blips.length; i++) {
      var b = blips[i];
      var bx = x0 + (b.x - ox) * pxPerTile, by = y0 + (b.y - oy) * pxPerTile;
      if (bx < x0 || by < y0 || bx > x0 + size || by > y0 + size) continue;
      ctx.fillStyle = b.color;
      if (b.ring) {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bx, by, b.size + 1.5, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillRect(bx - b.size / 2, by - b.size / 2, b.size, b.size);
      }
    }

    /* you, always centred */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0 + size / 2 - 1.5, y0 + size / 2 - 1.5, 3, 3);

    ctx.strokeStyle = 'rgba(120,180,220,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, size, size);
  }

  /* The Alt-key whole-sector view, complete with everything you have swept. */
  function drawFullMap(sec, player) {
    var size = Math.min(W, H) - 80;
    var x0 = (W - size) / 2, y0 = (H - size) / 2;
    var mapScale = size / sec.size;

    ctx.fillStyle = 'rgba(4,6,12,0.92)';
    ctx.fillRect(x0 - 8, y0 - 8, size + 16, size + 16);

    var step = Math.max(1, Math.round(1 / mapScale));
    for (var ty = 0; ty < sec.size; ty += step) {
      for (var tx = 0; tx < sec.size; tx += step) {
        if (!sec.explored[ty * sec.size + tx]) continue;
        var t = sec.tiles[ty * sec.size + tx];
        if (t === SS.T.EMPTY) continue;
        var c = SS.TILES[t].color;
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x0 + tx * mapScale, y0 + ty * mapScale,
          Math.max(1, step * mapScale), Math.max(1, step * mapScale));
      }
    }

    var blips = SS.radar.blips(sec, player);
    for (var i = 0; i < blips.length; i++) {
      var b = blips[i];
      ctx.fillStyle = b.color;
      ctx.fillRect(x0 + b.x * mapScale - 2, y0 + b.y * mapScale - 2, 4, 4);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0 + player.x * mapScale - 2, y0 + player.y * mapScale - 2, 4, 4);

    ctx.strokeStyle = 'rgba(120,180,220,0.6)';
    ctx.strokeRect(x0 - 0.5, y0 - 0.5, size + 1, size + 1);

    ctx.font = font(13);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(180,210,240,0.9)';
    ctx.fillText('Sector ' + sec.depth + '  -  release Alt to return',
      W / 2, y0 + size + 26);
  }

  /* ------------------------------------------------------------------ */
  /* gauges                                                             */
  /* ------------------------------------------------------------------ */

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(8,12,20,0.72)';
    ctx.fillRect(x, y, w, h);
  }

  /* The energy bar is the whole game: it is your health, your ammunition and
     your afterburner, so it gets the biggest thing on the screen. */
  function drawGauges(game) {
    var p = game.player;
    var max = SS.ship.energyMax(p);
    var frac = SS.clamp(p.energy / max, 0, 1);

    /* The bar wants the bottom centre.  If the thumb pads leave a usable gap
       between them - which they do in landscape - it stays there and just
       narrows to fit.  Only when they close up, as they do in portrait, does
       it climb above them. */
    var gap = W - insets.gutter * 2;
    var lifted = insets.controls && gap < 220;
    var barH = insets.controls ? 14 : 18;
    var barW = lifted
      ? Math.min(460, W * 0.6)
      : SS.clamp(gap - 24, 120, Math.min(460, W * 0.5));
    var x0 = (W - barW) / 2;
    var y0 = H - barH - 16 - (lifted ? insets.bottom : 0);

    panel(x0 - 3, y0 - 3, barW + 6, barH + 6);

    var color = frac > 0.55 ? '#3fd07a' : (frac > 0.28 ? '#e0c13a' : '#e04a3a');
    var grad = ctx.createLinearGradient(x0, y0, x0, y0 + barH);
    grad.addColorStop(0, SS.sprites.lighten(color, 0.35));
    grad.addColorStop(1, SS.sprites.darken(color, 0.25));
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y0, barW * frac, barH);

    ctx.strokeStyle = 'rgba(150,190,230,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, barW - 1, barH - 1);

    ctx.font = font(12, true);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eaf2ff';
    ctx.fillText(Math.round(p.energy) + ' / ' + Math.round(max),
      x0 + barW / 2, y0 + barH - 5);

    /* the safe-zone loiter clock, when it is running */
    if (game.sector.inSafeZone(p.x, p.y)) {
      var left = Math.max(0, SS.ARENA.SafetyLimit - p.timer.safety);
      ctx.fillStyle = left < 8 ? '#ff8866' : '#7fe0a8';
      ctx.fillText('SAFE  ' + left.toFixed(1) + 's', W / 2, y0 - 12);
    }
  }

  /* Hull, sector, bounty, points, and the stock of every limited-use item
     this hull can carry.  Bottom-left on a desktop; when on-screen controls
     are up there is no bottom-left to speak of, so it collapses to two lines
     under the message log instead. */
  function drawStatus(game) {
    var p = game.player;
    var def = SS.ship.def(p);

    if (insets.controls) { drawStatusCompact(game); return; }

    var lines = [];
    lines.push({ text: def.name + '  -  Sector ' + game.sector.depth +
      (game.shipsLeft > 1 ? '  -  ' + game.shipsLeft + ' hulls' : '') +
      (game.player.hasFlag ? '  [PRIME FLAG]' : ''), color: '#cfe4ff' });
    lines.push({ text: 'Guns ' + p.guns + '   Bombs ' + (p.bombs || '-') +
      (p.mines ? '   Mines ' + p.mines : '') +
      '   Bounty ' + Math.round(p.bounty), color: '#9fb6d0' });

    var stock = [];
    SS.weapons.UTILITIES.forEach(function (u) {
      if (!SS.ship.capFor(SS.ship.settings(p), u.key)) return;
      stock.push(u.label + ':' + p.count[u.key]);
    });
    if (stock.length) lines.push({ text: stock.join('  '), color: '#8fa6c0' });

    var toggles = [];
    ['cloak', 'stealth', 'xradar', 'antiwarp'].forEach(function (k) {
      if (!p.has[k]) return;
      toggles.push((p.on[k] ? '[' + k.toUpperCase() + ']' : k));
    });
    if (p.has.multifire) toggles.push(p.wantsMulti ? '[MULTI]' : 'multi');
    if (p.has.bouncing) toggles.push('bounce');
    if (p.has.proximity) toggles.push('prox');
    if (toggles.length) lines.push({ text: toggles.join(' '), color: '#7f96b0' });

    lines.push({ text: 'Points ' + SS.commify(game.points) +
      '   Kills ' + p.kills + '   T ' + SS.clockString(game.elapsed),
      color: '#7f96b0' });

    ctx.font = font(12);
    ctx.textAlign = 'left';
    var lh = 16;
    var boxH = lines.length * lh + 10;
    panel(8, H - boxH - 8, 340, boxH);
    for (var i = 0; i < lines.length; i++) {
      ctx.fillStyle = lines[i].color;
      ctx.fillText(lines[i].text, 16, H - boxH - 8 + 18 + i * lh);
    }
  }

  /* The phone version: only what you have to glance at mid-fight, tucked
     under the radar where no thumb reaches. */
  function drawStatusCompact(game) {
    var p = game.player;
    var def = SS.ship.def(p);

    var first = def.name + '  S' + game.sector.depth +
      (game.shipsLeft > 1 ? '  x' + game.shipsLeft : '') +
      '  G' + p.guns + (p.bombs ? ' B' + p.bombs : '') +
      '  ' + Math.round(p.bounty) + 'pts' +
      (p.hasFlag ? '  [FLAG]' : '');

    var stock = [];
    SS.weapons.UTILITIES.forEach(function (u) {
      var n = p.count[u.key];
      if (!n) return;
      stock.push(u.label.charAt(0) + n);
    });
    ['cloak', 'stealth', 'xradar', 'antiwarp'].forEach(function (k) {
      if (p.on[k]) stock.push(k.slice(0, 4).toUpperCase());
    });

    ctx.font = font(11);
    ctx.textAlign = 'left';
    var lh = Math.round(14 * scale);
    var y = insets.top + 8;
    var lines = (stock.length && W >= 520) ? [first, stock.join(' ')] : [first];
    var wide = 0;
    lines.forEach(function (t) { wide = Math.max(wide, ctx.measureText(t).width); });

    panel(8, y, wide + 16, lines.length * lh + 8);
    lines.forEach(function (t, i) {
      ctx.fillStyle = i ? '#8fa6c0' : '#cfe4ff';
      ctx.fillText(t, 16, y + 14 + i * lh);
    });
  }

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
