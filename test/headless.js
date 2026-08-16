/* 5Space - the test harness.
 *
 *   node test/headless.js              run everything
 *   node test/headless.js 8 gen        run one stage with a smaller budget
 *
 * The game is a set of classic scripts that attach themselves to a global
 * called SS, so Node can load them straight into its own global object with
 * nothing more than a handful of browser stubs.  Anything that touches the
 * DOM does so inside an init function that the tests never call, so the stubs
 * stay tiny and honest.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

/* ---- browser stubs ---------------------------------------------------- */

global.performance = global.performance || { now: () => Date.now() };
global.requestAnimationFrame = () => 0;

const storage = {};
global.localStorage = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; }
};

/* ---- load the game ---------------------------------------------------- */

/* Pulled out of play.html so the two can never drift apart. */
function scriptList() {
  const html = fs.readFileSync(path.join(root, 'play.html'), 'utf8');
  const out = [];
  const re = /<script src="([^"]+)"><\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

const SCRIPTS = scriptList();
SCRIPTS.forEach((src) => {
  const code = fs.readFileSync(path.join(root, src), 'utf8');
  vm.runInThisContext(code, { filename: src });
});

const SS = global.SS;

/* The input stage exercises the real keyboard layer, so grab the genuine
   functions before the stubs below replace them. */
const REAL_INPUT = {
  flight: SS.input.flight,
  firingGun: SS.input.firingGun,
  showingMap: SS.input.showingMap,
  takeActions: SS.input.takeActions,
  clear: SS.input.clear,
  keyDown: SS.input.handleKeyDown,
  keyUp: SS.input.handleKeyUp
};

/* Screens are the only thing the harness has to fake. */
SS.hud.showText = async () => null;
SS.hud.menu = async () => null;
SS.hud.getLine = async () => 'Tester';
SS.hud.yn = async (_p, _c, def) => def || 'n';
SS.hud.isOpen = () => false;
SS.hud.clearMessages = () => {};
SS.hud.drawMessages = () => {};
SS.render.draw = () => {};
SS.render.stepEffects = () => { SS.render.effects.length = 0; };
SS.render.explosion = () => {};
SS.render.flash = () => {};
SS.render.pickup = () => {};
SS.input.flight = () => ({ forward: false, backward: false, left: false, right: false, afterburner: false });
SS.input.firingGun = () => false;
SS.input.takeActions = () => [];
SS.input.showingMap = () => false;
SS.input.clear = () => {};

/* ---- tiny assertion kit ------------------------------------------------ */

let checks = 0;
let failures = [];
let currentStage = '';

function ok(cond, what) {
  checks++;
  if (!cond) failures.push(currentStage + ': ' + what);
}

function eq(a, b, what) {
  ok(a === b, what + ' (got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b) + ')');
}

function within(v, lo, hi, what) {
  ok(v >= lo && v <= hi, what + ' (got ' + v + ', wanted ' + lo + '..' + hi + ')');
}

function stage(name, fn) {
  currentStage = name;
  const t0 = Date.now();
  const before = failures.length;
  fn();
  const bad = failures.length - before;
  const ms = Date.now() - t0;
  console.log('  ' + (bad ? 'FAIL' : 'ok  ') + '  ' + name.padEnd(14) +
    String(ms).padStart(6) + 'ms' + (bad ? '   ' + bad + ' failure(s)' : ''));
}

/* ====================================================================== */
/* stages                                                                 */
/* ====================================================================== */

/* Every generated sector must have a way in, a way on, and no objective
   sealed behind rock.  This is the 5Space equivalent of 5Hack's "every room
   is reachable" check, and it exists for the same reason: a procedural map
   that cannot be finished is the one bug players cannot work around. */
function stageGen(budget) {
  const seeds = budget;
  for (let s = 0; s < seeds; s++) {
    SS.rng.seed(1000 + s);
    SS.ship.resetIds(1);

    const depths = [1, 2, 7, 13, 20, 26];
    for (const depth of depths) {
      const sec = SS.makeSector(depth);

      ok(!!sec.spawn, 'sector ' + depth + ' has a spawn');
      ok(!!sec.portalUp, 'sector ' + depth + ' has an up portal');
      if (depth < SS.MAXDEPTH) {
        ok(!!sec.portalDown, 'sector ' + depth + ' has a down portal');
      } else {
        ok(!!sec.flagStand, 'the Core has a flag stand');
        ok(sec.enemies.some((e) => e.isBoss), 'the Core has its Guardian');
      }

      /* the objective must be reachable from the spawn */
      const target = sec.portalDown || sec.flagStand;
      const reached = SS.floodFrom(sec, Math.floor(sec.spawn.x), Math.floor(sec.spawn.y));
      ok(reached[sec.idx(Math.floor(target.x), Math.floor(target.y))] === 1,
        'seed ' + (1000 + s) + ' sector ' + depth + ': objective reachable from spawn');

      /* a ship must physically fit where it starts and where it arrives */
      ok(!SS.physics.boxHitsSolid(sec, sec.spawn.x, sec.spawn.y, 1.0),
        'sector ' + depth + ': spawn is clear enough for a hull');

      /* every base room must be reachable too, or its greens are decoration */
      let unreachableRooms = 0;
      sec.bases.forEach((b) => {
        b.rooms.forEach((r) => {
          const cx = Math.floor(r.x + r.w / 2), cy = Math.floor(r.y + r.h / 2);
          if (sec.tileAt(cx, cy) !== SS.T.EMPTY) return;
          if (!reached[sec.idx(cx, cy)]) unreachableRooms++;
        });
      });
      eq(unreachableRooms, 0, 'sector ' + depth + ': every base room is reachable');

      ok(sec.greens.length > 20, 'sector ' + depth + ' has greens (' + sec.greens.length + ')');
      ok(sec.enemies.length > 0, 'sector ' + depth + ' has pilots');

      /* nothing may be generated inside solid rock */
      let buried = 0;
      sec.greens.forEach((g) => { if (sec.solidAtPos(g.x, g.y)) buried++; });
      eq(buried, 0, 'sector ' + depth + ': no green is buried in rock');
    }
  }
}

/* Same seed, same universe; different seed, different universe. */
function stageDeterminism() {
  function fingerprint(seed, depth) {
    SS.rng.seed(seed);
    SS.ship.resetIds(1);
    const sec = SS.makeSector(depth);
    let h = 2166136261;
    for (let i = 0; i < sec.tiles.length; i++) {
      h ^= sec.tiles[i];
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) + ':' + sec.greens.length + ':' + sec.enemies.length;
  }

  eq(fingerprint(4242, 5), fingerprint(4242, 5), 'identical seeds make identical sectors');
  ok(fingerprint(4242, 5) !== fingerprint(4243, 5), 'different seeds make different sectors');
  ok(fingerprint(4242, 5) !== fingerprint(4242, 6), 'different depths differ');
}

/* The unit conversions are the load-bearing part of the whole port: get one
   of them wrong and the game is subtly not SubSpace any more. */
function stagePhysics() {
  const p = SS.physics;

  /* MaximumRotation 400 means exactly one revolution per second */
  eq(p.rotationToRev(400), 1, 'rotation 400 = 1 rev/s');
  eq(p.rotationToRev(200), 0.5, 'rotation 200 = half a rev/s');
  /* speed is pixels/second/10, and a tile is 16 pixels, so a top speed of
     4800 is 30 tiles a second - which is as fast as SubSpace really is */
  eq(p.speedToTiles(160), 1, 'speed 160 = 1 tile/s');
  eq(p.speedToTiles(4800), 30, 'speed 4800 = 30 tiles/s');
  /* thrust is scaled by 10/16 into tiles/s^2 */
  eq(p.thrustToAccel(16), 10, 'thrust 16 = 10 tiles/s^2');
  eq(p.rechargeToEnergy(1000), 100, 'recharge 1000 = 100 energy/s');

  /* forty discrete headings, zero pointing up, running clockwise */
  eq(SS.ROTATIONS, 40, 'forty rotations');
  const up = SS.rotationToHeading(0);
  ok(Math.abs(up.x) < 1e-9 && Math.abs(up.y + 1) < 1e-9, 'rotation 0 points up');
  const right = SS.rotationToHeading(10);
  ok(Math.abs(right.x - 1) < 1e-9 && Math.abs(right.y) < 1e-9, 'rotation 10 points right');
  eq(SS.orientToRotation(0.999), 39, 'orientation wraps to the last rotation');
  ok(Math.abs(SS.orientDelta(0.95, 0.05) - 0.1) < 1e-9, 'turn deltas take the short way round');

  /* a body sealed in a box can never leave it, however fast it is thrown */
  SS.rng.seed(77);
  const sec = SS.makeSector(3);
  const spot = SS.randomOpenSpot(sec, {});
  for (let trial = 0; trial < 400; trial++) {
    const body = {
      x: spot.x, y: spot.y,
      vx: SS.rnf(-90, 90), vy: SS.rnf(-90, 90),
      radius: 0.875
    };
    for (let i = 0; i < 200; i++) SS.physics.moveBody(sec, body, SS.TICK_DT);
    ok(!SS.physics.boxHitsSolid(sec, body.x, body.y, body.radius),
      'a fast body never ends up inside rock');
    within(body.x, 0, sec.size, 'body stays in the sector horizontally');
    within(body.y, 0, sec.size, 'body stays in the sector vertically');
  }

  /* bouncing sheds speed at the arena's bounce factor and never gains it */
  const wall = new SS.Sector(1);
  for (let i = 0; i < wall.tiles.length; i++) wall.tiles[i] = SS.T.EMPTY;
  for (let y = 0; y < wall.size; y++) wall.setTile(20, y, SS.T.ROCK);
  const b2 = { x: 10, y: 10, vx: 30, vy: 0, radius: 0.5 };
  const before = Math.abs(b2.vx);
  let reversed = false;
  for (let i = 0; i < 120; i++) {
    SS.physics.moveBody(wall, b2, SS.TICK_DT);
    if (b2.vx < 0) reversed = true;
  }
  ok(Math.abs(b2.vx) < before, 'a bounce loses speed');
  ok(reversed, 'a bounce reverses direction');
  ok(Math.abs(b2.vx) <= before * (SS.ARENA.BounceFactor / 16) + 1e-9,
    'a bounce never returns more speed than the bounce factor allows');

  /* The speed cap must clamp velocity and leave position alone.  A ship
     carries both, so a cap applied to the wrong pair of fields drags the hull
     towards the origin instead of slowing it down - which looks, from the
     outside, exactly like a teleport. */
  const open = new SS.Sector(1);
  const flyer = SS.ship.create('weasel', { team: 'player', x: 200, y: 180 });
  flyer.vx = 500; flyer.vy = -400;
  const thrustInput = { forward: true, backward: false, left: false, right: false, afterburner: false };
  SS.ship.update(flyer, open, thrustInput, SS.TICK_DT);
  const capped = SS.length(flyer.vx, flyer.vy);
  ok(capped <= SS.ship.maxSpeed(flyer) + 1e-6,
    'velocity is clamped to the hull top speed (' + capped.toFixed(2) + ')');
  ok(SS.dist(flyer, { x: 200, y: 180 }) < 1,
    'clamping the speed does not move the ship');

  /* Thrust builds speed up to the ceiling and never past it.  Measure the
     peak rather than the final value: an empty Sector is still bounded by
     rock, and a ship under constant thrust will eventually reach the far side
     and bounce off it. */
  const runner = SS.ship.create('warbird', { team: 'player', x: 128, y: 128 });
  let peak = 0;
  for (let i = 0; i < 100 * 12; i++) {
    SS.ship.update(runner, open, thrustInput, SS.TICK_DT);
    peak = Math.max(peak, SS.length(runner.vx, runner.vy));
  }
  within(peak, SS.ship.maxSpeed(runner) * 0.98, SS.ship.maxSpeed(runner) + 1e-6,
    'sustained thrust reaches the top speed and is capped there');

  /* leading a target: a shot aimed at the lead point arrives where the
     target will be, not where it was */
  const from = { x: 0, y: 0 };
  const to = { x: 20, y: 0 };
  const lead = p.leadTarget(from, to, { x: 0, y: 10 }, 20);
  ok(lead.y > 5, 'a crossing target is led ahead of itself');
  const still = p.leadTarget(from, to, { x: 0, y: 0 }, 20);
  ok(Math.abs(still.y) < 1e-6, 'a stationary target is not led');
}

/* Every prize, on every hull, applied both ways, without an exception and
   without ever pushing a stat outside the hull's own range. */
function stagePrizes() {
  SS.rng.seed(9001);
  const sec = SS.makeSector(4);

  SS.shipList().forEach((key) => {
    const def = SS.SHIPS[key];
    const s = def.settings;

    SS.PRIZES.forEach((prize) => {
      const sh = SS.ship.create(key, { team: 'player', x: 40, y: 40 });
      for (let i = 0; i < 60; i++) {
        SS.ship.applyPrize(sh, prize.id, sec);
      }
      within(sh.stat.recharge, s.InitialRecharge, s.MaximumRecharge, key + '/' + prize.name + ': recharge in range');
      within(sh.stat.energyCap, s.InitialEnergy, s.MaximumEnergy, key + '/' + prize.name + ': energy in range');
      within(sh.stat.rotation, s.InitialRotation, s.MaximumRotation, key + '/' + prize.name + ': rotation in range');
      within(sh.stat.thrust, s.InitialThrust, s.MaximumThrust, key + '/' + prize.name + ': thrust in range');
      within(sh.stat.speed, s.InitialSpeed, s.MaximumSpeed, key + '/' + prize.name + ': speed in range');
      within(sh.guns, s.InitialGuns, s.MaximumGuns, key + '/' + prize.name + ': guns in range');
      within(sh.bombs, Math.min(s.InitialBombs, s.MaximumBombs), Math.max(s.InitialBombs, s.MaximumBombs),
        key + '/' + prize.name + ': bombs in range');
      SS.weapons.UTILITIES.forEach((u) => {
        const cap = SS.ship.capFor(s, u.key);
        within(sh.count[u.key], 0, Math.max(cap, 0), key + '/' + prize.name + ': ' + u.key + ' within cap');
      });

      /* now take it all away again */
      for (let i = 0; i < 60; i++) {
        SS.ship.applyPrize(sh, -prize.id, sec);
      }
      ok(sh.stat.recharge >= s.InitialRecharge, key + '/' + prize.name + ': negatives never go below the factory hull');
      ok(sh.guns >= s.InitialGuns, key + '/' + prize.name + ': guns never fall below the factory hull');
    });

    /* a hull is never offered a prize it cannot mount */
    const table = SS.prizeTableFor(def);
    table.forEach((p) => {
      if (p.requires) ok(!!s[p.requires], key + ' is not offered ' + p.name);
    });
    ok(table.length > 6, key + ' has a usable prize table');
  });

  /* the table sours with depth, but never past the floor */
  ok(SS.negativeFactorFor(1) > SS.negativeFactorFor(26), 'deeper sectors mean more negative greens');
  ok(SS.negativeFactorFor(26) >= 4, 'the negative rate has a floor');
}

/* Every entry in the roster must build, fly and survive a stretch of
   simulation - including the ones that only ever appear at the bottom. */
function stageEnemies(budget) {
  SS.rng.seed(31337);
  const sec = SS.makeSector(18);
  const player = SS.ship.create('warbird', { team: 'player', x: sec.spawn.x, y: sec.spawn.y });

  SS.ENEMIES.forEach((def) => {
    ok(!!SS.SHIPS[def.ship], def.key + ' flies a hull that exists');
    ok(def.difficulty >= 1 && def.difficulty <= SS.MAXDEPTH, def.key + ' has a sane difficulty');
    ok(!!def.name && !!def.note, def.key + ' is described');
    ok(!!SS.PRIZES.length, 'prizes exist');

    const spot = SS.randomOpenSpot(sec, {});
    const e = SS.makeEnemy(def, sec, spot.x, spot.y, 18);
    ok(e.alive, def.key + ' is created alive');
    ok(e.energy > 0, def.key + ' launches with energy');

    /* park the player nearby so the pilot actually engages */
    player.x = e.x + 12;
    player.y = e.y + 6;
    player.alive = true;
    player.energy = SS.ship.energyMax(player);

    const ships = [player, e];
    for (let i = 0; i < budget * 25; i++) {
      SS.updateEnemies(sec, SS.TICK_DT, player, ships, {});
      SS.weapons.update(sec, SS.TICK_DT, ships, {});
      ok(isFinite(e.x) && isFinite(e.y), def.key + ' stays at a finite position');
      if (!isFinite(e.x)) break;
    }
    ok(!SS.physics.boxHitsSolid(sec, e.x, e.y, e.radius), def.key + ' does not end up inside a wall');
    e.alive = false;
  });

  /* the picker respects depth */
  for (let depth = 1; depth <= SS.MAXDEPTH; depth++) {
    for (let i = 0; i < 40; i++) {
      const picked = SS.pickEnemy(depth, {});
      ok(picked.difficulty <= depth + 2, 'depth ' + depth + ' does not spawn something from far below');
      ok(!picked.unique, 'the picker never rolls a unique');
    }
  }
}

/* Fire everything, at least once, and make sure it goes somewhere and stops. */
function stageWeapons() {
  SS.rng.seed(555);
  const sec = SS.makeSector(9);

  SS.shipList().forEach((key) => {
    const spot = SS.randomOpenSpot(sec, {});
    const sh = SS.ship.create(key, { team: 'player', x: spot.x, y: spot.y });
    /* max the hull out so that every weapon it can ever have, it has */
    for (let i = 0; i < 200; i++) {
      SS.ship.applyPrize(sh, Math.abs(SS.rollPrize(SS.SHIPS[key], 0)), sec);
    }
    sh.energy = SS.ship.energyMax(sh) * 100;   // ignore the energy budget here
    const s = SS.ship.settings(sh);

    sec.shots = [];
    ok(SS.weapons.fireBullet(sh, sec), key + ' can fire its guns');
    if (s.MaximumBombs) {
      sh.cd.bomb = 0;
      ok(SS.weapons.fireBomb(sh, sec), key + ' can fire a bomb');
    }
    if (s.MaximumMines && sh.mines > 0) {
      sh.cd.mine = 0;
      ok(SS.weapons.fireMine(sh, sec), key + ' can lay a mine');
    }
    if (s.MaximumBurst) {
      sh.cd.utility = 0; sh.count.burst = 1;
      ok(SS.weapons.fireBurst(sh, sec), key + ' can burst');
      ok(sec.shots.filter((w) => w.type === 'burst').length === SS.ROTATIONS,
        key + ' bursts in every direction');
    }
    if (s.MaximumThor) {
      sh.cd.utility = 0; sh.count.thor = 1;
      ok(SS.weapons.fireThor(sh, sec), key + ' can fire a thor');
    }
    if (s.MaximumRepel) {
      sh.cd.utility = 0; sh.count.repel = 1;
      ok(SS.weapons.useRepel(sh, sec, [sh]), key + ' can repel');
    }
    if (s.MaximumDecoy) {
      sh.cd.utility = 0; sh.count.decoy = 1;
      ok(SS.weapons.useDecoy(sh, sec), key + ' can drop a decoy');
    }
    if (s.MaximumRocket) {
      sh.cd.utility = 0; sh.count.rocket = 1;
      ok(SS.weapons.useRocket(sh), key + ' can light a rocket');
    }
    if (s.MaximumPortal) {
      sh.cd.utility = 0; sh.count.portal = 1;
      eq(SS.weapons.usePortal(sh, sec), 'drop', key + ' can drop a portal');
      sh.cd.utility = 0;
      eq(SS.weapons.usePortal(sh, sec), 'warp', key + ' can warp to its portal');
    }

    /* every shot eventually dies rather than living in the sector forever */
    for (let i = 0; i < 60 * 100; i++) {
      SS.weapons.update(sec, SS.TICK_DT, [sh], {});
      if (!sec.shots.length) break;
    }
    eq(sec.shots.length, 0, key + ': every shot expires');
  });

  /* a bomb at the centre of its blast does full damage, and less further out */
  const target = SS.ship.create('warbird', { team: 'enemy', x: 60, y: 60 });
  const shooter = SS.ship.create('javelin', { team: 'player', x: 60, y: 60 });
  target.energy = 100000;
  sec.shots = [{
    type: 'bomb', x: 60, y: 60, vx: 0, vy: 0, owner: shooter.id, team: 'player',
    level: 1, damage: SS.ARENA.BombDamageLevel, life: 0.001, proximity: false,
    armed: 0, shrapnel: 0
  }];
  const beforeEnergy = target.energy;
  SS.weapons.update(sec, SS.TICK_DT, [shooter, target], {});
  ok(beforeEnergy - target.energy > SS.ARENA.BombDamageLevel * 0.9,
    'a direct bomb hit does nearly full damage');

  /* proximity bombs trigger without touching */
  sec.shots = [{
    type: 'bomb', x: 60, y: 62.5, vx: 0, vy: 0, owner: shooter.id, team: 'player',
    level: 1, damage: 500, life: 5, proximity: true, armed: 0, shrapnel: 0
  }];
  SS.weapons.update(sec, SS.TICK_DT, [shooter, target], {});
  ok(sec.shots.length === 0 || sec.shots[0].proximityTriggered,
    'a proximity bomb triggers at range');
}

/* A run saved and restored must be the same run, down to the tiles. */
function stageSave() {
  SS.rng.seed(2024);
  SS.game.newGame({ name: 'Tester', shipKey: 'lancaster', seed: 2024 });

  /* play a little so there is state worth losing */
  SS.game.changeSector(1);
  SS.game.changeSector(1);
  const p = SS.game.player;
  for (let i = 0; i < 400; i++) SS.ship.applyPrize(p, Math.abs(SS.rollPrize(SS.ship.def(p), 0)), SS.game.sector);
  SS.game.points = 12345;
  SS.game.greensTaken = 67;
  SS.game.prizeLog[SS.P.Guns] = { took: 5, lost: 1 };

  /* The compact packer stores only what a run has changed and rebuilds the
     rest from the roster, so a pilot's *build* is exactly what could silently
     stop surviving the trip.  Fingerprint a few of them. */
  function pilotPrints(sec) {
    return sec.enemies.slice(0, 8).map(function (e) {
      return [e.id, e.enemyKey, Math.round(e.x * 100), Math.round(e.y * 100),
        Math.round(e.energy), Math.round(e.bounty), e.guns, e.bombs, e.mines,
        JSON.stringify(e.stat), JSON.stringify(e.has), JSON.stringify(e.count),
        e.alive, !!e.isBoss, e.ai, e.isTurret, e.skill].join('|');
    }).join(' // ');
  }

  const before = {
    depth: SS.game.depth,
    sectors: Object.keys(SS.game.sectors).length,
    pilots: pilotPrints(SS.game.sector),
    guns: p.guns,
    recharge: p.stat.recharge,
    counts: JSON.stringify(p.count),
    has: JSON.stringify(p.has),
    points: SS.game.points,
    rng: SS.rng.getState().join(','),
    tiles: hashTiles(SS.game.sector),
    explored: hashBytes(SS.game.sector.explored),
    greens: SS.game.sector.greens.length,
    enemies: SS.game.sector.enemies.length,
    guarded: SS.game.sector.enemies.filter((e) => e.guardsBase).length
  };

  ok(SS.save.saveGame(), 'the run saves');
  const blob = global.localStorage.getItem('5space.save.v1');
  ok(blob.length > 0, 'the save is not empty');
  /* RLE has to earn its place: a raw dump of three sectors would be ~200KB
     of tiles alone before base64 */
  ok(blob.length < 900 * 1024, 'the save fits in localStorage (' +
    Math.round(blob.length / 1024) + 'KB for ' + before.sectors + ' sectors)');

  /* wipe everything, then bring it back */
  SS.game.sectors = {};
  SS.game.sector = null;
  SS.game.player = null;
  ok(SS.save.loadGame(), 'the run loads');

  const after = SS.game;
  eq(after.depth, before.depth, 'depth survives');
  eq(Object.keys(after.sectors).length, before.sectors, 'every sector survives');
  eq(after.player.guns, before.guns, 'gun level survives');
  eq(after.player.stat.recharge, before.recharge, 'recharge survives');
  eq(JSON.stringify(after.player.count), before.counts, 'utility stock survives');
  eq(JSON.stringify(after.player.has), before.has, 'abilities survive');
  eq(after.points, before.points, 'points survive');
  eq(SS.rng.getState().join(','), before.rng, 'the random stream survives');
  eq(hashTiles(after.sector), before.tiles, 'the tile map survives the RLE round trip');
  eq(hashBytes(after.sector.explored), before.explored, 'radar memory survives');
  eq(after.sector.greens.length, before.greens, 'greens survive');
  eq(after.sector.enemies.length, before.enemies, 'pilots survive');
  eq(pilotPrints(after.sector), before.pilots,
    'each pilot comes back with the same hull, build, stock and position');
  eq(after.sector.enemies.filter((e) => e.guardsBase).length, before.guarded,
    'base-guarding pilots are relinked to their base');
  after.sector.enemies.filter((e) => e.guardsBase).forEach((e) => {
    ok(after.sector.bases.indexOf(e.guardsBase) >= 0,
      'a relinked base is the sector\'s own object, not a copy');
  });

  /* the sector must still be playable after the trip */
  ok(!SS.physics.boxHitsSolid(after.sector, after.player.x, after.player.y, after.player.radius),
    'the player is not restored inside a wall');

  /* A finished run holds all twenty-six sectors, and that is the size that
     actually has to fit.  localStorage is nominally 5MB but several browsers
     count it in UTF-16 code units, so the real budget is nearer half that -
     which is why greens are tuples and pilots store only what changed. */
  SS.rng.seed(31);
  SS.game.newGame({ name: 'Full', shipKey: 'terrier', seed: 31 });
  for (let d = 1; d < SS.MAXDEPTH; d++) {
    const s = SS.game.sector;
    SS.game.player.x = s.portalDown.x;
    SS.game.player.y = s.portalDown.y;
    SS.game.player.timer.spawnGuard = 0;
    SS.game.step(SS.TICK_DT);
  }
  eq(Object.keys(SS.game.sectors).length, SS.MAXDEPTH, 'a full run holds every sector');
  ok(SS.save.saveGame(), 'a full run saves');
  const fullKB = global.localStorage.getItem('5space.save.v1').length / 1024;
  ok(fullKB < 1200, 'a completed run fits in localStorage (' + Math.round(fullKB) +
    'KB for ' + SS.MAXDEPTH + ' sectors)');
  ok(SS.save.loadGame(), 'a full run loads');
  eq(Object.keys(SS.game.sectors).length, SS.MAXDEPTH, 'every sector comes back');
  SS.game.over = true; SS.game.ended = true;

  /* RLE on its own, with the awkward cases */
  const cases = [
    new Uint8Array(0),
    new Uint8Array([0]),
    new Uint8Array([1, 1, 1, 2, 2, 3]),
    (() => { const a = new Uint8Array(70000); a.fill(7); return a; })(),
    (() => { const a = new Uint8Array(1000); for (let i = 0; i < 1000; i++) a[i] = i % 251; return a; })()
  ];
  cases.forEach((src, i) => {
    const rt = SS.rleDecode(SS.rleEncode(src), src.length);
    let same = rt.length === src.length;
    for (let k = 0; same && k < src.length; k++) same = rt[k] === src[k];
    ok(same, 'RLE round trip case ' + i + ' (length ' + src.length + ')');
  });
}

function hashTiles(sec) {
  return hashBytes(sec.tiles) + ':' + hashBytes(sec.doorGroup);
}

function hashBytes(arr) {
  let h = 2166136261;
  for (let i = 0; i < arr.length; i++) {
    h ^= arr[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/* Fly the whole chain: down to the Core, take the Flag, back up, and out.
   The pilot here is a cheat - it steps onto each portal rather than flying to
   it - because what this stage is testing is the progression chain, not the
   flight model.  stagePlay does the flying. */
function stageDescent() {
  SS.rng.seed(4711);
  SS.game.newGame({ name: 'Diver', shipKey: 'terrier', seed: 4711 });

  for (let depth = 1; depth < SS.MAXDEPTH; depth++) {
    eq(SS.game.depth, depth, 'diving: arrived in sector ' + depth);
    const sec = SS.game.sector;
    ok(!!sec.portalDown, 'sector ' + depth + ' has a way down');
    SS.game.player.x = sec.portalDown.x;
    SS.game.player.y = sec.portalDown.y;
    SS.game.player.timer.spawnGuard = 0;
    SS.game.step(SS.TICK_DT);
  }

  eq(SS.game.depth, SS.MAXDEPTH, 'reached the Core');
  const core = SS.game.sector;
  ok(!!core.flagStand, 'the Core has the flag stand');

  SS.game.player.x = core.flagStand.x;
  SS.game.player.y = core.flagStand.y;
  SS.game.player.timer.spawnGuard = 0;
  SS.game.step(SS.TICK_DT);
  ok(SS.game.player.hasFlag, 'the Prime Flag can be taken');
  ok(SS.game.flagTaken, 'the Flag is recorded as taken');

  for (let depth = SS.MAXDEPTH; depth > 1; depth--) {
    eq(SS.game.depth, depth, 'climbing: in sector ' + depth);
    const sec = SS.game.sector;
    ok(!!sec.portalUp, 'sector ' + depth + ' has a way up');
    SS.game.player.x = sec.portalUp.x;
    SS.game.player.y = sec.portalUp.y;
    SS.game.player.timer.spawnGuard = 0;
    SS.game.player.alive = true;
    SS.game.player.energy = SS.ship.energyMax(SS.game.player);
    SS.game.step(SS.TICK_DT);
  }

  eq(SS.game.depth, 1, 'climbed back to sector 1');
  SS.game.player.x = SS.game.sector.portalUp.x;
  SS.game.player.y = SS.game.sector.portalUp.y;
  SS.game.player.timer.spawnGuard = 0;
  SS.game.step(SS.TICK_DT);

  ok(SS.game.over, 'the run ends');
  ok(SS.game.won, 'carrying the Flag out of sector 1 wins');
  ok(SS.game.computeScore() > 25000, 'winning scores well');
  SS.game.ended = true;      // do not let the async endgame screen run
}

/* Thousands of ticks of randomised input, looking for an exception, a NaN, or
   a ship that has escaped the map. */
function stagePlay(budget) {
  for (let run = 0; run < budget; run++) {
    const key = SS.shipList()[run % 8];
    SS.rng.seed(80000 + run);
    SS.game.newGame({ name: 'Fuzz', shipKey: key, seed: 80000 + run });

    let flight = { forward: false, backward: false, left: false, right: false, afterburner: false };
    let firing = false;
    let actions = [];
    SS.input.flight = () => flight;
    SS.input.firingGun = () => firing;
    SS.input.takeActions = () => { const a = actions; actions = []; return a; };

    const ACTIONS = ['bomb', 'mine', 'burst', 'repel', 'decoy', 'thor', 'brick',
      'rocket', 'portal', 'warp', 'multifire', 'cloak', 'stealth', 'xradar', 'antiwarp'];

    const p = SS.game.player;
    let died = false;

    for (let i = 0; i < 3000; i++) {
      if (SS.rn2(12) === 0) {
        flight = {
          forward: SS.rn2(2) === 0, backward: SS.rn2(6) === 0,
          left: SS.rn2(3) === 0, right: SS.rn2(3) === 0,
          afterburner: SS.rn2(5) === 0
        };
        firing = SS.rn2(3) === 0;
      }
      if (SS.rn2(40) === 0) actions.push(SS.pick(ACTIONS));

      try {
        SS.game.step(SS.TICK_DT);
      } catch (err) {
        ok(false, 'run ' + run + ' (' + key + ') threw at tick ' + i + ': ' + err.message);
        console.error(err);
        break;
      }

      /* the harness drives handleActions by hand, since it is inside frame() */
      actions = [];

      ok(isFinite(p.x) && isFinite(p.y) && isFinite(p.vx) && isFinite(p.vy),
        'run ' + run + ': the player stays finite');
      if (!isFinite(p.x)) break;
      within(p.x, 0, SS.game.sector.size, 'run ' + run + ': player stays in the sector (x)');
      within(p.y, 0, SS.game.sector.size, 'run ' + run + ': player stays in the sector (y)');
      ok(p.energy >= 0, 'run ' + run + ': energy never goes negative');
      ok(p.energy <= SS.ship.energyMax(p) + 1e-6, 'run ' + run + ': energy never exceeds the cap');
      ok(SS.game.sector.shots.length < 4000, 'run ' + run + ': shots do not accumulate without bound');

      if (SS.game.over) { died = true; break; }
    }

    /* the fuzzer should be dying sometimes and surviving sometimes; a run
       that can neither die nor live means something is wired wrong */
    if (!died) {
      ok(p.alive, 'run ' + run + ': a surviving player is alive');
    }
    SS.game.ended = true;
    SS.game.over = true;
  }

  /* put the stubs back for any later stage */
  SS.input.flight = () => ({ forward: false, backward: false, left: false, right: false, afterburner: false });
  SS.input.firingGun = () => false;
  SS.input.takeActions = () => [];
}

/* The flight model has to be good enough that a simple pilot can actually
   get somewhere - if steering cannot close a gap, neither the AI nor a human
   is going to enjoy it. */
function stagePilot() {
  SS.rng.seed(606);
  SS.game.newGame({ name: 'Pilot', shipKey: 'spider', seed: 606 });
  const p = SS.game.player;
  const sec = SS.game.sector;
  const goal = sec.portalDown;
  const startDist = SS.dist(p, goal);

  let flight = { forward: false, backward: false, left: false, right: false, afterburner: false };
  SS.input.flight = () => flight;

  let best = startDist;
  for (let i = 0; i < 100 * 120; i++) {      // two minutes of flight
    const dx = goal.x - p.x, dy = goal.y - p.y;
    const want = SS.headingToOrient(dx, dy);
    const delta = SS.orientDelta(p.orient, want);
    flight = {
      forward: Math.abs(delta) < 0.1,
      backward: false,
      left: delta < -0.004,
      right: delta > 0.004,
      afterburner: false
    };
    SS.game.step(SS.TICK_DT);
    best = Math.min(best, SS.dist(p, goal));
    if (SS.game.depth !== 1 || SS.game.over) break;
  }

  ok(SS.game.depth === 2 || best < startDist * 0.35,
    'a naive pilot can steer most of the way to the portal (' +
    Math.round(startDist) + ' -> ' + Math.round(best) + ' tiles)');

  SS.input.flight = () => ({ forward: false, backward: false, left: false, right: false, afterburner: false });
  SS.game.over = true;
  SS.game.ended = true;
}

/* Difficulty is a property of the code, so it can regress like any other, and
   in a real-time game with permadeath it regresses *silently* - nothing throws
   when sector 1 quietly becomes unsurvivable.

   So: fly a deliberately mediocre autopilot and assert the shape of the
   curve.  It collects greens, shoots when it has a firing solution, and runs
   when it is low.  It does not dodge, use utilities, or retreat to a safe
   pad, so it should do considerably worse than a person - which makes it a
   floor, not a target.  The assertions are loose on purpose; they are there
   to catch "sector 1 now kills you in twenty seconds", not to pin a number. */
function stageBalance(budget) {
  var runs = Math.max(5, Math.min(24, budget * 2));

  function fly(depth, seed, limitSeconds) {
    SS.rng.seed(seed);
    SS.game.newGame({ name: 'Autopilot', shipKey: 'warbird', seed: seed });
    const g = SS.game;
    for (let d = 1; d < depth; d++) {
      const s = g.sector;
      g.player.x = s.portalDown.x; g.player.y = s.portalDown.y;
      g.player.timer.spawnGuard = 0;
      g.step(SS.TICK_DT);
    }
    const p = g.player;
    /* a build in keeping with how far down it has come */
    for (let i = 0; i < depth * 2; i++) {
      SS.ship.applyPrize(p, Math.abs(SS.rollPrize(SS.ship.def(p), 0)), g.sector);
    }
    p.energy = SS.ship.energyMax(p);

    let flight = { forward: false, backward: false, left: false, right: false, afterburner: false };
    let firing = false;
    SS.input.flight = () => flight;
    SS.input.firingGun = () => firing;

    function steer(tx, ty, ab) {
      const want = SS.headingToOrient(tx - p.x, ty - p.y);
      const d = SS.orientDelta(p.orient, want);
      flight = {
        left: d < -0.004, right: d > 0.004,
        forward: Math.abs(d) < 0.12, backward: false, afterburner: !!ab
      };
    }

    let t = 0;
    for (; t < 100 * limitSeconds && !g.over; t++) {
      const sec = g.sector;
      let foe = null, fd = Infinity;
      sec.enemies.forEach((e) => {
        if (!e.alive) return;
        const d = SS.dist(p, e);
        if (d < fd) { fd = d; foe = e; }
      });
      const frac = p.energy / SS.ship.energyMax(p);
      firing = false;

      if (frac < 0.4 && foe && fd < 40) {
        steer(p.x * 2 - foe.x, p.y * 2 - foe.y, true);
      } else if (foe && fd < 20 && frac > 0.45) {
        steer(foe.x, foe.y);
        const aim = SS.headingToOrient(foe.x - p.x, foe.y - p.y);
        const tol = Math.atan2((foe.radius || 0.9) + 0.35, Math.max(1.5, fd)) / (Math.PI * 2);
        firing = Math.abs(SS.orientDelta(SS.firedOrient(p.orient), aim)) <= tol;
      } else {
        let green = null, gd = Infinity;
        sec.greens.forEach((q) => {
          if (q.taken && sec.clock - q.taken < SS.ARENA.PrizeDelay) return;
          const d = SS.dist(p, q);
          if (d < gd) { gd = d; green = q; }
        });
        if (green) steer(green.x, green.y);
      }
      g.step(SS.TICK_DT);
    }

    const out = { seconds: t / 100, greens: g.greensTaken, kills: p.kills, died: g.over };
    g.over = true; g.ended = true;
    return out;
  }

  /* Survival time is strongly *bimodal*: the autopilot either walks into
     something early or settles into a loop and rides out the whole window.
     That makes the median useless here - it jumps between the two humps
     depending on how many seeds you happen to sample, which is a flaky test
     rather than a real signal.

     The two things that hold steady at every sample size are the lower
     quartile (how bad an unlucky run is) and the number of greens collected
     (a pilot under fire is not picking anything up).  Those are what get
     asserted. */
  function survey(depth, limitSeconds) {
    const times = [];
    let greens = 0, survivors = 0;
    for (let s = 0; s < runs; s++) {
      const r = fly(depth, 7000 + s * 13, limitSeconds);
      times.push(r.seconds);
      greens += r.greens;
      if (!r.died) survivors++;
    }
    times.sort((a, b) => a - b);
    const at = (f) => times[Math.min(times.length - 1, Math.floor(times.length * f))];
    return {
      p25: at(0.25),
      median: at(0.5),
      greens: greens / runs,
      survivors: survivors
    };
  }

  const WINDOW = 180;
  const first = survey(1, WINDOW);
  const deep = survey(18, WINDOW);

  /* Sector 1 is the tutorial whether it is labelled one or not: even the
     unlucky quarter of runs must get long enough to learn the controls. */
  ok(first.p25 > 25,
    'sector 1 gives even an unlucky pilot time to learn (lower quartile ' +
    first.p25.toFixed(0) + 's of a ' + WINDOW + 's window)');
  ok(first.greens > 20,
    'sector 1 is worth farming (' + first.greens.toFixed(0) + ' greens avg)');
  ok(first.survivors > 0,
    'sector 1 is survivable at all (' + first.survivors + '/' + runs + ' ran the window out)');

  /* The deep end must still be dangerous, or there is no run to speak of. */
  ok(deep.greens < first.greens * 0.6,
    'sector 18 leaves far less room to farm (' + deep.greens.toFixed(0) +
    ' greens vs ' + first.greens.toFixed(0) + ')');
  ok(deep.p25 < first.p25,
    'an unlucky run ends sooner at sector 18 than at sector 1 (' +
    deep.p25.toFixed(0) + 's vs ' + first.p25.toFixed(0) + 's)');
  ok(deep.p25 > 4,
    'sector 18 is not instant death (lower quartile ' + deep.p25.toFixed(0) + 's)');

  SS.input.flight = () => ({ forward: false, backward: false, left: false, right: false, afterburner: false });
  SS.input.firingGun = () => false;
}

/* Difficulty.
 *
 * The load-bearing requirement is not that Easy is easier - it is that
 * Normal is *unchanged*.  Every multiplier is 1 on Normal and every one is
 * applied after the random draw it scales, so a Normal run generates exactly
 * the universe it generated before difficulty existed.  Getting that wrong
 * is silent: sectors would still be valid, just different, and only a
 * fingerprint catches it. */
function stageDifficulty(budget) {
  /* ---- Normal is the identity ----------------------------------------- */

  const normal = SS.DIFFICULTIES.normal;
  ['enemies', 'enemyPrizes', 'enemySkill', 'greens', 'negativeGreens',
    'reinforcements', 'scoreMultiplier'].forEach(function (k) {
    eq(normal[k], 1, 'Normal leaves ' + k + ' alone');
  });
  eq(normal.ships, 1, 'Normal is one hull, permadeath');
  ok(SS.DIFFICULTIES.easy.ships > 1, 'Easy flies a wing of hulls');
  SS.DIFFICULTY_ORDER.forEach(function (k) {
    const d = SS.DIFFICULTIES[k];
    ok(!!d && !!d.name && !!d.blurb && !!d.code, k + ' is described and has a hotkey');
  });

  /* The same seed must build the same sector on Normal whether or not a
     previous run left another mode selected. */
  function fingerprint(seed, depth, mode) {
    SS.game.difficulty = mode;
    SS.rng.seed(seed);
    SS.ship.resetIds(1);
    const sec = SS.makeSector(depth);
    let h = 2166136261;
    for (let i = 0; i < sec.tiles.length; i++) { h ^= sec.tiles[i]; h = Math.imul(h, 16777619); }
    return {
      key: (h >>> 0).toString(16) + ':' + sec.greens.length + ':' + sec.enemies.length,
      greens: sec.greens.length,
      pilots: sec.enemies.length,
      /* per pilot, not summed: Easy fields more of them, so a total would
         rise even as each one got weaker */
      build: sec.enemies.reduce((a, e) => a + e.guns + e.bombs, 0) /
        Math.max(1, sec.enemies.length),
      skill: sec.enemies.reduce((a, e) => a + e.skill, 0) / Math.max(1, sec.enemies.length)
    };
  }

  const seeds = [1, 7, 42, 1234];
  const depths = [1, 5, 13, 26];
  seeds.forEach(function (seed) {
    depths.forEach(function (depth) {
      const a = fingerprint(seed, depth, 'normal');
      SS.game.difficulty = 'easy';
      fingerprint(seed, depth, 'easy');            // dirty the state in between
      const b = fingerprint(seed, depth, 'normal');
      eq(b.key, a.key,
        'seed ' + seed + ' sector ' + depth + ': Normal is unaffected by the other mode');
    });
  });

  /* ---- Easy is measurably gentler on every lever ---------------------- */

  /* Easy is gentler per pilot, not thinner on pilots.  A sector with a
     handful of enemies scattered over 256 tiles is empty rather than easy:
     a beginner needs something to practise on early and often, so the count
     goes *up* in the shallows and the threat per pilot goes down. */
  let moreGreens = 0, softerPilots = 0;
  let crowdedShallow = 0, shallowCells = 0;
  let buildEasy = 0, buildNormal = 0;
  seeds.forEach(function (seed) {
    depths.forEach(function (depth) {
      const n = fingerprint(seed, depth, 'normal');
      const e = fingerprint(seed, depth, 'easy');
      if (e.greens > n.greens) moreGreens++;
      if (e.skill < n.skill) softerPilots++;
      buildEasy += e.build;
      buildNormal += n.build;
      if (depth <= 5) {
        shallowCells++;
        if (e.pilots > n.pilots) crowdedShallow++;
      }
    });
  });
  const cells = seeds.length * depths.length;
  ok(moreGreens === cells, 'Easy sectors hold more greens (' + moreGreens + '/' + cells + ')');
  ok(softerPilots >= cells - 1, 'Easy pilots are less skilled (' + softerPilots + '/' + cells + ')');
  ok(crowdedShallow === shallowCells,
    'Easy shallows hold more pilots to practise on (' + crowdedShallow + '/' + shallowCells + ')');

  /* Compared in aggregate rather than sector by sector: a different mode
     draws a different mix of hull types, so any single sector can skew.  The
     mean across the whole sample is what the multiplier actually promises. */
  ok(buildEasy < buildNormal,
    'Easy pilots are less well built on average (' + (buildEasy / cells).toFixed(2) +
    ' vs ' + (buildNormal / cells).toFixed(2) + ' weapon levels per pilot)');

  /* ...and the crowd thins as you descend, or "plenty to shoot at" turns
     into a wall of fire. */
  SS.game.difficulty = 'easy';
  const shallowMult = SS.diff('enemies', 1);
  const deepMult = SS.diff('enemies', SS.MAXDEPTH);
  ok(shallowMult > 1, 'Easy sector 1 is busier than Normal (x' + shallowMult.toFixed(2) + ')');
  ok(deepMult < shallowMult,
    'the crowd thins with depth (x' + shallowMult.toFixed(2) + ' -> x' + deepMult.toFixed(2) + ')');
  ok(SS.diff('spawnDistance', 1) < SS.diff('spawnDistance', SS.MAXDEPTH),
    'and starts closer to you in the shallows');
  ok(SS.diff('enemyDetect', 1) < 1,
    'Easy pilots notice you from closer, so a crowd arrives as a queue');
  SS.game.difficulty = 'normal';
  eq(SS.diff('enemies', 1), 1, 'Normal takes the plain value from a depth-aware lever');
  eq(SS.diff('enemies', SS.MAXDEPTH), 1, 'at every depth');

  /* A pilot should actually be within reach of where you arrive. */
  function nearestPilotToSpawn(seed, depth, mode) {
    SS.game.difficulty = mode;
    SS.rng.seed(seed);
    SS.ship.resetIds(1);
    const sec = SS.makeSector(depth);
    let best = Infinity;
    sec.enemies.forEach(function (e) {
      const d = SS.dist(sec.spawn, e);
      if (d < best) best = d;
    });
    return best;
  }
  let closer = 0;
  seeds.forEach(function (seed) {
    if (nearestPilotToSpawn(seed, 1, 'easy') < nearestPilotToSpawn(seed, 1, 'normal')) closer++;
  });
  ok(closer >= seeds.length - 1,
    'on Easy the first fight is closer to where you launch (' + closer + '/' + seeds.length + ')');
  SS.game.difficulty = 'normal';

  SS.game.difficulty = 'easy';
  ok(SS.negativeFactorFor(20) > (function () {
    SS.game.difficulty = 'normal';
    const v = SS.negativeFactorFor(20);
    SS.game.difficulty = 'easy';
    return v;
  })(), 'Easy meets fewer negative greens');
  SS.game.difficulty = 'normal';

  /* ---- Easy: enemies take half the damage to destroy ------------------ */

  /* Measured on the same pilot with the same energy in both modes, so the
     only thing that can differ is what a shot does. */
  /* Both ships sit at the centre of the sector: anywhere outside its bounds
     counts as solid, and a shot placed there is stopped by "rock" before it
     can hit anything - which would make every measurement here a silent zero. */
  function damageAbsorbed(mode, team) {
    SS.game.difficulty = mode;
    SS.rng.seed(4242);
    const world = new SS.Sector(8);
    const mid = world.size / 2;
    const shooter = SS.ship.create('warbird', { team: 'player', x: mid, y: mid });
    const target = SS.makeEnemy(SS.enemyByKey('corsair'), world, mid, mid, 8);
    const victim = team === 'player' ? shooter : target;
    victim.energy = 100000;
    victim.stat.energyCap = 100000;
    const before = victim.energy;
    world.shots = [{
      type: 'bullet', x: victim.x, y: victim.y, vx: 0, vy: 0,
      owner: team === 'player' ? target.id : shooter.id,
      team: team === 'player' ? 'enemy' : 'player',
      level: 1, damage: SS.ARENA.BulletDamageLevel, life: 1, bouncing: false
    }];
    SS.weapons.update(world, SS.TICK_DT, [shooter, target], {});
    return before - victim.energy;
  }

  const hitNormal = damageAbsorbed('normal', 'enemy');
  const hitEasy = damageAbsorbed('easy', 'enemy');
  eq(hitNormal, SS.ARENA.BulletDamageLevel,
    'on Normal a bullet does exactly its rated damage to a pilot');
  eq(hitEasy, hitNormal * 2,
    'on Easy your shots count double, so a pilot takes half the damage to destroy (' +
    hitEasy + ' vs ' + hitNormal + ')');

  /* It is a lever on *your* shots, not a global softening: what the enemy
     does to you is identical in both modes.  Asserted as a real number first,
     because two zeroes would satisfy an equality and prove nothing. */
  const takenNormal = damageAbsorbed('normal', 'player');
  const takenEasy = damageAbsorbed('easy', 'player');
  eq(takenNormal, SS.ARENA.BulletDamageLevel,
    'enemy fire actually reaches the player in this measurement');
  eq(takenEasy, takenNormal,
    'Easy does not change what enemy fire does to you (' + takenEasy + ')');

  eq(SS.difficultyByKey('normal').damageToEnemies, 1,
    'Normal leaves damage alone');
  SS.game.difficulty = 'normal';

  /* ---- losing a hull -------------------------------------------------- */

  const idle = () => ({ forward: false, backward: false, left: false, right: false, afterburner: false });
  SS.input.flight = idle;
  SS.input.firingGun = () => false;
  SS.input.takeActions = () => [];

  SS.rng.seed(515);
  SS.game.newGame({ name: 'Wing', shipKey: 'warbird', seed: 515, difficulty: 'easy' });
  let g = SS.game;
  eq(g.shipsLeft, SS.DIFFICULTIES.easy.ships, 'an Easy run launches with a full wing');

  /* build the hull up, then lose it */
  for (let i = 0; i < 30; i++) {
    SS.ship.applyPrize(g.player, Math.abs(SS.rollPrize(SS.ship.def(g.player), 0)), g.sector);
  }
  const built = g.player.stat.recharge;
  const factory = SS.ship.settings(g.player).InitialRecharge;
  ok(built > factory, 'the hull was actually built up before it died');

  g.player.energy = 0;
  g.player.alive = false;
  g.death(null);

  ok(!g.over, 'losing a hull with spares does not end the run');
  ok(g.player.alive, 'a fresh hull launches');
  eq(g.shipsLeft, SS.DIFFICULTIES.easy.ships - 1, 'the wing is one hull down');
  eq(g.player.stat.recharge, factory, 'the fresh hull is back to factory settings');
  eq(g.player.guns, SS.ship.settings(g.player).InitialGuns, 'and factory guns');
  eq(g.player.deaths, 1, 'the loss is recorded');
  ok(!SS.physics.boxHitsSolid(g.sector, g.player.x, g.player.y, g.player.radius),
    'the fresh hull launches somewhere it fits');
  ok(g.player.timer.spawnGuard > 0, 'and is briefly untouchable');

  /* the Flag goes home rather than respawning with you */
  g.player.hasFlag = true;
  g.flagTaken = true;
  g.player.alive = false;
  g.death(null);
  ok(!g.player.hasFlag, 'losing a hull drops the Prime Flag');
  ok(!g.flagTaken, 'and the Flag returns to the Core to be taken again');

  /* run the wing out */
  let guard = 0;
  while (!g.over && guard++ < 20) {
    g.player.alive = false;
    g.death(null);
  }
  ok(g.over, 'the run ends when the last hull is gone');
  eq(g.shipsLeft, 0, 'no hulls remain');
  g.ended = true;

  /* Normal has no spare hulls at all. */
  SS.rng.seed(516);
  SS.game.newGame({ name: 'Solo', shipKey: 'warbird', seed: 516, difficulty: 'normal' });
  g = SS.game;
  eq(g.shipsLeft, 1, 'a Normal run has a single hull');
  g.player.alive = false;
  g.death(null);
  ok(g.over, 'Normal still ends on the first death');
  g.ended = true;

  /* ---- score, and the save --------------------------------------------- */

  SS.rng.seed(517);
  SS.game.newGame({ name: 'Score', shipKey: 'spider', seed: 517, difficulty: 'easy' });
  g = SS.game;
  g.points = 10000;
  g.maxDepthReached = 10;
  const easyScore = g.computeScore();
  g.difficulty = 'normal';
  const normalScore = g.computeScore();
  ok(easyScore < normalScore,
    'an Easy run scores less for the same run (' + easyScore + ' vs ' + normalScore + ')');
  g.difficulty = 'easy';

  g.shipsLeft = 3;
  ok(SS.save.saveGame(), 'an Easy run saves');
  g.difficulty = 'normal';
  g.shipsLeft = 1;
  ok(SS.save.loadGame(), 'and loads');
  eq(SS.game.difficulty, 'easy', 'the mode survives the round trip');
  eq(SS.game.shipsLeft, 3, 'and so does the number of hulls left');
  const info = SS.save.saveInfo();
  eq(info.difficulty, 'easy', 'the title screen can see which mode a save is');
  eq(info.shipsLeft, 3, 'and how many hulls it has left');
  SS.game.over = true; SS.game.ended = true;
  SS.game.difficulty = 'normal';

  SS.input.flight = idle;
  SS.input.firingGun = () => false;
}

/* Wormholes.
 *
 * This stage exists because of a bug that shipped: a wormhole's destination
 * was the exact centre of another wormhole, so a ship that flew into one was
 * thrown into the mouth of the next, pinned there by a pull no hull can
 * out-thrust, and thrown back again when the re-entry timer expired.  Thirty
 * eight teleports in thirty seconds, forever.
 *
 * The invariant that makes that impossible is simple and worth stating: a
 * ship is never *placed* anywhere it cannot leave under its own power. */
function stageWormholes(budget) {
  const seeds = Math.max(8, budget * 3);

  /* ---- destinations are outside every well --------------------------- */

  let holes = 0, worst = Infinity, inTrap = 0;
  for (let s = 0; s < seeds; s++) {
    SS.rng.seed(6100 + s);
    SS.ship.resetIds(1);
    [1, 9, 19, 26].forEach((depth) => {
      const sec = SS.makeSector(depth);
      sec.wormholes.forEach((w) => {
        holes++;
        ok(!!w.dest, 'every wormhole has a destination');
        if (!w.dest) return;
        const gap = SS.distanceToNearestWormhole(sec, w.dest);
        if (gap < worst) worst = gap;
        if (gap < SS.WORMHOLE_ESCAPE) inTrap++;
        ok(!sec.solidAtPos(w.dest.x, w.dest.y),
          'a wormhole destination is in open space');
      });
    });
  }
  ok(holes > 10, 'the sample actually contained wormholes (' + holes + ')');
  eq(inTrap, 0, 'no destination lands inside a well a ship cannot escape');
  ok(worst >= SS.WORMHOLE_ESCAPE,
    'the closest destination to a well is ' + worst.toFixed(1) +
    ' tiles (escape threshold ' + SS.WORMHOLE_ESCAPE + ')');

  /* ---- the helper that places ships refuses to drop them in a well ---- */

  SS.rng.seed(6001);
  const sec = firstSectorWithWormholes(1);
  ok(!!sec, 'found a sector with a wormhole to test against');
  if (sec) {
    let unsafe = 0;
    for (let i = 0; i < 300; i++) {
      const spot = SS.randomOpenSpot(sec, {});
      if (SS.distanceToNearestWormhole(sec, spot) < SS.WORMHOLE_ESCAPE) unsafe++;
    }
    eq(unsafe, 0, 'randomOpenSpot never places a ship inside a well by default');

    /* and the opt-out still works, or wormholeDestination could not rank */
    let sawClose = false;
    for (let i = 0; i < 400 && !sawClose; i++) {
      const spot = SS.randomOpenSpot(sec, { minWormholeDist: 0 });
      if (SS.distanceToNearestWormhole(sec, spot) < SS.WORMHOLE_ESCAPE) sawClose = true;
    }
    ok(sawClose, 'minWormholeDist:0 opts out of the wormhole check');
  }

  /* ---- the loop itself ------------------------------------------------ */

  const idle = () => ({ forward: false, backward: false, left: false, right: false, afterburner: false });
  SS.input.flight = idle;
  SS.input.firingGun = () => false;
  SS.input.takeActions = () => [];

  const seed = seedWithWormholes(2);
  ok(seed > 0, 'found a sector with two or more wormholes');
  if (seed > 0) {
    const g = SS.game;
    const p = g.player;
    const world = g.sector;
    p.x = world.wormholes[0].x;
    p.y = world.wormholes[0].y;
    p.vx = 0; p.vy = 0;
    p.timer.spawnGuard = 0;
    p.inWormhole = false;

    let transits = 0;
    const realMsg = SS.msg;
    SS.msg = (t) => { if (/wormhole/i.test(t)) transits++; };
    for (let i = 0; i < 100 * 60 && !g.over; i++) g.step(SS.TICK_DT);
    SS.msg = realMsg;

    ok(transits >= 1, 'a wormhole does still take a ship that flies into it');
    ok(transits <= 3,
      'sitting in a wormhole does not teleport you over and over (' +
      transits + ' transits in 60s; the bug produced 38 in 30s)');
    ok(SS.distanceToNearestWormhole(world, p) > SS.WORMHOLE_ESCAPE,
      'the ship ends up somewhere it can fly away from');
    g.over = true; g.ended = true;
  }

  /* ---- pilots go through too, instead of piling up -------------------- */

  const seed2 = seedWithWormholes(1);
  if (seed2 > 0) {
    const g = SS.game;
    const world = g.sector;
    const w = world.wormholes[0];
    const before = world.enemies.length;
    for (let i = 0; i < 6; i++) {
      world.enemies.push(SS.makeEnemy(SS.enemyByKey('rookie'), world,
        w.x + (i - 3) * 0.7, w.y, world.depth));
    }
    eq(world.enemies.length, before + 6, 'parked six pilots on the well');
    g.player.x = 20; g.player.y = 20;
    for (let i = 0; i < 100 * 45 && !g.over; i++) g.step(SS.TICK_DT);

    const pinned = world.enemies.filter(
      (e) => e.alive && SS.distanceToNearestWormhole(world, e) < 3).length;
    eq(pinned, 0, 'no pilot is left pinned inside a well');
    g.over = true; g.ended = true;
  }

  /* ---- the destination moves on WormholeSwitchTime -------------------- */

  const seed3 = seedWithWormholes(1);
  if (seed3 > 0) {
    const g = SS.game;
    const world = g.sector;
    const start = world.wormholes[0].dest;
    ok(!!start, 'a wormhole is aimed somewhere before the switch timer runs');
    if (start) {
      const first = { x: start.x, y: start.y };
      g.player.x = 20; g.player.y = 20;
      const ticks = Math.ceil((SS.ARENA.WormholeSwitchTime + 2) * 100);
      for (let i = 0; i < ticks && !g.over; i++) g.step(SS.TICK_DT);
      const now = world.wormholes[0].dest;
      ok(now && SS.dist(first, now) > 1,
        'a wormhole re-aims itself every WormholeSwitchTime seconds');
    }
    g.over = true; g.ended = true;
  }

  /* ---- and it still flings you --------------------------------------- */

  const seed4 = seedWithWormholes(1);
  if (seed4 > 0) {
    const g = SS.game;
    const world = g.sector;
    const p = g.player;
    const w = world.wormholes[0];
    if (!w.dest) ok(false, 'a wormhole with no destination cannot throw anything');
    p.x = w.x; p.y = w.y; p.vx = 6; p.vy = 0;
    p.timer.spawnGuard = 0; p.inWormhole = false;
    const from = { x: p.x, y: p.y };
    const speedBefore = SS.length(p.vx, p.vy);
    g.step(SS.TICK_DT);
    ok(SS.dist(from, p) > 20, 'a wormhole throws you a long way (' +
      SS.dist(from, p).toFixed(0) + ' tiles)');
    ok(Math.abs(SS.length(p.vx, p.vy) - speedBefore) < 0.6,
      'momentum is carried through, as it is in the original');
    ok(!world.solidAtPos(p.x, p.y), 'you do not arrive inside a wall');
    g.over = true; g.ended = true;
  }

  function seedWithWormholes(minCount) {
    for (let s = 1; s < 300; s++) {
      SS.rng.seed(s);
      SS.game.newGame({ name: 'Wormhole', shipKey: 'warbird', seed: s });
      if (SS.game.sector.wormholes.length >= minCount) return s;
    }
    return 0;
  }

  function firstSectorWithWormholes(minCount) {
    for (let s = 1; s < 200; s++) {
      SS.rng.seed(5000 + s);
      SS.ship.resetIds(1);
      const candidate = SS.makeSector(12);
      if (candidate.wormholes.length >= minCount) return candidate;
    }
    return null;
  }
}

/* The keyboard.
 *
 * This stage exists because of a bug that shipped: holding a WASD key, then
 * pressing Shift to boost, then releasing the WASD key left the ship turning
 * or thrusting forever with nothing held down.  `event.key` reports the
 * character produced, so the keydown said 'a' and the keyup said 'A', and the
 * held-key map never saw the release.  Arrow keys were immune, which is why
 * it survived the first round of play-testing.
 *
 * Every case below is a way for a key to go down under one set of modifiers
 * and come up under another. */
function stageInput() {
  const K = REAL_INPUT;

  /* Every action an on-screen button can fire.  Buttons are declared two
     ways - as `act:` entries in the pad tables and as `data-act` in the raw
     markup for the top row - and a check that only knew about one of them
     silently skipped the menu button. */
  function touchActions() {
    const src = fs.readFileSync(path.join(root, 'js/hud.js'), 'utf8');
    const found = {};
    let m;
    const asField = /\bact: '([a-z]+)'/g;
    while ((m = asField.exec(src)) !== null) found[m[1]] = true;
    const asMarkup = /data-act="([a-z]+)"/g;
    while ((m = asMarkup.exec(src)) !== null) found[m[1]] = true;
    return Object.keys(found);
  }

  /* an event-shaped object; the real handlers only read these fields */
  function ev(key, code, mods) {
    mods = mods || {};
    return {
      key: key, code: code,
      shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta,
      preventDefault: function () { this.defaultPrevented = true; },
      defaultPrevented: false
    };
  }
  const downEv = (key, code, mods) => { const e = ev(key, code, mods); K.keyDown(e); return e; };
  const upEv = (key, code, mods) => { const e = ev(key, code, mods); K.keyUp(e); return e; };

  function flightString() {
    const f = K.flight();
    return (f.left ? 'L' : '.') + (f.right ? 'R' : '.') + (f.forward ? 'F' : '.') +
           (f.backward ? 'B' : '.') + (f.afterburner ? 'A' : '.');
  }

  /* ---- the reported bug, in every direction it can happen ------------- */

  const WASD = [
    { key: 'a', shifted: 'A', code: 'KeyA', field: 'left', what: 'turn left' },
    { key: 'd', shifted: 'D', code: 'KeyD', field: 'right', what: 'turn right' },
    { key: 'w', shifted: 'W', code: 'KeyW', field: 'forward', what: 'thrust' },
    { key: 's', shifted: 'S', code: 'KeyS', field: 'backward', what: 'reverse' }
  ];

  WASD.forEach((k) => {
    K.clear();
    downEv(k.key, k.code);
    ok(K.flight()[k.field], k.what + ': pressing ' + k.key.toUpperCase() + ' works');

    downEv('Shift', 'ShiftLeft', { shift: true });
    ok(K.flight().afterburner, k.what + ': Shift engages the afterburner');
    ok(K.flight()[k.field], k.what + ': still held while boosting');

    /* the browser reports the *shifted* character on the way up */
    upEv(k.shifted, k.code, { shift: true });
    ok(!K.flight()[k.field],
      k.what + ': releasing ' + k.key.toUpperCase() + ' while Shift is held actually releases it');

    upEv('Shift', 'ShiftLeft');
    eq(flightString(), '.....',
      k.what + ': nothing is left held after boosting and releasing (' + flightString() + ')');
  });

  /* Caps Lock produces the same mismatch without Shift ever being touched. */
  K.clear();
  downEv('A', 'KeyA');
  ok(K.flight().left, 'caps lock: A turns left');
  upEv('A', 'KeyA');
  ok(!K.flight().left, 'caps lock: A releases');

  /* Arrows were always fine; make sure they stay fine. */
  K.clear();
  downEv('ArrowLeft', 'ArrowLeft');
  downEv('Shift', 'ShiftLeft', { shift: true });
  upEv('ArrowLeft', 'ArrowLeft', { shift: true });
  upEv('Shift', 'ShiftLeft');
  eq(flightString(), '.....', 'arrows: boosting and releasing leaves nothing held');

  /* Both Shift keys, and releasing the other one. */
  K.clear();
  downEv('w', 'KeyW');
  downEv('Shift', 'ShiftLeft', { shift: true });
  downEv('Shift', 'ShiftRight', { shift: true });
  upEv('Shift', 'ShiftLeft', { shift: true });
  ok(K.flight().afterburner, 'holding the other Shift keeps the afterburner lit');
  upEv('Shift', 'ShiftRight');
  ok(!K.flight().afterburner, 'releasing both Shifts cuts the afterburner');
  upEv('W', 'KeyW');
  eq(flightString(), '.....', 'two-Shift sequence leaves nothing held');

  /* ---- modifiers whose release never arrives ------------------------- */

  /* Ctrl is the fire button and also the prefix the OS and browser reserve
     for themselves.  When one of those combinations is taken, the keyup often
     never reaches the page - and a held-key map that only learns from keyup
     is left believing the trigger is still down, so the ship fires forever
     with nobody touching anything.  Every event carries the true modifier
     state, so it is reconciled against that continuously. */
  K.clear();
  downEv('Control', 'ControlLeft', { ctrl: true });
  ok(K.firingGun(), 'Ctrl fires');
  /* the OS swallows Ctrl+W; no keyup for Ctrl ever arrives.  The next event
     to reach the page reports ctrlKey false. */
  downEv('a', 'KeyA');
  ok(!K.firingGun(),
    'a modifier released off-window is noticed on the next key, not left stuck on');
  upEv('a', 'KeyA');
  eq(flightString(), '.....', 'and nothing else is left held');

  K.clear();
  downEv('Shift', 'ShiftLeft', { shift: true });
  ok(K.flight().afterburner, 'Shift boosts');
  upEv('a', 'KeyA');                       // an unrelated event, shift now false
  ok(!K.flight().afterburner, 'a stuck Shift is released too');

  /* pointer events carry modifier state as well, and keep arriving when the
     keyboard handlers are standing aside for a menu */
  K.clear();
  downEv('Control', 'ControlLeft', { ctrl: true });
  ok(K.firingGun(), 'Ctrl held');
  SS.input.reconcileModifiers({ ctrlKey: false, shiftKey: false, altKey: false });
  ok(!K.firingGun(), 'a pointer event with no modifiers clears a stuck one');

  /* and a modifier genuinely held must survive its own keydown */
  K.clear();
  downEv('Control', 'ControlLeft', { ctrl: true });
  downEv('w', 'KeyW', { ctrl: true });
  ok(K.firingGun(), 'Ctrl stays down while it is genuinely held');
  ok(K.flight().forward, 'and the other key registers alongside it');
  K.clear();

  /* Losing focus mid-turn must not leave the ship rotating. */
  K.clear();
  downEv('a', 'KeyA');
  downEv('Shift', 'ShiftLeft', { shift: true });
  K.clear();
  eq(flightString(), '.....', 'clearing on blur releases everything');

  /* ---- one-shots ------------------------------------------------------ */

  K.clear();
  K.takeActions();

  /* A modifier that comes back up before the frame is read must not change
     what the press meant. */
  downEv('Tab', 'Tab', { shift: true });
  upEv('Tab', 'Tab', { shift: true });
  upEv('Shift', 'ShiftLeft');
  let actions = K.takeActions();
  ok(actions.indexOf('mine') >= 0,
    'Shift+Tab lays a mine even if Shift is released first (' + actions.join(',') + ')');
  ok(actions.indexOf('bomb') < 0, 'Shift+Tab is not also read as a bomb');

  K.clear();
  downEv('Tab', 'Tab');
  actions = K.takeActions();
  ok(actions.indexOf('bomb') >= 0, 'plain Tab fires a bomb');

  /* Holding a key must fire its action once, not once per frame. */
  K.clear();
  downEv('F5', 'F5');
  eq(K.takeActions().filter((a) => a === 'decoy').length, 1, 'F5 drops one decoy');
  downEv('F5', 'F5');                       // auto-repeat: still down
  eq(K.takeActions().filter((a) => a === 'decoy').length, 0,
    'holding F5 does not drop a decoy every frame');
  upEv('F5', 'F5');
  downEv('F5', 'F5');
  eq(K.takeActions().filter((a) => a === 'decoy').length, 1, 'releasing and pressing F5 drops another');

  /* Ctrl+S saves, and is not mistaken for the S that means reverse thrust. */
  K.clear();
  const ctrlS = downEv('s', 'KeyS', { ctrl: true });
  actions = K.takeActions();
  ok(actions.indexOf('save') >= 0, 'Ctrl+S saves (' + actions.join(',') + ')');
  ok(actions.indexOf('pause') < 0 && actions.indexOf('shipinfo') < 0,
    'Ctrl+S does not trigger anything else');
  ok(ctrlS.defaultPrevented, 'Ctrl+S is swallowed, so the browser does not open its save dialog');
  upEv('s', 'KeyS', { ctrl: true });
  eq(flightString(), '.....', 'Ctrl+S leaves no key stuck');

  /* Ctrl+R must still reach the browser. */
  K.clear();
  const ctrlR = downEv('r', 'KeyR', { ctrl: true });
  ok(!ctrlR.defaultPrevented, 'Ctrl+R is left to the browser');

  /* Upper and lower case are one command, not two. */
  K.clear();
  downEv('P', 'KeyP', { shift: true });
  ok(K.takeActions().indexOf('pause') >= 0, 'Shift+P still pauses');
  K.clear();
  downEv('p', 'KeyP');
  ok(K.takeActions().indexOf('pause') >= 0, 'p pauses');
  K.clear();
  downEv('i', 'KeyI');
  ok(K.takeActions().indexOf('shipinfo') >= 0, 'i opens the ship readout');

  /* Firing: Ctrl shoots, Shift+Ctrl is a repel and must not also shoot. */
  K.clear();
  downEv('Control', 'ControlLeft', { ctrl: true });
  ok(K.firingGun(), 'Ctrl fires the guns');
  downEv('Shift', 'ShiftLeft', { shift: true, ctrl: true });
  ok(!K.firingGun(), 'Shift+Ctrl does not fire the guns');
  K.clear();
  downEv(' ', 'Space');
  ok(K.firingGun(), 'Space fires the guns');
  upEv(' ', 'Space');
  ok(!K.firingGun(), 'Space releases');

  /* Alt shows the map and lets go of it. */
  K.clear();
  downEv('Alt', 'AltLeft');
  ok(K.showingMap(), 'Alt shows the whole-sector map');
  upEv('Alt', 'AltLeft');
  ok(!K.showingMap(), 'releasing Alt hides it again');

  /* ---- on-screen controls -------------------------------------------- */

  /* The DOM side of the touch layer is verified in a browser; what is worth
     pinning here is the contract it talks to input.js through, and the one
     place where a touch control and a key deliberately differ. */

  K.clear();
  SS.input.setVirtual('ArrowLeft', true);
  ok(K.flight().left, 'an on-screen control turns the ship');
  SS.input.setVirtual('ArrowLeft', false);
  ok(!K.flight().left, 'and releasing it stops');

  /* BOOST is not Shift.  On a keyboard Shift+Ctrl is a repel and suppresses
     the guns; on screen the two are separate buttons under separate thumbs,
     and holding both has to mean both. */
  K.clear();
  SS.input.setVirtual('Control', true);
  ok(K.firingGun(), 'the on-screen fire button fires');
  SS.input.setVirtual('Boost', true);
  ok(K.flight().afterburner, 'the on-screen boost button lights the afterburner');
  ok(K.firingGun(), 'holding BOOST does not stop the guns firing');
  K.clear();

  downEv('Control', 'ControlLeft', { ctrl: true });
  downEv('Shift', 'ShiftLeft', { shift: true });
  ok(!K.firingGun(), 'the keyboard Shift+Ctrl repel still suppresses the guns');
  K.clear();

  /* Buttons name actions directly rather than synthesising modifier+key. */
  SS.input.pushAction('burst');
  SS.input.pushAction('cloak');
  actions = K.takeActions();
  ok(actions.indexOf('burst') >= 0 && actions.indexOf('cloak') >= 0,
    'pushed actions come out of takeActions (' + actions.join(',') + ')');
  eq(K.takeActions().length, 0, 'and are consumed exactly once');

  /* Every button the touch layer offers must name an action the game
     dispatcher actually handles, or it is a button that does nothing. */
  const dispatched = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
  const handled = {};
  const caseRe = /case '([a-z]+)':/g;
  let cm;
  while ((cm = caseRe.exec(dispatched)) !== null) handled[cm[1]] = true;

  const buttons = touchActions();
  buttons.forEach(function (a) {
    ok(handled[a], 'the on-screen "' + a + '" button names an action game.js handles');
  });
  ok(buttons.length > 10,
    'the touch layer offers the full command set (' + buttons.length + ' buttons)');

  /* ---- the utility stack ---------------------------------------------- */

  /* Six buttons climbing from BOMB, plus PORT outboard of BOOST.  The order
     is the point: a ladder the thumb learns by position stops working if the
     rungs are renumbered, so it is pinned here rather than left to whoever
     next edits the array. */
  const hudSrc = fs.readFileSync(path.join(root, 'js/hud.js'), 'utf8');
  const stackBlock = (hudSrc.match(/var STACK = \[[\s\S]*?\];/) || [])[0] || '';
  ok(!!stackBlock, 'the touch layer declares a utility stack');
  const stackActs = [];
  let sm;
  const stackRe = /\bact: '([a-z]+)'/g;
  while ((sm = stackRe.exec(stackBlock)) !== null) stackActs.push(sm[1]);
  eq(stackActs.join(','), 'mine,repel,burst,decoy,multifire,warp',
    'the stack reads bottom-to-top: mine, repel, burst, decoy, multifire, warp');
  stackActs.forEach(function (a) {
    ok(handled[a], 'stacked "' + a + '" names an action game.js handles');
  });
  ok(/act: 'portal', label: 'PORT'/.test(hudSrc),
    'PORT is a pad button rather than only a gear-panel entry');

  /* Every stacked action is still reachable the old way.  Someone who learned
     the gear panel should not find it emptied out from under them. */
  const gearBlock = (hudSrc.match(/var GEAR = \[[\s\S]*?\];/) || [])[0] || '';
  stackActs.concat(['portal']).forEach(function (a) {
    ok(gearBlock.indexOf("act: '" + a + "'") >= 0,
      '"' + a + '" is still in the gear panel as well as on the pad');
  });

  /* The layout has two escape hatches for small screens, and both are easy to
     delete by accident because nothing fails without them until you hold a
     phone sideways: the MAP/GEAR/menu column moves off the right edge, and
     PORT climbs on top of BOOST instead of reaching into the d-pad. */
  const cssSrc = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  ok(/#touch\.ttop-left \.ttop/.test(cssSrc),
    'css can move the MAP/GEAR/menu column off the crowded edge');
  ok(/#touch\.port-up \.tpad-right \.portal/.test(cssSrc),
    'css can stack PORT above BOOST on a narrow screen');
  ok(/classList\.add\('ttop-left'\)/.test(hudSrc) && /classList\.add\('port-up'\)/.test(hudSrc),
    'layoutTouch actually applies both, rather than the css sitting unused');
  ok(/flex-wrap:\s*wrap-reverse/.test(cssSrc),
    'the stack wraps into columns instead of running off the top of the screen');
  ok(/hud\.controlsOverlap/.test(hudSrc),
    'the decision is made by measuring overlap, not by a width breakpoint');

  /* ---- pause is a place you can leave -------------------------------- */

  /* Pausing used to be a one-way trip.  Actions were dispatched only inside
     the "simulating" branch of the frame loop, and pausing made that branch
     false - so P, Escape and the on-screen menu button all stopped being read
     the moment the game was held, and the only way out was a reload. */
  const gm = SS.game;
  SS.rng.seed(808);
  gm.newGame({ name: 'Held', shipKey: 'warbird', seed: 808 });

  let queued = [];
  SS.input.takeActions = () => { const a = queued; queued = []; return a; };
  const press = (a) => { queued.push(a); gm.handleActions(); };

  eq(gm.paused, false, 'a new run is not paused');
  ok(gm.ownsInput() && gm.isSimulating(), 'a running game reads input and advances');

  press('pause');
  eq(gm.paused, true, 'pause holds the game');
  /* The bug itself: the frame loop must keep reading input while paused.
     Asserting the predicate rather than the symptom, because the symptom was
     "nothing happens ever again" and there is no state to inspect for it. */
  ok(gm.ownsInput(), 'a paused game still reads input - this is what a pause you can leave means');
  ok(!gm.isSimulating(), 'but the world does not advance');

  press('pause');
  eq(gm.paused, false, 'and pressing it again lets go - the game is not soft-locked');
  ok(gm.isSimulating(), 'the world advances again');

  /* the actions that must survive a pause, and the ones that must not */
  press('pause');
  ok(gm.paused, 'paused again for the next checks');
  gm.sector.shots = [];
  press('bomb');
  press('mine');
  press('burst');
  eq((gm.sector.shots || []).length, 0, 'weapons do not fire from a held game');

  let opened = false;
  const realMenu = SS.commands.openMenu;
  SS.commands.openMenu = function () { opened = true; return Promise.resolve(); };
  press('menu');
  ok(opened, 'the menu still opens while paused');
  SS.commands.openMenu = realMenu;

  ok(gm.paused, 'and none of that resumed the game by accident');
  gm.setPaused(false);
  eq(gm.paused, false, 'setPaused releases it');

  /* an on-screen control for it, or a touch player cannot pause at all */
  const touchActs = touchActions();
  ok(touchActs.indexOf('pause') >= 0, 'the on-screen controls include a pause button');
  ok(touchActs.indexOf('menu') >= 0, 'and a menu button');

  /* tapping the game itself is the other way out */
  const gameSource = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
  ok(/installResumeOnTap[\s\S]*?pointerdown/.test(gameSource),
    'a tap or click on the game resumes it');
  ok(/installResumeOnTap[\s\S]*?closest\('\.tbtn'\)/.test(gameSource),
    'except on a control, which would toggle the pause straight back');
  ok(/js\/render\.js/.test(SCRIPTS.join(' ')) &&
    /function drawPaused/.test(fs.readFileSync(path.join(root, 'js/render.js'), 'utf8')),
    'and a held game says so on screen');

  gm.over = true; gm.ended = true;
  SS.input.takeActions = () => [];

  /* ---- the end-of-run summary is held long enough to read ------------- */

  /* A run ends with your hands on the controls.  Without a hold, the keypress
     already in flight - the one that was firing, or turning - dismisses the
     summary before a word of it has been read. */
  const hudHold = fs.readFileSync(path.join(root, 'js/hud.js'), 'utf8');
  const gameHold = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');

  ok(SS.ENDGAME_HOLD >= 5,
    'the summary is held for a readable stretch (' + SS.ENDGAME_HOLD + 's)');
  ok(/showText\([\s\S]{0,140}holdSeconds: SS\.ENDGAME_HOLD/.test(gameHold),
    'the end-of-run summary asks for that hold');
  ok(/function held\(\) \{ return Date\.now\(\) < holdUntil; \}/.test(hudHold),
    'a held panel knows when it is still held');
  ok(/function dismiss\(\)[\s\S]{0,160}if \(held\(\)\) return;/.test(hudHold),
    'a click cannot dismiss a held panel');
  ok(/if \(held\(\)\) \{[\s\S]{0,140}return waitForDismiss\(\);/.test(hudHold),
    'nor can a key: it is discarded and the panel keeps waiting');
  /* discarded, not queued - otherwise the key that killed you would still be
     sitting in the queue when the hold expires and would dismiss it anyway */
  ok(/if \(held\(\)\) \{\s*\n\s*keyQueue\.length = 0;/.test(hudHold),
    'keys pressed during the hold are discarded rather than queued up');
  ok(/waitText|holdUntil - Date\.now/.test(hudHold),
    'the wait is shown as a countdown, not as an unresponsive screen');

  /* the option is additive: every existing caller passes no third argument,
     and a bare string must still mean the footer */
  ok(/if \(typeof opts === 'string'\) opts = \{ footer: opts \};/.test(hudHold),
    'showText still accepts a plain footer string');

  /* ---- a panel is not closed by the click that opened it -------------- */

  /* Both dismissal paths - tapping a full-screen panel to continue, and
     tapping a menu's backdrop to cancel - are listeners on the overlay, and
     the overlay is already under the pointer when they are installed.  So the
     trailing `click` of the opening gesture lands on a listener that did not
     exist when the press began, and shuts the thing it just opened.
     On a phone the menu button opened and closed the menu in one tap unless
     you slid your finger onto the menu box first; on a desktop the ship
     readout, prize log and controls could not be opened from the menu at all.

     A panel records the gesture it was born in and ignores that one.  No DOM
     here, so this is a source-level guard; the behaviour itself is verified
     in a browser. */
  const hudGesture = fs.readFileSync(path.join(root, 'js/hud.js'), 'utf8');

  ok(/function bumpGesture\(\) \{ gesture\+\+; \}/.test(hudGesture),
    'a press starts a new gesture');
  /* one press, one count: listening to more than one press source would
     count a single press twice and re-open the very bug this prevents */
  eq((hudGesture.match(/addEventListener\('pointerdown', bumpGesture/g) || []).length, 1,
    'pointer presses are counted from exactly one source');
  ok(/if \(window\.PointerEvent\)[\s\S]{0,200}else[\s\S]{0,200}touchstart/.test(hudGesture),
    'with a fallback only where pointer events do not exist');
  ok(/function backdrop[\s\S]*?sameGestureAsOpen\(born\)/.test(hudGesture),
    'a menu ignores backdrop clicks from the gesture that opened it');
  ok(/function dismiss[\s\S]*?sameGestureAsOpen\(born\)/.test(hudGesture),
    'a text panel ignores the click that opened it');
  /* and a panel must not become permanently undismissable if the press is
     never seen, so age is a second, independent way out */
  ok(/sameGestureAsOpen[\s\S]{0,320}Date\.now\(\) - born\.at/.test(hudGesture),
    'a panel becomes dismissable on age even if no press is ever observed');

  /* One overlay, one handler.  A panel that never closed used to leave its
     listener attached, and it went on cancelling whatever replaced it. */
  ok(/function setOverlayClick/.test(hudGesture),
    'the overlay click handler is owned rather than merely added');
  eq((hudGesture.match(/overlay\.addEventListener\('click'/g) || []).length, 1,
    'and installed in exactly one place, so none can be orphaned');

  /* ---- no keyboard-only dead ends ------------------------------------ */

  /* Every prompt in the game blocks until it is answered, and on a phone the
     only ways to answer are a tap and the on-screen keyboard.  A prompt that
     offers neither is not awkward, it is a wall: the name prompt used to draw
     its own caret and read intercepted keystrokes, so nothing was ever
     focused, no keyboard appeared, and a run could not be started at all.
     The full-screen text panels had the same problem - including the death
     screen, which made dying on a phone unrecoverable.

     The harness has no DOM, so this is a source-level guard; the behaviour
     itself is verified in a browser.  It is here to state the requirement and
     to fail loudly if any of the three touch paths is removed. */
  const hudSource = fs.readFileSync(path.join(root, 'js/hud.js'), 'utf8');

  ok(/getLine[\s\S]*?<input/.test(hudSource),
    'the text prompt uses a real input, so a phone raises its keyboard');
  ok(/enterkeyhint/.test(hudSource),
    'the text prompt asks for a "go" key on the on-screen keyboard');
  ok(/focusSoon\(input\)/.test(hudSource),
    'the text prompt takes focus rather than waiting to be found');
  ok(/showText[\s\S]*?setOverlayClick\(function dismiss/.test(hudSource),
    'full-screen text panels can be dismissed with a tap');
  ok(/function backdrop[\s\S]*?pushKey\('Escape'\)/.test(hudSource),
    'menus can be cancelled by tapping the backdrop, the touch equivalent of Esc');
  ok(/tagName;[\s\S]*?'INPUT'/.test(hudSource),
    'the menu key handler stands aside for a focused text field');

  /* At least 16px, or mobile Safari zooms the whole page in on focus. */
  const cssSource = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const fieldSize = /\.entryinput\b[^}]*font-size:\s*(\d+)px/.exec(cssSource);
  ok(fieldSize && Number(fieldSize[1]) >= 16,
    'the text field is at least 16px, so mobile Safari does not zoom the page');

  K.clear();
  K.takeActions();
}

/* GitHub Pages serves a project site from https://user.github.io/<repo>/, not
   from a domain root, and it will happily serve a page whose assets all 404.
   Nothing about that failure is visible until someone opens the deployed site,
   so the whole contract is asserted here instead:

     - every asset the pages reference is relative, and actually exists
     - nothing loads from another host, so the game works offline
     - .nojekyll is present, or Pages runs the tree through Jekyll and drops
       anything it considers a template
     - the single-file bundle really is single-file                        */
function stageDeploy() {
  const PAGES = ['index.html', 'play.html'];

  /* src/href on anything that *loads* - links to other sites are fine. */
  const LOADING = /<(?:script|link|img|source|iframe|video|audio)\b[^>]*?\b(?:src|href)="([^"]+)"/gi;
  /* every href, including plain anchors, so internal links are checked too */
  const ANCHORS = /<a\b[^>]*?\bhref="([^"]+)"/gi;

  ok(fs.existsSync(path.join(root, '.nojekyll')),
    '.nojekyll is present, so Pages serves the tree verbatim');

  PAGES.forEach((page) => {
    const file = path.join(root, page);
    ok(fs.existsSync(file), page + ' exists');
    const html = fs.readFileSync(file, 'utf8');

    let m;
    LOADING.lastIndex = 0;
    while ((m = LOADING.exec(html)) !== null) {
      const url = m[1];
      if (url.startsWith('data:')) continue;
      ok(!/^https?:\/\//i.test(url),
        page + ' loads "' + url.slice(0, 40) + '" from this repository, not another host');
      ok(!url.startsWith('/'),
        page + ' references "' + url + '" relatively, so it survives a /<repo>/ subpath');
      ok(fs.existsSync(path.join(root, url)),
        page + ' references "' + url + '", which exists');

      /* An image referenced but never captured would ship as a broken icon,
         and a zero-byte placeholder looks identical in the file listing. */
      if (/\.png$/i.test(url) && fs.existsSync(path.join(root, url))) {
        const buf = fs.readFileSync(path.join(root, url));
        ok(buf.length > 2000, url + ' is a real image (' + Math.round(buf.length / 1024) + 'KB)');
        ok(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
          url + ' really is a PNG');
      }
    }

    ANCHORS.lastIndex = 0;
    while ((m = ANCHORS.exec(html)) !== null) {
      const url = m[1];
      if (/^(https?:|mailto:|#|data:)/i.test(url)) continue;
      ok(!url.startsWith('/'),
        page + ' links to "' + url + '" relatively');
      ok(fs.existsSync(path.join(root, url.split('#')[0])),
        page + ' links to "' + url + '", which exists');
    }
  });

  /* The script list is the one thing that can drift between the shell, the
     bundler and this harness, so check the files themselves are all there. */
  SCRIPTS.forEach((src) => {
    ok(fs.existsSync(path.join(root, src)), 'play.html script "' + src + '" exists');
    ok(!src.startsWith('/') && !/^https?:/i.test(src), 'script "' + src + '" is relative');
  });

  /* The bundle is the offline copy; if anything in it still points outward it
     is not a bundle, it is a page that happens to be large. */
  const bundlePath = path.join(root, '5space.html');
  if (fs.existsSync(bundlePath)) {
    const bundle = fs.readFileSync(bundlePath, 'utf8');
    const external = (bundle.match(/(?:src|href)="(?!data:|#|https?:\/\/)[^"]*"/g) || []);
    eq(external.length, 0,
      'the single-file bundle references no files (' + external.slice(0, 3).join(', ') + ')');
    ok(bundle.indexOf('<script src=') < 0, 'the bundle has no external script tags');
    ok(bundle.indexOf('SS.game') > 0, 'the bundle actually contains the game');
  }
}

/* Every key the game accepts must be described somewhere the player can find
   it, and every key the manual promises must actually do something. */
function stageDocs() {
  const manual = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  SS.input.BINDINGS.forEach((b) => {
    const needle = b[0].replace(/&/g, '&amp;');
    ok(manual.indexOf(needle) >= 0, 'the manual documents "' + b[0] + '"');
  });

  /* every hull, prize and pilot should be introduced somewhere too */
  SS.shipList().forEach((k) => {
    ok(manual.indexOf(SS.SHIPS[k].name) >= 0, 'the manual mentions the ' + SS.SHIPS[k].name);
  });

  /* The hero shot replaced the ASCII drawing that used to sit under the
     title.  A drawing degrades to nothing when it breaks; an <img> degrades
     to a broken-icon box at the very top of the front page, so it is worth
     asserting it is still referenced and still described.  The `deploy` stage
     separately proves the file exists and is a real PNG. */
  const hero = (manual.match(/<div class="hero">[\s\S]*?<\/div>/) || [])[0];
  ok(!!hero, 'the welcome page still leads with the hero screenshot');
  if (hero) {
    ok(/<img\s[^>]*src="shots\/[^"]+\.png"/.test(hero), 'the hero points at a shot in shots/');
    ok(/alt="[^"]{60,}"/.test(hero), 'the hero has an alt description worth reading');
    ok(/\bwidth="\d+"[\s\S]*?\bheight="\d+"/.test(hero),
      'the hero declares its size, so the page does not jump when it loads');
  }
  ok(manual.indexOf('<pre class="art">') < 0,
    'the ASCII placeholder it replaced is gone rather than left underneath');

  /* The annotated screenshots: every pin must have a matching legend entry,
     or the figure numbers point at nothing. */
  const frames = manual.match(/<div class="shot-frame">[\s\S]*?<\/div>/g) || [];
  const legends = manual.match(/<ol class="pins">[\s\S]*?<\/ol>/g) || [];
  eq(frames.length, 2, 'the welcome page carries both annotated screenshots');
  eq(legends.length, frames.length, 'each screenshot has a legend');
  frames.forEach((frame, i) => {
    const pins = (frame.match(/class="pin"/g) || []).length;
    const items = (legends[i].match(/<li>/g) || []).length;
    eq(pins, items, 'figure ' + (i + 1) + ': every pin has a legend entry');
    ok(pins >= 5, 'figure ' + (i + 1) + ' explains a useful number of things (' + pins + ')');
    ok(/alt="[^"]{40,}"/.test(frame), 'figure ' + (i + 1) + ' has a real alt description');
  });

  /* the data tables should be self-consistent */
  const seen = {};
  SS.PRIZES.forEach((p) => {
    ok(!seen[p.id], 'prize id ' + p.id + ' is unique');
    seen[p.id] = true;
    ok(!!p.name && !!p.note, 'prize ' + p.id + ' is described');
    ok(['stat', 'level', 'toggle', 'count', 'burst', 'timed', 'meta'].indexOf(p.kind) >= 0,
      p.name + ' has a known kind');
  });
  const keys = {};
  SS.ENEMIES.forEach((e) => {
    ok(!keys[e.key], 'enemy key ' + e.key + ' is unique');
    keys[e.key] = true;
  });
}

/* ====================================================================== */
/* runner                                                                 */
/* ====================================================================== */

const STAGES = {
  gen: stageGen,
  determinism: stageDeterminism,
  physics: stagePhysics,
  prizes: stagePrizes,
  enemies: stageEnemies,
  weapons: stageWeapons,
  save: stageSave,
  descent: stageDescent,
  pilot: stagePilot,
  play: stagePlay,
  balance: stageBalance,
  difficulty: stageDifficulty,
  wormholes: stageWormholes,
  input: stageInput,
  deploy: stageDeploy,
  docs: stageDocs
};

function main() {
  const args = process.argv.slice(2);
  let budget = 6;
  const picked = [];
  args.forEach((a) => {
    if (/^\d+$/.test(a)) budget = parseInt(a, 10);
    else a.split(',').forEach((n) => { if (n) picked.push(n); });
  });

  const bad = picked.filter((n) => !STAGES[n]);
  if (bad.length) {
    console.error('No such stage: ' + bad.join(', '));
    console.error('Stages: ' + Object.keys(STAGES).join(', '));
    process.exit(2);
  }
  const names = picked.length ? picked : Object.keys(STAGES);

  console.log('5Space test suite  (budget ' + budget + ')');
  const t0 = Date.now();
  names.forEach((n) => stage(n, () => STAGES[n](budget)));

  console.log('');
  console.log('  ' + checks + ' checks in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  if (failures.length) {
    console.log('');
    console.log('  ' + failures.length + ' FAILURES:');
    const shown = failures.slice(0, 30);
    shown.forEach((f) => console.log('    - ' + f));
    if (failures.length > shown.length) {
      console.log('    ... and ' + (failures.length - shown.length) + ' more');
    }
    process.exit(1);
  }
  console.log('  all good');
}

main();
