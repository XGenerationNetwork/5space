/* 5Space - difficulty.
 *
 * The two games this one is made of disagree about exactly one thing, and it
 * is the thing difficulty should be about.  SubSpace kills you constantly and
 * does not care: you respawn, you lose the prizes you were carrying, you go
 * again.  NetHack kills you once.  So the modes are not a damage slider -
 * they are which of the two ancestors is in charge of dying.
 *
 *   Normal  the roguelike answer.  One hull, one run, permadeath.
 *   Easy    SubSpace's own answer.  A wing of five hulls; losing one costs
 *           you every green you had collected, which is penalty enough.
 *
 * Everything else follows from that.  An Easy run meets *more* pilots than a
 * Normal one, not fewer - but much softer ones, closer to hand, that notice
 * you from a shorter distance.  You want a beginner fighting early and often;
 * what you do not want is each fight to be expensive.  So the count goes up
 * and the threat per pilot goes down, and the extra hulls are a cushion
 * rather than five goes at the same wall.
 *
 * Every multiplier is 1 on Normal, and every one of them is applied *after*
 * the random draw it modifies, so a Normal run generates precisely the
 * universe it did before this file existed.
 */
(function (SS) {
  'use strict';

  /* A multiplier that slides from `shallow` at sector 1 to `deep` at the
     Core.  Written as a function so the table stays a table. */
  function byDepth(shallow, deep) {
    return function (depth) {
      var t = SS.clamp(((depth || 1) - 1) / (SS.MAXDEPTH - 1), 0, 1);
      return shallow + (deep - shallow) * t;
    };
  }

  var DIFFICULTIES = {
    easy: {
      key: 'easy',
      name: 'Easy',
      code: 'e',
      blurb: 'A wing of five hulls, and plenty to shoot at. Lose one and you ' +
             'lose everything it was carrying, but the run goes on.',
      hint: 'More pilots than Normal, but far softer ones - so you get the ' +
            'practice without the punishment. Scores count for half.',

      ships: 5,            // hulls per run

      /* Easy has *more* pilots than Normal, not fewer.
       *
       * The first version of this had 0.6, on the reasoning that fewer
       * enemies is easier - which is true and useless.  A sector with a
       * handful of pilots scattered across two hundred and fifty tiles is
       * not gentle, it is empty: you spend the run hunting for something to
       * practise on, and the first real fight you have is the one you were
       * not ready for.  Nobody learns to dogfight in an empty sector.
       *
       * So the difficulty is moved out of the *number* and into the pilots
       * themselves.  There is always something to shoot at, it starts near
       * you, and it is soft enough that losing the exchange costs a slice of
       * energy rather than the hull.
       *
       * The count is depth-aware, because "lots to shoot at" and "a wall of
       * fire" are the same thing at different sector depths.  Sector 1 wants
       * to be crowded with soft targets sitting close by; sector 20 does not,
       * because thirty pilots landing on you at once is not a lesson however
       * weak each one is.  So the crowd thins and backs off as you descend. */
      enemies: byDepth(1.6, 0.75),        // how many pilots a sector launches with
      spawnDistance: byDepth(0.4, 1.0),   // how far from your arrival they start
      enemyPrizes: 0.35,   // how well built they are
      enemySkill: 0.3,     // how straight they shoot and how fast they react

      /* The lever that turns a crowd into a queue.  With a short notice
         range there is always something to fly at, but only the two or three
         nearest ones come for you - so a beginner gets a run of winnable
         single fights instead of one crossfire. */
      enemyDetect: 0.55,   // how far off they notice you
      reinforcements: 0.65,// how long between replacements

      greens: 1.4,         // how thickly prizes are scattered
      negativeGreens: 2.0, // multiplies the "one green in N is bad" figure
      scoreMultiplier: 0.5
    },

    normal: {
      key: 'normal',
      name: 'Normal',
      code: 'n',
      blurb: 'One hull, one run. Dying ends it and deletes the save.',
      hint: 'The game as designed. Twenty-six sectors with no second chances.',

      ships: 1,
      enemies: 1,
      enemyPrizes: 1,
      enemySkill: 1,
      enemyDetect: 1,
      spawnDistance: 1,
      greens: 1,
      negativeGreens: 1,
      reinforcements: 1,
      scoreMultiplier: 1
    }
  };

  SS.DIFFICULTIES = DIFFICULTIES;
  SS.DIFFICULTY_ORDER = ['normal', 'easy'];

  /* The mode in force.  Reads from the run when there is one, so nothing has
     to thread a difficulty argument through the generator. */
  SS.difficulty = function () {
    var key = (SS.game && SS.game.difficulty) || 'normal';
    return DIFFICULTIES[key] || DIFFICULTIES.normal;
  };

  SS.difficultyByKey = function (key) {
    return DIFFICULTIES[key] || DIFFICULTIES.normal;
  };

  /* Read one lever.  Levers are numbers, or functions of the sector depth for
     the ones that have to mean different things at the top and the bottom. */
  SS.diff = function (lever, depth) {
    var v = SS.difficulty()[lever];
    return typeof v === 'function' ? v(depth) : v;
  };

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
