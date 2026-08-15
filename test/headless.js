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
