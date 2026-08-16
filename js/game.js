/* 5Space - game state, the simulation loop, sector transitions and endgame.
 *
 * The loop is a fixed 100 Hz accumulator with rendering on requestAnimation-
 * Frame.  100 Hz is Continuum's tick, so every setting quoted "per tick"
 * means what it says, and the physics behave identically whether the display
 * is running at 60, 120 or 144.
 *
 * The roguelike skeleton underneath is 5Hack's, one concept at a time:
 *
 *   dungeon level  ->  sector, persistent, regenerated never
 *   staircase down ->  warp portal
 *   Amulet of Yendor -> the Prime Flag, in a vault at sector 26
 *   permadeath     ->  permadeath, on Normal
 *
 * Take the Flag, carry it back up through twenty-six sectors, and warp out
 * through the top.  On Normal, dying is the end of the run; on Easy you have
 * a wing of hulls and losing one costs you everything it had collected, which
 * is SubSpace's own answer to the same question.  See data/difficulty.js.
 */
(function (SS) {
  'use strict';

  SS.VERSION = '1.0';

  var game = {
    player: null,
    sector: null,
    sectors: {},
    depth: 1,
    maxDepthReached: 1,
    seed: 0,
    difficulty: 'normal',
    shipsLeft: 1,
    points: 0,
    elapsed: 0,
    kills: {},
    prizeLog: {},
    greensTaken: 0,
    flagTaken: false,
    started: false,
    over: false,
    ended: false,
    paused: false,
    escaped: false,
    won: false,
    deathReason: null,
    killer: null
  };
  SS.game = game;

  var running = false;
  var lastFrame = 0;
  var accumulator = 0;
  var MAX_FRAME = 0.25;              // never simulate more than a quarter second at once

  /* ------------------------------------------------------------------ */
  /* starting a run                                                     */
  /* ------------------------------------------------------------------ */

  game.newGame = function (opts) {
    /* Set before anything is generated: sector layout, pilot builds and the
       green table all read the mode straight off the run. */
    game.difficulty = SS.difficultyByKey(opts.difficulty).key;
    game.shipsLeft = SS.difficulty().ships;

    game.seed = opts.seed || ((Date.now() ^ (Math.random() * 0x100000000)) >>> 0);
    SS.rng.seed(game.seed);
    SS.ship.resetIds(1);
    SS.radar.reset();

    game.sectors = {};
    game.depth = 1;
    game.maxDepthReached = 1;
    game.points = 0;
    game.elapsed = 0;
    game.kills = {};
    game.prizeLog = {};
    game.greensTaken = 0;
    game.flagTaken = false;
    game.over = false;
    game.ended = false;
    game.escaped = false;
    game.won = false;
    game.paused = false;
    game.deathReason = null;
    game.killer = null;
    game.quit = false;
    /* These are wall-clock accumulators rather than part of the world, and
       leaving them set from a previous run means the next one gets its first
       reinforcement seconds after launch instead of minutes. */
    game.spawnTimer = 0;
    game.autosaveTimer = 0;
    game.leaveWarned = false;
    SS.hud.clearMessages();

    var sec = SS.makeSector(1);
    game.sectors[1] = sec;
    game.sector = sec;

    game.player = SS.ship.create(opts.shipKey, {
      team: 'player',
      name: opts.name || 'Pilot',
      x: sec.spawn.x, y: sec.spawn.y
    });
    game.player.timer.spawnGuard = 2.0;
    SS.radar.revealAround(sec, sec.spawn.x, sec.spawn.y, 24);

    game.started = true;

    var def = SS.SHIPS[opts.shipKey];
    SS.msgBig('Sector 1', '#9fd6ff');
    SS.msg('You launch in a ' + def.name + '. Find the warp portal and go down.');
    if (game.shipsLeft > 1) {
      SS.msg('Easy: a wing of ' + game.shipsLeft + ' hulls. Losing one costs ' +
        'you everything it was carrying.', '#9fd6ff');
    }
    SS.msg('Green diamonds are prizes. You will not know what one is until you take it.');
  };

  /* ------------------------------------------------------------------ */
  /* the loop                                                           */
  /* ------------------------------------------------------------------ */

  game.start = function () {
    if (running) return;
    running = true;
    lastFrame = performance.now();
    accumulator = 0;
    requestAnimationFrame(frame);
  };

  game.stop = function () { running = false; };

  game.setPaused = function (v) {
    if (game.paused === !!v) return;
    game.paused = !!v;
    /* Held controls should not survive the pause: a thumb lifted while the
       game was stopped never produced a release the input layer saw. */
    if (game.paused && SS.hud.releaseTouch) SS.hud.releaseTouch();
    SS.msg(game.paused ? 'Paused.' : 'Resumed.');
  };

  /* Any tap or click on the game itself resumes.  Buttons are excluded so the
     on-screen Pause control toggles once rather than toggling and immediately
     un-toggling, and menus are excluded because the hud owns those. */
  game.installResumeOnTap = function () {
    window.addEventListener('pointerdown', function (e) {
      if (!game.paused || !game.started || game.over) return;
      if (SS.hud.isOpen()) return;
      if (e.target && e.target.closest && e.target.closest('.tbtn')) return;
      game.setPaused(false);
    }, true);
  };

  /* Does the game read the keyboard and the on-screen controls this frame?
   *
   * Deliberately *not* the same question as "does the world advance".  It is
   * true while paused, which is the whole point: a pause that stops reading
   * input is a pause you cannot leave.  Actions used to be dispatched only
   * inside the simulating branch, so pressing P froze the game and then
   * ignored P, Escape and the menu button forever, and the only way out was
   * to reload the page.
   *
   * Split out so the distinction can be asserted rather than just believed. */
  game.ownsInput = function () {
    return game.started && !game.over && !SS.hud.isOpen();
  };

  game.isSimulating = function () {
    return game.ownsInput() && !game.paused;
  };

  function frame(nowMs) {
    if (!running) return;
    var dt = (nowMs - lastFrame) / 1000;
    lastFrame = nowMs;
    if (dt > MAX_FRAME) dt = MAX_FRAME;

    var live = game.ownsInput();
    var simulating = game.isSimulating();

    if (simulating) {
      accumulator += dt;
      var guard = 0;
      while (accumulator >= SS.TICK_DT && guard++ < 40) {
        tick(SS.TICK_DT);
        accumulator -= SS.TICK_DT;
        if (game.over) break;
      }
      SS.render.stepEffects(dt);
    } else {
      /* keep the presentation alive while a menu is up or the game is held */
      SS.render.stepEffects(Math.min(dt, 0.05));
      accumulator = 0;
    }

    if (live) handleActions();

    SS.render.showFullMap = simulating && SS.input.showingMap();
    if (game.started && game.player) SS.render.draw(game);
    SS.hud.drawMessages();

    if (game.over && !game.ended) {
      running = false;
      game.endGame();
      return;
    }
    requestAnimationFrame(frame);
  }

  /* ---- one simulation tick -------------------------------------------- */

  function tick(dt) {
    var sec = game.sector, p = game.player;
    game.elapsed += dt;

    sec.tickDoors(dt);
    sec.tickWormholes();
    sec.expireBricks();

    var flight = SS.input.flight();
    p.thrusting = flight.forward || flight.backward;
    p.afterburning = flight.afterburner && p.thrusting;

    var res = SS.ship.update(p, sec, flight, dt);
    if (res === 'safety-expired') {
      p.timer.safety = 0;
      SS.msg('You have been in the safe zone too long. Get moving.', '#ffaa66');
      var out = SS.randomOpenSpot(sec, { away: p, minDist: 12 });
      p.x = out.x; p.y = out.y;
    }

    if (SS.input.firingGun()) SS.weapons.fireBullet(p, sec);

    var ships = allShips();
    SS.updateEnemies(sec, dt, p, ships, callbacks);
    SS.weapons.update(sec, dt, ships, callbacks);

    collectGreens(sec, p);
    checkWrecks(sec, p);
    checkWormholes(sec, p);
    checkPortals(sec, p);
    reapEnemies(sec);
    trickleReinforcements(sec, dt);

    SS.radar.update(sec, p);

    if (!p.alive && !game.over) {
      game.death(p.lastHitBy);
    }

    game.autosaveTimer = (game.autosaveTimer || 0) + dt;
    if (game.autosaveTimer > 20) {
      game.autosaveTimer = 0;
      SS.save.saveGame();
    }
  }

  /* The test harness drives the simulation directly rather than through
     requestAnimationFrame, so one tick - and the action dispatch that the
     frame loop normally calls alongside it - are part of the public surface. */
  game.step = tick;

  function allShips() {
    var list = [game.player];
    var e = game.sector.enemies;
    for (var i = 0; i < e.length; i++) if (e[i].alive) list.push(e[i]);
    return list;
  }
  game.allShips = allShips;

  /* ---- weapon callbacks ------------------------------------------------ */

  var callbacks = {
    onHit: function (sh, damage, w, killed) {
      if (!killed) {
        if (sh === game.player) SS.render.flash(sh.x, sh.y, '#ff6666');
        return;
      }
      SS.render.explosion(sh.x, sh.y, 3.2, '#ffaa55');
      if (sh === game.player) return;      // handled by reapEnemies

      sh.alive = false;
      if (w.owner === game.player.id) creditKill(sh);
    },
    onExplode: function (w, radius) {
      SS.render.explosion(w.x, w.y, radius, w.type === 'thor' ? '#88ccff' : '#ff8844');
    }
  };

  function creditKill(victim) {
    var p = game.player;
    p.kills++;
    game.kills[victim.enemyKey] = (game.kills[victim.enemyKey] || 0) + 1;
    /* SubSpace's reward: what a kill is worth scales with the victim's
       bounty, so the pilots that hurt are the pilots that pay. */
    var award = SS.ARENA.RewardBase / 2 + victim.bounty * 12 + game.depth * 8;
    if (victim.isBoss) award *= 6;
    game.points += Math.round(award);
    p.bounty += SS.ARENA.BountyIncreaseForKill;
    SS.render.pickup(victim.x, victim.y, '+' + Math.round(award), '#ffd98a');
  }

  function reapEnemies(sec) {
    for (var i = sec.enemies.length - 1; i >= 0; i--) {
      var e = sec.enemies[i];
      if (e.alive) continue;
      if (!e.spilled) {
        e.spilled = true;
        SS.ship.spillPrizes(e, sec);
        if (e.isBoss) {
          SS.msgBig('The Core Guardian breaks apart.', '#ffe08a');
        }
      }
      sec.enemies.splice(i, 1);
    }
  }

  /* ---- greens ---------------------------------------------------------- */

  function collectGreens(sec, p) {
    if (!p.alive) return;
    var reach = p.radius + 0.8;
    for (var i = sec.greens.length - 1; i >= 0; i--) {
      var g = sec.greens[i];
      if (g.expires && sec.clock > g.expires) { sec.greens.splice(i, 1); continue; }
      if (g.taken && sec.clock - g.taken < SS.ARENA.PrizeDelay) continue;
      if (SS.dist2(p, g) > reach * reach) continue;
      takeGreen(sec, p, g, i);
    }
  }

  function takeGreen(sec, p, g, index) {
    var prizeId;
    if (g.special) prizeId = g.special;
    else prizeId = SS.rollPrize(SS.ship.def(p), SS.negativeFactorFor(sec.depth));

    var msg = SS.ship.applyPrize(p, prizeId, sec);
    var negative = prizeId < 0;
    var def = SS.prizeById(prizeId);

    game.greensTaken++;
    if (def) {
      var entry = game.prizeLog[def.id] || (game.prizeLog[def.id] = { took: 0, lost: 0 });
      if (negative) entry.lost++; else entry.took++;
    }

    if (msg) {
      SS.msg(msg, negative ? '#ff8a6a' : '#9fffc0');
      SS.render.pickup(g.x, g.y, msg.replace(/\.$/, ''), negative ? '#ff8a6a' : '#9fffc0');
    }

    /* Greens in open space come back after a delay, the way a zone respawns
       them; the ones inside a base and the ones spilled by a kill do not. */
    if (g.inBase || g.expires || g.special) sec.greens.splice(index, 1);
    else g.taken = sec.clock;
  }

  function checkWrecks(sec, p) {
    for (var i = 0; i < sec.wrecks.length; i++) {
      var wr = sec.wrecks[i];
      if (wr.broken) continue;
      if (SS.dist2(p, wr) > 4) continue;
      wr.broken = true;
      SS.render.explosion(wr.x, wr.y, 2.0, '#ffcc66');
      SS.msg('The derelict breaks open.', '#ffd98a');
      for (var k = 0; k < wr.prizes; k++) {
        var a = SS.rng.float() * Math.PI * 2;
        var r = SS.rnf(1.5, 6);
        var gx = SS.clamp(wr.x + Math.cos(a) * r, 2, sec.size - 3);
        var gy = SS.clamp(wr.y + Math.sin(a) * r, 2, sec.size - 3);
        if (sec.solidAtPos(gx, gy)) continue;
        var g = SS.makeGreen(gx, gy, true);
        sec.greens.push(g);
      }
    }
  }

  /* ---- wormholes and portals ------------------------------------------- */

  /* Move one ship through a wormhole, if it is in the mouth of one and has
     not already been taken by it.
   *
   * The re-arm is spatial, not a countdown.  A timer only works if the ship
   * can get clear before it expires, and inside a well nothing can: the pull
   * beats any hull's thrust, so a ship dropped near a mouth is simply taken
   * again the moment the timer runs out.  Requiring the ship to actually
   * leave every well before it can be grabbed again is the condition that
   * cannot loop.  With destinations now placed clear of every hole, this is
   * belt and braces - but it is the belt.
   *
   * Momentum is conserved, as it is in the original: a wormhole flings you,
   * it does not park you. */
  function wormholeTransit(sec, sh) {
    var w = SS.physics.wormholeAt(sec, sh.x, sh.y);
    if (!w) {
      sh.inWormhole = false;         // clear of them all: re-arm
      return null;
    }
    if (sh.inWormhole || sh.timer.spawnGuard > 0) return null;

    var dest = w.dest || SS.wormholeDestination(sec);
    sh.x = dest.x;
    sh.y = dest.y;
    sh.inWormhole = true;
    return dest;
  }

  function checkWormholes(sec, p) {
    var dest = wormholeTransit(sec, p);
    if (dest) {
      SS.render.flash(dest.x, dest.y, '#a060ff');
      SS.msg('The wormhole spits you out somewhere else.', '#c9a0ff');
      SS.radar.revealAround(sec, dest.x, dest.y, 18);
    }

    /* Pilots go through them too.  They were always subject to the gravity
       and never to the transit, so every well in the sector quietly filled up
       with ships that could not thrust their way back out and were never
       thrown clear - a hazard that ate the sector's population. */
    for (var i = 0; i < sec.enemies.length; i++) {
      var e = sec.enemies[i];
      if (!e.alive) continue;
      if (wormholeTransit(sec, e)) {
        e.patrolTarget = null;       // wherever it was going, it is not there now
      }
    }
  }

  function checkPortals(sec, p) {
    if (p.timer.spawnGuard > 0) return;
    var t = sec.tileAt(Math.floor(p.x), Math.floor(p.y));

    if (t === SS.T.PORTAL_DOWN) {
      game.changeSector(1);
      return;
    }
    if (t === SS.T.PORTAL_UP) {
      if (game.depth === 1) {
        if (p.hasFlag) { game.win(); return; }
        if (!game.leaveWarned) {
          game.leaveWarned = true;
          SS.msg('This portal leads out of the sector chain. Come back with the Prime Flag.', '#9fd6ff');
        }
        return;
      }
      game.changeSector(-1);
      return;
    }
    if (t === SS.T.FLAGSTAND && !game.flagTaken && sec.depth === SS.MAXDEPTH) {
      takeFlag();
    }
  }

  function takeFlag() {
    game.flagTaken = true;
    game.player.hasFlag = true;
    game.points += 5000;
    SS.msgBig('You have the Prime Flag.', '#ff8888');
    SS.msg('Every pilot in the chain now knows exactly where you are.', '#ff8888');
  }

  /* ---- reinforcements --------------------------------------------------- */

  function trickleReinforcements(sec, dt) {
    game.spawnTimer = (game.spawnTimer || 0) + dt;
    var interval = (game.player.hasFlag ? 4.0 : 18.0) * SS.difficulty().reinforcements;
    if (game.spawnTimer < interval) return;
    game.spawnTimer = 0;
    SS.spawnWanderer(sec, sec.depth, game.player, game.player.hasFlag);
  }

  /* ------------------------------------------------------------------ */
  /* discrete actions                                                   */
  /* ------------------------------------------------------------------ */

  /* What still works while the game is held.  Firing a bomb from a paused
     game would be a cheat; opening the menu, reading a screen or unpausing is
     the entire reason input keeps being read. */
  game.handleActions = function () { handleActions(); };

  var PAUSED_ACTIONS = {
    pause: 1, menu: 1, help: 1, discoveries: 1, shipinfo: 1, save: 1
  };

  function handleActions() {
    var actions = SS.input.takeActions();
    if (!actions.length) return;
    var p = game.player, sec = game.sector;

    for (var i = 0; i < actions.length; i++) {
      if (game.paused && !PAUSED_ACTIONS[actions[i]]) continue;
      switch (actions[i]) {
        case 'bomb': SS.weapons.fireBomb(p, sec); break;
        case 'mine':
          if (!SS.weapons.fireMine(p, sec)) SS.msg('No mines.', '#ff9a6a');
          break;
        case 'burst':
          if (!SS.weapons.fireBurst(p, sec)) SS.msg('No bursts left.', '#ff9a6a');
          break;
        case 'repel':
          if (!SS.weapons.useRepel(p, sec, allShips())) SS.msg('No repels left.', '#ff9a6a');
          break;
        case 'decoy':
          if (!SS.weapons.useDecoy(p, sec)) SS.msg('No decoys left.', '#ff9a6a');
          break;
        case 'thor':
          if (!SS.weapons.fireThor(p, sec)) SS.msg('No thors left.', '#ff9a6a');
          break;
        case 'brick':
          if (!SS.weapons.useBrick(p, sec)) SS.msg('No room to lay a brick.', '#ff9a6a');
          break;
        case 'rocket':
          if (SS.weapons.useRocket(p)) SS.msg('Rocket!', '#ffd98a');
          else SS.msg('No rockets left.', '#ff9a6a');
          break;
        case 'portal': usePortal(p, sec); break;
        case 'warp': warpSelf(p, sec); break;
        case 'multifire':
          if (!p.has.multifire) { SS.msg('This hull has no multifire.', '#ff9a6a'); break; }
          p.wantsMulti = !p.wantsMulti;
          SS.msg(p.wantsMulti ? 'Multifire on.' : 'Multifire off.');
          break;
        case 'cloak': toggle(p, 'cloak'); break;
        case 'stealth': toggle(p, 'stealth'); break;
        case 'xradar': toggle(p, 'xradar'); break;
        case 'antiwarp': toggle(p, 'antiwarp'); break;
        case 'pause': game.setPaused(!game.paused); break;
        case 'save': SS.save.saveGame(); SS.msg('Saved.'); break;
        case 'menu': SS.commands.openMenu(); break;
        case 'help': SS.commands.help(); break;
        case 'discoveries': SS.commands.discoveries(); break;
        case 'shipinfo': SS.commands.shipReadout(); break;
      }
    }
  }

  function toggle(p, name) {
    if (!p.has[name]) { SS.msg('You do not have ' + name + '.', '#ff9a6a'); return; }
    var on = SS.ship.toggle(p, name);
    SS.msg(SS.capitalize(name) + (on ? ' on.' : ' off.'));
  }

  function usePortal(p, sec) {
    var blocker = SS.radar.warpBlocked(sec, p);
    if (blocker && p.portalDrop) {
      SS.msg('Antiwarp: you cannot warp with a ' + blocker.name + ' this close.', '#ff9a6a');
      return;
    }
    var r = SS.weapons.usePortal(p, sec);
    if (r === 'drop') {
      SS.msg('Portal dropped.', '#c9a0ff');
      SS.render.flash(p.x, p.y, '#aa66ff');
    } else if (r === 'warp') {
      SS.msg('Warping to your portal.', '#c9a0ff');
      SS.render.flash(p.x, p.y, '#aa66ff');
      SS.radar.revealAround(sec, p.x, p.y, 16);
    } else {
      SS.msg('No portals left.', '#ff9a6a');
    }
  }

  function warpSelf(p, sec) {
    var blocker = SS.radar.warpBlocked(sec, p);
    if (blocker) {
      SS.msg('Antiwarp holds you in place.', '#ff9a6a');
      return;
    }
    var spot = SS.randomOpenSpot(sec, { away: p, minDist: 30 });
    p.x = spot.x; p.y = spot.y;
    p.vx = p.vy = 0;
    p.timer.spawnGuard = 1.0;
    SS.render.flash(spot.x, spot.y, '#88ccff');
    SS.radar.revealAround(sec, spot.x, spot.y, 16);
    SS.msg('Warp.');
  }

  /* ------------------------------------------------------------------ */
  /* moving between sectors                                             */
  /* ------------------------------------------------------------------ */

  game.changeSector = function (delta) {
    var p = game.player;
    var target = game.depth + delta;
    if (target < 1) target = 1;
    if (target > SS.MAXDEPTH) target = SS.MAXDEPTH;
    if (target === game.depth) return;

    game.sector.playerLeftAt = game.sector.clock;
    game.depth = target;
    if (target > game.maxDepthReached) game.maxDepthReached = target;

    var fresh = false;
    if (!game.sectors[target]) {
      game.sectors[target] = SS.makeSector(target);
      fresh = true;
    }
    var sec = game.sectors[target];
    game.sector = sec;

    /* Arrive on the portal that matches the direction of travel, the way a
       staircase pairs up. */
    var arrival = delta > 0 ? sec.portalUp : sec.portalDown;
    if (!arrival) arrival = sec.spawn || SS.randomOpenSpot(sec, {});
    p.x = arrival.x; p.y = arrival.y;
    p.vx = p.vy = 0;
    p.timer.spawnGuard = 2.0;
    p.portalDrop = null;             // a beacon does not survive a sector warp

    /* the air clears when you leave */
    sec.shots = [];
    sec.decoys = [];

    SS.radar.reset();
    SS.radar.revealAround(sec, p.x, p.y, 24);

    SS.msgBig('Sector ' + target, delta > 0 ? '#ffd24a' : '#4ac8ff');
    if (fresh && target === SS.MAXDEPTH) {
      SS.msg('Something very large is awake down here.', '#ff8888');
    }
    if (p.hasFlag) {
      SS.msg('The Flag is drawing them in.', '#ff8888');
    }
    sec.visited = true;
    SS.save.saveGame();
  };

  /* ------------------------------------------------------------------ */
  /* endgame                                                            */
  /* ------------------------------------------------------------------ */

  game.death = function (killerId) {
    if (game.over) return;
    var p = game.player;
    var killer = null;
    for (var i = 0; i < game.sector.enemies.length; i++) {
      if (game.sector.enemies[i].id === killerId) killer = game.sector.enemies[i];
    }
    SS.render.explosion(p.x, p.y, 5, '#ffaa55');
    p.deaths++;

    /* With hulls to spare this is SubSpace's death rather than NetHack's: you
       lose the ship and everything the greens had built on it, and you go
       again.  That loss is the whole penalty and it is a real one - a hull
       stripped back to factory in sector 19 is in serious trouble. */
    if (game.shipsLeft > 1) {
      game.shipsLeft--;
      respawnPlayer(killer);
      return;
    }

    game.shipsLeft = 0;
    game.over = true;
    game.killer = killer ? killer.name : null;
    game.deathReason = killer
      ? 'shot down by ' + SS.anArticle(killer.name)
      : 'destroyed in sector ' + game.depth;
  };

  function respawnPlayer(killer) {
    var p = game.player;
    var sec = game.sector;

    /* The Flag does not come back with you.  It returns to the vault it came
       from, so the climb has to be done again - the one part of a run that
       spare hulls do not soften. */
    if (p.hasFlag) {
      p.hasFlag = false;
      game.flagTaken = false;
      SS.msgBig('The Prime Flag falls back to the Core.', '#ff8888');
    }

    SS.ship.resetToInitial(p);
    var spot = sec.portalUp || sec.spawn || SS.randomOpenSpot(sec, {});
    p.x = spot.x; p.y = spot.y;
    p.vx = p.vy = 0;
    p.inWormhole = false;
    p.timer.spawnGuard = SS.ARENA.EnterDelay + 1.0;

    SS.radar.revealAround(sec, p.x, p.y, 20);
    SS.msgBig(game.shipsLeft + ' ' + SS.plural(game.shipsLeft, 'hull') + ' left',
      '#ffaa66');
    SS.msg(killer
      ? 'Shot down by ' + SS.anArticle(killer.name) + '. A fresh hull launches.'
      : 'Your hull is lost. A fresh one launches.', '#ffaa66');
    SS.msg('Everything the greens had built is gone with it.', '#ff9a6a');
    SS.save.saveGame();
  }

  game.win = function () {
    if (game.over) return;
    game.over = true;
    game.won = true;
    game.escaped = true;
    game.deathReason = 'warped out with the Prime Flag';
  };

  game.quitRun = function () {
    if (game.over) return;
    game.over = true;
    game.quit = true;
    game.deathReason = 'quit';
  };

  game.computeScore = function () {
    var p = game.player;
    var score = game.points;
    score += 220 * (game.maxDepthReached - 1);
    score += game.greensTaken * 6;
    score += Math.round(p.bounty) * 25;
    if (game.won) score = score * 2 + 25000;
    score *= SS.difficulty().scoreMultiplier;
    return Math.max(0, Math.round(score));
  };

  game.endGame = async function () {
    if (game.ended) return;
    game.ended = true;
    var p = game.player;
    if (!p) return;

    SS.save.deleteSave();
    var score = game.computeScore();
    var lines = [];

    if (game.won) {
      lines.push({ text: '' });
      lines.push({ text: '   You warp out of sector 1 with the Prime Flag aboard.' });
      lines.push({ text: '' });
      lines.push({ text: '   Twenty-six sectors down and twenty-six back up,' });
      lines.push({ text: '   in a ' + SS.ship.def(p).name + ', alone.' });
      lines.push({ text: '' });
    } else if (game.quit) {
      lines.push({ text: '' });
      lines.push({ text: '   You disengaged in sector ' + game.depth + '.' });
      lines.push({ text: '' });
    } else {
      /* a wreck, where a roguelike would put a tombstone */
      var hull = SS.ship.def(p).name;
      lines.push({ text: '' });
      lines.push({ text: '            .    *        .              *        .' });
      lines.push({ text: '                    \\   |   /' });
      lines.push({ text: '        *        --   ' + center(hull.toUpperCase(), 11) + '   --          .' });
      lines.push({ text: '                    /   |   \\' });
      lines.push({ text: '         .                              *' });
      lines.push({ text: '' });
      lines.push({ text: '        ' + center(p.name, 24) });
      lines.push({ text: '        ' + center('sector ' + game.depth, 24) });
      lines.push({ text: '        ' + center(String(new Date().getFullYear()), 24) });
      lines.push({ text: '' });
    }

    lines.push({ text: '  ' + p.name + ' the ' + SS.rankTitle(score) +
      ', flying a ' + SS.ship.def(p).name +
      ' on ' + SS.difficulty().name + '.' });
    lines.push({ text: '  ' + SS.capitalize(game.deathReason || 'lost') +
      ' with ' + SS.commify(score) + ' points, after ' + SS.clockString(game.elapsed) + '.' });
    lines.push({ text: '  Reached sector ' + game.maxDepthReached + ' of ' + SS.MAXDEPTH +
      ', took ' + game.greensTaken + ' greens, and shot down ' + p.kills +
      ' ' + SS.plural(p.kills, 'pilot') + '.' });
    if (p.deaths > 0) {
      lines.push({ text: '  Lost ' + p.deaths + ' ' + SS.plural(p.deaths, 'hull') +
        ' along the way.' });
    }
    lines.push({ text: '' });

    var killList = Object.keys(game.kills);
    if (killList.length) {
      lines.push({ header: true, text: 'Shot down' });
      killList.sort(function (a, b) { return game.kills[b] - game.kills[a]; });
      killList.slice(0, 14).forEach(function (k) {
        var def = SS.enemyByKey(k);
        lines.push({ text: '  ' + padRight(String(game.kills[k]), 5) + (def ? def.name : k) });
      });
      lines.push({ text: '' });
    }

    lines.push({ header: true, text: 'Final hull' });
    SS.commands.readoutLines(p).forEach(function (l) { lines.push(l); });

    SS.save.addScore({
      name: p.name, ship: p.shipKey, score: score, difficulty: game.difficulty,
      depth: game.depth, maxDepth: game.maxDepthReached,
      kills: p.kills, greens: game.greensTaken,
      seconds: Math.round(game.elapsed),
      how: game.deathReason, when: Date.now(), won: !!game.won
    });

    await SS.hud.showText(lines, game.won ? 'You made it out.' : 'Wreckage');
    await game.showScores();
    await SS.main.titleScreen();
  };

  game.showScores = async function () {
    var scores = SS.save.getScores();
    if (!scores.length) return;
    var lines = [{ header: true, text: '  #   Score    Pilot' }];
    scores.slice(0, 15).forEach(function (s, i) {
      lines.push({
        text: '  ' + padRight(String(i + 1), 4) +
          padRight(SS.commify(s.score), 9) +
          s.name + ' the ' + SS.rankTitle(s.score) +
          ', ' + (SS.SHIPS[s.ship] ? SS.SHIPS[s.ship].name : s.ship) +
          (s.difficulty && s.difficulty !== 'normal'
            ? ' [' + SS.difficultyByKey(s.difficulty).name + ']' : '') +
          ' - ' + s.how + ' (sector ' + s.maxDepth + ')'
      });
    });
    await SS.hud.showText(lines, 'Top scores');
  };

  function center(s, width) {
    s = String(s);
    if (s.length > width) s = s.slice(0, width);
    var pad = width - s.length;
    var left = Math.floor(pad / 2);
    return ' '.repeat(left) + s + ' '.repeat(pad - left);
  }

  function padRight(s, n) {
    s = String(s);
    while (s.length < n) s += ' ';
    return s;
  }
  game.padRight = padRight;

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
