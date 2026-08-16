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
 * Two different notions of "a key" are needed here, and conflating them is
 * what makes ships fly themselves into walls:
 *
 *   Held state is keyed by the PHYSICAL key (`event.code`: 'KeyA', 'ShiftLeft').
 *     A physical key is the same key on the way up as it was on the way down,
 *     whatever else is being held.  `event.key` is not: it reports the
 *     *character produced*, so a keydown on A reads 'a' but the matching keyup
 *     while Shift is held reads 'A' - and a held-key map keyed on that never
 *     sees the release.  The key sticks on, and the ship turns forever.  Caps
 *     Lock does the same thing.
 *
 *   One-shot presses are keyed by the character, because that is what they
 *     are about: '?' and '\' are characters a layout produces, not positions.
 *     Letters are folded to lower case so that 'P' and 'p' are one command.
 *
 * Held keys drive flight; one-shots are consumed once by the game loop and
 * then forgotten, so holding Tab does not lay a hundred mines.  Each one-shot
 * also records the modifiers as they were AT THE MOMENT IT WAS PRESSED, so a
 * quick Shift+Tab cannot be read as a plain Tab just because Shift came back
 * up before the next frame.
 */
(function (SS) {
  'use strict';

  var input = {};
  SS.input = input;

  var down = {};              // physical keys currently held, by event.code
  var pressed = {};           // one-shots since the last consume, by character
  var virtualKeys = {};       // touch buttons, by logical name

  /* Keys we take over completely.  Everything else falls through to the
     browser, so Ctrl+R still reloads and F11 still goes full screen. */
  var OWNED = {
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
    Tab: 1, Delete: 1, Home: 1, End: 1, Insert: 1,
    F3: 1, F4: 1, F5: 1, F6: 1, ' ': 1
  };

  /* Logical name -> the physical keys that can satisfy it.  Anything not
     listed is assumed to be its own code (ArrowUp, Tab, Delete, F3 ...). */
  var CODES = {
    w: ['KeyW'], a: ['KeyA'], s: ['KeyS'], d: ['KeyD'],
    Shift: ['ShiftLeft', 'ShiftRight'],
    Control: ['ControlLeft', 'ControlRight'],
    Alt: ['AltLeft', 'AltRight'],
    ' ': ['Space']
  };

  input.init = function () {
    window.addEventListener('keydown', onDown, false);
    window.addEventListener('keyup', onUp, false);
    /* Any time focus leaves, whatever was held is no longer being held, and
       we will never see its keyup.  Without this, alt-tabbing mid-turn leaves
       the ship rotating. */
    window.addEventListener('blur', input.clear);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) input.clear();
    });
  };

  /* The physical key, with a best-effort fallback for anything that somehow
     arrives without a code. */
  function physicalKey(e) {
    if (e.code) return e.code;
    var k = e.key;
    if (!k) return '';
    return k.length === 1 ? 'Key' + k.toUpperCase() : k;
  }

  /* The name a one-shot is filed under: the produced character, with letters
     folded so that Shift or Caps Lock does not create a second command. */
  function pressName(e) {
    var k = e.key;
    if (!k) return '';
    return k.length === 1 ? k.toLowerCase() : k;
  }

  function shouldSwallow(e) {
    if (SS.hud.isOpen()) return false;
    if (e.metaKey) return false;
    /* Ctrl+S is ours - the browser's "save page" dialog is not what anyone
       means by it here.  Every other Ctrl+letter belongs to the browser. */
    if (e.ctrlKey && physicalKey(e) === 'KeyS') return true;
    if (e.ctrlKey && e.key.length === 1) return false;
    return !!OWNED[e.key] || e.key.length === 1 || e.key === 'Alt' || e.key === 'Shift';
  }

  function onDown(e) {
    if (SS.hud.isOpen()) return;      // hud.js owns the keyboard while a menu is up
    if (shouldSwallow(e)) e.preventDefault();

    var code = physicalKey(e);
    if (down[code]) return;           // ignore auto-repeat
    down[code] = true;

    /* Ctrl+S is filed under its own name so that it cannot be confused with
       a bare S, which is backward thrust. */
    var name = (e.ctrlKey && code === 'KeyS') ? '^S' : pressName(e);
    pressed[name] = { shift: !!e.shiftKey, ctrl: !!e.ctrlKey };
  }

  function onUp(e) {
    delete down[physicalKey(e)];
  }

  /* Exposed so the test suite can drive the handlers with event-shaped
     objects; there is no DOM in the harness to dispatch real ones. */
  input.handleKeyDown = onDown;
  input.handleKeyUp = onUp;

  input.setVirtual = function (k, isDown) {
    if (isDown) {
      if (!virtualKeys[k]) {
        pressed[k] = { shift: !!virtualKeys.Shift, ctrl: false };
      }
      virtualKeys[k] = true;
    } else {
      delete virtualKeys[k];
    }
  };

  function held(name) {
    if (virtualKeys[name]) return true;
    var codes = CODES[name];
    if (!codes) return !!down[name];
    for (var i = 0; i < codes.length; i++) {
      if (down[codes[i]]) return true;
    }
    return false;
  }
  input.held = held;

  function shift() { return held('Shift'); }

  /* ------------------------------------------------------------------ */
  /* flight                                                             */
  /* ------------------------------------------------------------------ */

  input.flight = function () {
    return {
      forward: held('ArrowUp') || held('w'),
      backward: held('ArrowDown') || held('s'),
      left: held('ArrowLeft') || held('a'),
      right: held('ArrowRight') || held('d'),
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
    function was(name) { return pressed[name] || null; }
    /* modifiers as they were when the key went down, not as they are now */
    function withShift(name) { var p = pressed[name]; return !!(p && p.shift); }

    if (was('Tab')) out.push(withShift('Tab') ? 'mine' : 'bomb');
    if (was('Delete')) out.push(withShift('Delete') ? 'burst' : 'multifire');
    if (was('Control') && withShift('Control')) out.push('repel');
    if (was(' ') && withShift(' ')) out.push('repel');
    if (was('`')) out.push('repel');
    if (was('Home')) out.push(withShift('Home') ? 'cloak' : 'stealth');
    if (was('End')) out.push(withShift('End') ? 'antiwarp' : 'xradar');
    if (was('Insert')) out.push(withShift('Insert') ? 'portal' : 'warp');
    if (was('F3')) out.push('rocket');
    if (was('F4')) out.push('brick');
    if (was('F5')) out.push('decoy');
    if (was('F6')) out.push('thor');

    /* menu and information keys */
    if (was('Escape')) out.push('menu');
    if (was('?') || was('/')) out.push('help');
    if (was('\\')) out.push('discoveries');
    if (was('p')) out.push('pause');
    if (was('^S')) out.push('save');
    if (was('i')) out.push('shipinfo');

    pressed = {};
    return out;
  };

  input.clear = function () {
    down = {}; pressed = {}; virtualKeys = {};
  };

  /* ------------------------------------------------------------------ */
  /* the key guide                                                      */
  /* ------------------------------------------------------------------ */

  /* One table, used by the in-game help and by the welcome page's control
     list, so the two cannot drift apart. */
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
