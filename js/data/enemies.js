/* 5Space - who is out there.
 *
 * SubSpace had no monsters; it had other pilots.  So the bestiary here is a
 * roster of pilots flying the same eight hulls you fly, and what makes one
 * dangerous is not a bigger damage number but a better *build* - a Corsair is
 * frightening because it launched with fourteen greens already applied and
 * knows how to lead a shot.
 *
 * `difficulty` works the way NetHack's monster difficulty does: it gates what
 * can appear at what depth, and the generator prefers entries whose
 * difficulty sits just under the sector's.  `prizes` is how many greens the
 * pilot has already collected, which is the real difficulty dial.
 *
 * The exceptions to "everything is a pilot" are drones, which are barely
 * ships at all, and turrets, which are bolted to a base and cannot leave.
 */
(function (SS) {
  'use strict';

  /* ai profiles are implemented in enemyai.js:
       ram     - no guns, closes and collides
       duel    - mid-range knife fight, strafes, guns
       bomb    - stands off and lobs bombs
       snipe   - long range, retreats when approached
       ambush  - stealths or cloaks, holds still, dives on a passer-by
       mine    - seeds corridors, disengages
       turret  - fixed emplacement
       ace     - uses the whole toolkit, including utilities
       guardian- the Core's keeper                                        */

  var ENEMIES = [
    /* --- the shallows --------------------------------------------------- */
    { key: 'scout-drone', name: 'scout drone', ship: 'weasel', ai: 'ram',
      difficulty: 1, freq: 6, prizes: 0, drone: true, color: '#88cc88',
      note: 'One popgun, half an energy bar, and no sense of self-preservation.' },

    { key: 'rookie', name: 'rookie', ship: 'warbird', ai: 'duel',
      difficulty: 1, freq: 7, prizes: 1, color: '#ff8888',
      note: 'Flies straight and fires early.' },

    { key: 'trainee', name: 'trainee', ship: 'spider', ai: 'duel',
      difficulty: 2, freq: 6, prizes: 2, color: '#88ffaa',
      note: 'Persistent. Never quite runs out of energy.' },

    { key: 'picket', name: 'picket turret', ship: 'warbird', ai: 'turret',
      difficulty: 2, freq: 5, prizes: 2, turret: true, color: '#aaaacc',
      note: 'Bolted to a base wall. Patient.' },

    { key: 'skirmisher', name: 'skirmisher', ship: 'weasel', ai: 'duel',
      difficulty: 3, freq: 6, prizes: 3, color: '#88ddff',
      note: 'Fast, fragile, and always at the wrong angle.' },

    /* --- the middle ----------------------------------------------------- */
    { key: 'wing-pilot', name: 'wing pilot', ship: 'javelin', ai: 'bomb',
      difficulty: 4, freq: 6, prizes: 4, color: '#ffbb55',
      note: 'Keeps its distance and makes you come to it.' },

    { key: 'interceptor', name: 'interceptor', ship: 'spider', ai: 'duel',
      difficulty: 5, freq: 6, prizes: 6, color: '#66ffbb',
      note: 'Closes fast and does not stop shooting.' },

    { key: 'sentinel', name: 'sentinel', ship: 'terrier', ai: 'snipe',
      difficulty: 5, freq: 4, prizes: 6, color: '#ffff99',
      note: 'Hard to kill, harder to catch, barely worth chasing.' },

    { key: 'bomber', name: 'bomber', ship: 'javelin', ai: 'bomb',
      difficulty: 6, freq: 6, prizes: 8, color: '#ffaa33',
      note: 'Proximity bombs, and it knows where the corridors are.' },

    { key: 'guard-turret', name: 'guard turret', ship: 'leviathan', ai: 'turret',
      difficulty: 6, freq: 5, prizes: 6, turret: true, color: '#ccaaff',
      note: 'A base gun with a bomb tube. Do not linger in its arc.' },

    { key: 'minelayer', name: 'minelayer', ship: 'shark', ai: 'mine',
      difficulty: 7, freq: 5, prizes: 8, color: '#ff99dd',
      note: 'Leaves the sector worse than it found it.' },

    { key: 'lancer', name: 'lancer', ship: 'lancaster', ai: 'duel',
      difficulty: 8, freq: 6, prizes: 10, color: '#99bbff',
      note: 'Bouncing bullets in a base is a different game entirely.' },

    { key: 'corsair', name: 'corsair', ship: 'warbird', ai: 'duel',
      difficulty: 9, freq: 6, prizes: 12, color: '#ff6666',
      note: 'A properly built Warbird. It will trade with you and win.' },

    { key: 'phantom', name: 'phantom', ship: 'weasel', ai: 'ambush',
      difficulty: 10, freq: 5, prizes: 12, color: '#66ccff',
      note: 'You will not see it on radar until it is already committed.' },

    /* --- the deeps ------------------------------------------------------ */
    { key: 'siege-turret', name: 'siege turret', ship: 'leviathan', ai: 'turret',
      difficulty: 11, freq: 4, prizes: 14, turret: true, color: '#bb88ff',
      note: 'Four-level bombs from a thing that cannot miss by moving.' },

    { key: 'hunter-killer', name: 'hunter-killer', ship: 'warbird', ai: 'ace',
      difficulty: 12, freq: 5, prizes: 16, color: '#ff4444',
      note: 'Bursts, repels, and no interest in a fair fight.' },

    { key: 'wraith', name: 'wraith', ship: 'weasel', ai: 'ambush',
      difficulty: 13, freq: 5, prizes: 18, color: '#99eeff',
      note: 'Cloaked, rocketed, and gone again.' },

    { key: 'dreadnought', name: 'dreadnought', ship: 'leviathan', ai: 'bomb',
      difficulty: 14, freq: 5, prizes: 18, color: '#cc77ff',
      note: 'Slow. Enormous. Fills a corridor with fire.' },

    { key: 'reaver', name: 'reaver', ship: 'shark', ai: 'mine',
      difficulty: 15, freq: 5, prizes: 20, color: '#ff77bb',
      note: 'Repels you into your own bombs, then leaves.' },

    { key: 'squad-leader', name: 'squad leader', ship: 'lancaster', ai: 'ace',
      difficulty: 16, freq: 5, prizes: 22, color: '#aaccff',
      note: 'Everything the hull can carry, and the sense to use it.' },

    { key: 'warlord', name: 'warlord', ship: 'warbird', ai: 'ace',
      difficulty: 18, freq: 4, prizes: 26, color: '#ff3333',
      note: 'A maximum Warbird. There is nothing clever about it.' },

    { key: 'void-lancer', name: 'void lancer', ship: 'javelin', ai: 'ace',
      difficulty: 19, freq: 4, prizes: 26, color: '#ffcc44',
      note: "Thor's hammer goes through walls. So does it, effectively." },

    { key: 'null-pilot', name: 'null pilot', ship: 'weasel', ai: 'ace',
      difficulty: 21, freq: 4, prizes: 30, color: '#ccffff',
      note: 'Fully prized, permanently cloaked, and faster than your bullets.' },

    { key: 'leviathan-prime', name: 'Leviathan Prime', ship: 'leviathan', ai: 'ace',
      difficulty: 23, freq: 3, prizes: 34, color: '#dd88ff',
      note: 'Three thousand energy and a bomb that fills the room.' },

    /* --- the Core ------------------------------------------------------- */
    { key: 'core-guardian', name: 'the Core Guardian', ship: 'leviathan',
      ai: 'guardian', difficulty: 26, freq: 0, prizes: 44, unique: true,
      color: '#ffffff', boss: true,
      note: 'It has never left this room and does not intend to start.' }
  ];

  SS.ENEMIES = ENEMIES;

  var byKey = {};
  ENEMIES.forEach(function (e) { byKey[e.key] = e; });
  SS.enemyByKey = function (k) { return byKey[k] || null; };

  /* ------------------------------------------------------------------ */
  /* choosing what turns up                                             */
  /* ------------------------------------------------------------------ */

  /* NetHack picks monsters near the current difficulty and rarely far below
     it, which is why level 20 is not full of newts.  Same shape here: the
     window slides down with depth and entries far under it are weighted out
     rather than banned outright, so the occasional rookie still wanders past
     the Core - and dies to it. */
  SS.pickEnemy = function (depth, opts) {
    opts = opts || {};
    var maxDiff = depth + 2;
    var minDiff = Math.max(1, Math.floor(depth / 2) - 1);

    var pool = ENEMIES.filter(function (e) {
      if (e.freq <= 0 || e.unique) return false;
      if (e.difficulty > maxDiff) return false;
      if (opts.turret !== undefined && !!e.turret !== !!opts.turret) return false;
      if (opts.noDrones && e.drone) return false;
      return true;
    });
    if (!pool.length) return ENEMIES[0];

    return SS.pickWeighted(pool, function (e) {
      var w = e.freq;
      if (e.difficulty < minDiff) w = Math.max(1, w >> 2);
      return w;
    });
  };

  /* How many pilots a sector launches with, and how many are already inside
     bases when you arrive.

     The shallow end is deliberately thin.  A real-time game with permadeath
     has to let you learn the controls before it starts taking the run away
     from you, and sector 1 is where that happens - so the curve starts low
     and the base garrisons, which are the dangerous ones, do not appear in
     any number until you have had a few sectors to build a hull. */
  SS.enemyBudget = function (depth) {
    return {
      roaming: 3 + Math.floor(depth * 0.75) + SS.rn2(3),
      inBase: Math.floor(depth * 0.45) + (depth > 2 ? 1 : 0),
      turrets: Math.floor(depth * 0.5) + SS.rn2(2)
    };
  };

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
