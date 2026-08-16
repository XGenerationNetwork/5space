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
 * Everything else follows from that: an Easy run also meets fewer and worse
 * pilots, finds more greens and fewer bad ones, and is chased less hard - so
 * that the extra hulls are a cushion rather than five goes at the same wall.
 *
 * Every multiplier is 1 on Normal, and every one of them is applied *after*
 * the random draw it modifies, so a Normal run generates precisely the
 * universe it did before this file existed.
 */
(function (SS) {
  'use strict';

  var DIFFICULTIES = {
    easy: {
      key: 'easy',
      name: 'Easy',
      code: 'e',
      blurb: 'A wing of five hulls. Lose one and you lose everything it was ' +
             'carrying, but the run goes on.',
      hint: 'Fewer and softer pilots, kinder greens, a slower hunt. ' +
            'Scores count for half.',

      ships: 5,            // hulls per run
      enemies: 0.6,        // how many pilots a sector launches with
      enemyPrizes: 0.6,    // how well built they are
      enemySkill: 0.55,    // how straight they shoot and how fast they react
      greens: 1.4,         // how thickly prizes are scattered
      negativeGreens: 2.0, // multiplies the "one green in N is bad" figure
      reinforcements: 1.8, // how long between replacements
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

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
