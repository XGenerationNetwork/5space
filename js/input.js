/* 5Space - the keyboard.
 *
 * The bindings are Continuum's, key for key, because muscle memory from 1997
 * is a real thing and there is no reason to break it:
 *
 *   arrows          turn and thrust            Shift        afterburner
 *   Ctrl            fire guns                  Tab          fire bomb
 *   Shift+Tab       lay a mine                 Delete       toggle multifire
 *   Shift+Delete    burst                      Shift+Ctrl   repel
 *   Home / Shift+Home   stealth / cloak        End / Shift+End   xradar / antiwarp
 *   Shift+Insert    portal                     F3/F4/F5/F6  rocket/brick/decoy/thor
 *   Alt             whole-sector map           Esc          menu
 *
 * WASD is accepted alongside the arrows and Space alongside Ctrl, because not
 * every keyboard in 2026 has a comfortable Ctrl.
 *
 * Held keys drive flight; everything else is a one-shot that is consumed once
 * by the game loop and then forgotten, so holding Tab does not lay a hundred
 * mines.
 */
(function (SS) {
  'use strict';

  var input = {};
  SS.input = input;

  var down = {};              // physical keys currently held
  var pressed = {};           // one-shots since the last consume
  var virtualKeys = {};       // touch buttons

  /* Keys we take over completely.  Everything else falls through to the
     browser, so Ctrl+R still reloads and F11 still goes full screen. */
  var OWNED = {
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
    Tab: 1, Delete: 1, Home: 1, End: 1, Insert: 1,
    F3: 1, F4: 1, F5: 1, F6: 1, ' ': 1
  };

  input.init = function () {
    window.addEventListener('keydown', onDown, false);
    window.addEventListener('keyup', onUp, false);
    window.addEventListener('blur', function () {
      down = {}; virtualKeys = {};
    });
  };

  function shouldSwallow(e) {
    if (SS.hud.isOpen()) return false;
    /* never eat a browser shortcut that uses a modifier plus a letter */
    if ((e.ctrlKey || e.metaKey) && e.key.length === 1) return false;
    if (e.metaKey) return false;
    return !!OWNED[e.key] || e.key.length === 1 || e.key === 'Alt' || e.key === 'Shift';
  }

  function onDown(e) {
    if (SS.hud.isOpen()) return;      // hud.js owns the keyboard while a menu is up
    var k = e.key;
    if (shouldSwallow(e)) e.preventDefault();
    if (down[k]) return;              // ignore auto-repeat
    down[k] = true;
    pressed[k] = true;
    if (e.shiftKey) pressed['shift+' + k] = true;
  }

  function onUp(e) {
    delete down[e.key];
  }

  input.setVirtual = function (k, isDown) {
    if (isDown) {
      if (!virtualKeys[k]) pressed[k] = true;
      virtualKeys[k] = true;
    } else {
      delete virtualKeys[k];
    }
  };

  function held(k) { return !!down[k] || !!virtualKeys[k]; }
  input.held = held;

  function shift() { return held('Shift'); }

  /* ------------------------------------------------------------------ */
  /* flight                                                             */
  /* ------------------------------------------------------------------ */

  input.flight = function () {
    return {
      forward: held('ArrowUp') || held('w') || held('W'),
      backward: held('ArrowDown') || held('s') || held('S'),
      left: held('ArrowLeft') || held('a') || held('A'),
      right: held('ArrowRight') || held('d') || held('D'),
      afterburner: shift()
    };
  };

  input.firingGun = function () {
    /* Shift+Ctrl is repel, not a burst of gunfire */
    if (shift()) return false;
    return held('Control') || held(' ');
  };

  input.showingMap = function () { return held('Alt'); };

  /* ------------------------------------------------------------------ */
  /* one-shots                                                          */
  /* ------------------------------------------------------------------ */

  /* Returns the list of discrete actions taken since the last call, and
     clears them.  Names match what game.js dispatches on. */
  input.takeActions = function () {
    var out = [];
    var withShift = shift();

    if (pressed.Tab) out.push(withShift ? 'mine' : 'bomb');
    if (pressed.Delete) out.push(withShift ? 'burst' : 'multifire');
    if (pressed.Control || pressed[' ']) { if (withShift) out.push('repel'); }
    if (pressed['`']) out.push('repel');
    if (pressed.Home) out.push(withShift ? 'cloak' : 'stealth');
    if (pressed.End) out.push(withShift ? 'antiwarp' : 'xradar');
    if (pressed.Insert) out.push(withShift ? 'portal' : 'warp');
    if (pressed.F3) out.push('rocket');
    if (pressed.F4) out.push('brick');
    if (pressed.F5) out.push('decoy');
    if (pressed.F6) out.push('thor');

    /* menu and information keys */
    if (pressed.Escape) out.push('menu');
    if (pressed['?'] || pressed['/']) out.push('help');
    if (pressed['\\']) out.push('discoveries');
    if (pressed.p || pressed.P) out.push('pause');
    if (pressed['^S']) out.push('save');
    if (pressed.i || pressed.I) out.push('shipinfo');

    pressed = {};
    return out;
  };

  input.clear = function () {
    down = {}; pressed = {}; virtualKeys = {};
  };

  /* ------------------------------------------------------------------ */
  /* the key guide                                                      */
  /* ------------------------------------------------------------------ */

  /* One table, used by the in-game help and by the landing page's manual, so
     the two cannot drift apart. */
  input.BINDINGS = [
    ['Left / Right', 'turn', 'A and D also work'],
    ['Up / Down', 'thrust forward and back', 'W and S also work'],
    ['Shift', 'afterburner', 'faster, but it eats energy'],
    ['Ctrl or Space', 'fire guns', ''],
    ['Tab', 'fire a bomb', ''],
    ['Shift+Tab', 'lay a mine', 'Shark and Lancaster only'],
    ['Delete', 'toggle multifire', 'if the hull has it'],
    ['Shift+Delete', 'burst', 'bullets in every direction'],
    ['Shift+Ctrl or `', 'repel', 'shoves ships and shots away'],
    ['Home', 'toggle stealth', 'off enemy radar'],
    ['Shift+Home', 'toggle cloak', 'invisible entirely'],
    ['End', 'toggle X-Radar', 'see through walls'],
    ['Shift+End', 'toggle antiwarp', 'stops enemies warping out'],
    ['Insert', 'warp', 'a random jump within the sector'],
    ['Shift+Insert', 'drop or use a portal', ''],
    ['F3 F4 F5 F6', 'rocket, brick, decoy, thor', ''],
    ['Alt', 'whole-sector map', 'hold it down'],
    ['I', 'ship readout', 'what the greens have built'],
    ['\\', 'greens you have opened', 'the discovery log'],
    ['P', 'pause', ''],
    ['Ctrl+S', 'save without leaving', ''],
    ['Esc', 'menu', 'save and quit lives here'],
    ['?', 'this list', '']
  ];

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
