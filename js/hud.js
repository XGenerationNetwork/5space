/* 5Space - the parts of the interface that are text.
 *
 * Menus, prompts and the message log live in the DOM on top of the canvas
 * rather than being painted into it, which keeps them selectable, scalable
 * and trivially styleable - and lets the title screen exist before there is
 * a game to draw.
 *
 * The one real departure from 5Hack: there is no --More--.  A turn-based game
 * can stop the world to make you read a line; a real-time one cannot, so
 * messages stack up in a corner and fade out on their own.  Anything truly
 * important opens a menu, which *does* pause the simulation.
 */
(function (SS) {
  'use strict';

  var hud = {};
  SS.hud = hud;

  var overlay, msgbox, banner;
  var overlayOpen = false;

  var messages = [];          // {text, color, at}
  hud.history = [];
  var MESSAGE_LIFE = 7.0;
  var MESSAGE_SHOWN = 7;

  hud.init = function () {
    overlay = document.getElementById('overlay');
    msgbox = document.getElementById('messages');
    banner = document.getElementById('banner');
    document.addEventListener('keydown', onKeyDown, true);
  };

  /* ------------------------------------------------------------------ */
  /* messages                                                           */
  /* ------------------------------------------------------------------ */

  SS.msg = function (text, color) {
    if (!text) return;
    messages.push({ text: text, color: color || null, at: now() });
    hud.history.push(text);
    if (hud.history.length > 250) hud.history.shift();
    if (messages.length > 40) messages.shift();
  };

  /* Something that must not be missed: same log, but it also flashes across
     the middle of the screen for a moment. */
  SS.msgBig = function (text, color) {
    SS.msg(text, color);
    if (!banner) return;
    banner.textContent = text;
    banner.style.color = color || '#ffe08a';
    banner.classList.remove('hidden');
    banner.classList.remove('fade');
    /* restart the animation */
    void banner.offsetWidth;
    banner.classList.add('fade');
  };

  function now() { return Date.now() / 1000; }

  hud.drawMessages = function () {
    if (!msgbox) return;
    var t = now();
    while (messages.length && t - messages[0].at > MESSAGE_LIFE) messages.shift();

    var show = messages.slice(-MESSAGE_SHOWN);
    var html = '';
    for (var i = 0; i < show.length; i++) {
      var m = show[i];
      var age = (t - m.at) / MESSAGE_LIFE;
      var alpha = age > 0.75 ? (1 - age) * 4 : 1;
      html += '<div class="msg" style="opacity:' + alpha.toFixed(2) +
        (m.color ? ';color:' + m.color : '') + '">' + escapeHtml(m.text) + '</div>';
    }
    msgbox.innerHTML = html;
  };

  hud.clearMessages = function () {
    messages.length = 0;
    if (msgbox) msgbox.innerHTML = '';
  };

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  hud.escapeHtml = escapeHtml;

  /* ------------------------------------------------------------------ */
  /* keyboard                                                           */
  /* ------------------------------------------------------------------ */

  /* Prompts consume keys through this queue; when nothing is waiting, the key
     falls through to input.js and the flight controls. */
  var keyResolver = null;
  var keyQueue = [];

  function normalizeKey(e) {
    var k = e.key;
    if (k === undefined) return null;
    if (k === 'Escape' || k === 'Enter' || k === 'Backspace' || k === 'Tab') return k;
    if (k.indexOf('Arrow') === 0) return k;
    if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' ||
        k === 'CapsLock' || k === 'Dead') return null;
    if (k === ' ' || k === 'Spacebar') return ' ';
    if (k.length === 1) {
      if (e.ctrlKey) return '^' + k.toUpperCase();
      return k;
    }
    if (/^F\d+$/.test(k)) return k;
    return null;
  }

  function onKeyDown(e) {
    if (!overlayOpen) return;         // input.js owns the keyboard in flight
    /* a focused text field is typing, not choosing a menu letter */
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey) return;
    if (e.ctrlKey && ['c', 'v', 'r', 'C', 'V', 'R'].indexOf(e.key) >= 0) return;
    var k = normalizeKey(e);
    if (k === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (keyResolver) {
      var r = keyResolver;
      keyResolver = null;
      r(k);
    } else if (keyQueue.length < 8) {
      keyQueue.push(k);
    }
  }

  hud.getKey = function () {
    if (keyQueue.length) return Promise.resolve(keyQueue.shift());
    return new Promise(function (resolve) { keyResolver = resolve; });
  };

  hud.pushKey = function (k) {
    if (keyResolver) { var r = keyResolver; keyResolver = null; r(k); }
    else keyQueue.push(k);
  };

  hud.isOpen = function () { return overlayOpen; };

  /* ------------------------------------------------------------------ */
  /* menus                                                              */
  /* ------------------------------------------------------------------ */

  function buildMenu(title, rows, opts) {
    var div = document.createElement('div');
    div.className = 'menu' + (opts.full ? ' full' : '');
    var html = '';
    if (title) html += '<div class="mtitle">' + escapeHtml(title) + '</div>';
    rows.forEach(function (r, i) {
      if (r.header) {
        html += '<div class="mhead">' + escapeHtml(r.text) + '</div>';
      } else if (r.selectable) {
        html += '<div class="mrow pick" data-i="' + i + '">' +
          '<span class="msel">' + escapeHtml(r.letter) + '</span>' +
          (r.html !== undefined ? r.html : escapeHtml(r.text || '')) + '</div>';
      } else {
        html += '<div class="mrow">' +
          (r.html !== undefined ? r.html : escapeHtml(r.text || '')) + '</div>';
      }
    });
    html += '<div class="mfoot">' + escapeHtml(opts.footerText ||
      '(Choose with a letter, Esc to cancel)') + '</div>';
    div.innerHTML = html;
    return div;
  }

  hud.menu = function (title, rows, opts) {
    opts = opts || {};
    overlay.classList.remove('hidden');
    overlayOpen = true;
    if (hud.releaseTouch) hud.releaseTouch();
    keyQueue.length = 0;

    var node = buildMenu(title, rows, opts);
    node.addEventListener('click', function (ev) {
      var t = ev.target;
      while (t && t !== node && !(t.dataset && t.dataset.i)) t = t.parentNode;
      if (t && t.dataset && t.dataset.i !== undefined) {
        var row = rows[parseInt(t.dataset.i, 10)];
        if (row && row.selectable) hud.pushKey(row.letter);
      }
    });
    overlay.innerHTML = '';
    overlay.appendChild(node);

    /* Tapping the backdrop is the touch equivalent of Escape - otherwise a
       menu with nothing you want on it has no way out without a keyboard.
       Only the backdrop itself: a tap that lands on the menu is a choice. */
    function backdrop(ev) { if (ev.target === overlay) hud.pushKey('Escape'); }
    overlay.addEventListener('click', backdrop);

    function close(result) {
      overlay.removeEventListener('click', backdrop);
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
      overlayOpen = false;
      return result;
    }

    return (function loop() {
      return hud.getKey().then(function (k) {
        if (k === 'Escape') return close(null);
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].selectable && rows[i].letter === k) return close([rows[i].value]);
        }
        if (opts.anyKeyCloses) return close([]);
        return loop();
      });
    })();
  };

  hud.showText = function (lines, title, footer) {
    overlay.classList.remove('hidden');
    overlayOpen = true;
    if (hud.releaseTouch) hud.releaseTouch();
    keyQueue.length = 0;
    var rows = lines.map(function (l) {
      return typeof l === 'string' ? { text: l } : l;
    });
    overlay.innerHTML = '';
    overlay.appendChild(buildMenu(title, rows, {
      full: true,
      footerText: footer || (hud.isTouchDevice()
        ? '(Tap to continue)' : '(Press any key to continue)')
    }));

    /* A tap counts as the any-key.  Without this every full-screen text
       panel - the help, the ship readout, the score table, and the death
       screen you cannot get past - is a dead end on a phone.  `click` rather
       than a touch event, so scrolling a long panel does not dismiss it. */
    function dismiss() { hud.pushKey(' '); }
    overlay.addEventListener('click', dismiss);

    return hud.getKey().then(function () {
      overlay.removeEventListener('click', dismiss);
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
      overlayOpen = false;
      return null;
    });
  };

  hud.yn = function (prompt, choices, def) {
    choices = choices || 'yn';
    var rows = choices.split('').map(function (c) {
      return { letter: c, selectable: true, value: c, text: labelFor(c) };
    });
    return hud.menu(prompt, rows, { footerText: '(Esc for ' + (def || 'no') + ')' })
      .then(function (sel) {
        return sel && sel.length ? sel[0] : (def || 'n');
      });
  };

  function labelFor(c) {
    if (c === 'y') return 'yes';
    if (c === 'n') return 'no';
    if (c === 'q') return 'cancel';
    return c;
  }

  /* Text entry uses a real <input>.
   *
   * The original drew its own caret and read the keystrokes this module was
   * already intercepting, which works perfectly on a keyboard and traps you
   * completely on a phone: nothing is focused, so no on-screen keyboard ever
   * appears, and the only prompt in the game you cannot skip is the one
   * standing between you and starting a run.
   *
   * A focused input is also the only way to get autocapitalisation, the
   * platform's own editing and a "go" key on the virtual keyboard.  The field
   * is deliberately large and obviously tappable, because a browser may
   * refuse to focus it without a fresh user gesture - in which case the
   * player taps it and the keyboard appears anyway. */
  hud.getLine = function (prompt, maxLen) {
    maxLen = maxLen || 40;
    overlay.classList.remove('hidden');
    overlayOpen = true;
    if (hud.releaseTouch) hud.releaseTouch();
    keyQueue.length = 0;

    overlay.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'menu';
    box.innerHTML =
      '<div class="mtitle">' + escapeHtml(prompt) + '</div>' +
      '<form class="entryform" autocomplete="off">' +
        '<input class="entryinput" type="text" maxlength="' + maxLen + '" ' +
          'autocomplete="off" autocorrect="off" autocapitalize="words" ' +
          'spellcheck="false" enterkeyhint="go" aria-label="' + escapeHtml(prompt) + '">' +
        '<div class="entrybtns">' +
          '<button type="submit" class="ebtn ok">OK</button>' +
          '<button type="button" class="ebtn cancel">Cancel</button>' +
        '</div>' +
      '</form>' +
      '<div class="mfoot">(Enter to accept, Esc to cancel)</div>';
    overlay.appendChild(box);

    var input = box.querySelector('.entryinput');
    var form = box.querySelector('.entryform');

    return new Promise(function (resolve) {
      function close(result) {
        /* blur first, or the on-screen keyboard outlives the prompt */
        try { input.blur(); } catch (e) { /* ignore */ }
        overlay.classList.add('hidden');
        overlay.innerHTML = '';
        overlayOpen = false;
        resolve(result);
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        close(input.value.trim());
      });
      box.querySelector('.cancel').addEventListener('click', function (e) {
        e.preventDefault();
        close(null);
      });
      /* keystrokes belong to the field, not to the menu key handler */
      input.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
      });

      /* Tapping beside the field blurs it, and then Enter and Escape have
         nowhere to go - so any tap on the prompt puts the caret back. */
      overlay.addEventListener('mousedown', function (e) {
        if (e.target !== input && !e.target.classList.contains('ebtn')) {
          e.preventDefault();
          focusSoon(input);
        }
      });

      focusSoon(input);
    });
  };

  /* Ask for focus now and once more on the next frame.  Some mobile browsers
     ignore a focus() that lands too far from the gesture that caused it; the
     retry costs nothing and catches the common case where the first attempt
     was a fraction too early. */
  function focusSoon(el) {
    function go() {
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }
    go();
    window.setTimeout(go, 50);
  }

  /* ------------------------------------------------------------------ */
  /* on-screen controls                                                 */
  /* ------------------------------------------------------------------ */

  /* A real-time ship needs three things held at once - turning, thrusting and
     firing - so the controls are two thumb zones rather than a row of
     buttons, and they are driven by pointer events with per-pointer tracking.
     A single pressed/released listener per button cannot express "this thumb
     slid from turn-left onto thrust", which is most of how anyone actually
     flies with a d-pad.

     Held controls carry `data-hold` and map to a virtual key.  Everything
     else carries `data-act` and names a game action directly. */

  var touchLayer = null;
  var gearPanel = null;
  var holdCounts = {};        // hold name -> how many pointers are on it
  var pointerHold = {};       // pointerId -> hold name currently under it

  /* left thumb: turn and thrust.  right thumb: fire, bomb, afterburner. */
  var PADS = [
    { cls: 'tpad-left', buttons: [
      { hold: 'ArrowUp', label: '▲', cls: 'up', hint: 'thrust' },
      { hold: 'ArrowLeft', label: '◀', cls: 'left', hint: 'turn' },
      { hold: 'ArrowRight', label: '▶', cls: 'right', hint: 'turn' },
      { hold: 'ArrowDown', label: '▼', cls: 'down', hint: 'reverse' }
    ] },
    { cls: 'tpad-right', buttons: [
      { hold: 'Control', label: 'FIRE', cls: 'fire' },
      { act: 'bomb', label: 'BOMB', cls: 'bomb' },
      { hold: 'Boost', label: 'BOOST', cls: 'boost' }
    ] }
  ];

  /* The rest of the command set, behind a toggle so it is available without
     eating the screen.  Order follows how often you reach for them. */
  var GEAR = [
    { act: 'burst', label: 'Burst' },
    { act: 'repel', label: 'Repel' },
    { act: 'decoy', label: 'Decoy' },
    { act: 'thor', label: 'Thor' },
    { act: 'brick', label: 'Brick' },
    { act: 'rocket', label: 'Rocket' },
    { act: 'mine', label: 'Mine' },
    { act: 'portal', label: 'Portal' },
    { act: 'warp', label: 'Warp' },
    { act: 'multifire', label: 'Multi' },
    { act: 'stealth', label: 'Stealth' },
    { act: 'cloak', label: 'Cloak' },
    { act: 'xradar', label: 'X-Radar' },
    { act: 'antiwarp', label: 'AntiWarp' },
    { act: 'shipinfo', label: 'Ship' },
    { act: 'discoveries', label: 'Greens' }
  ];

  hud.isTouchDevice = function () {
    if (/[?&]touch=1/.test(location.search)) return true;    // forced, for testing
    if (/[?&]touch=0/.test(location.search)) return false;
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  };

  hud.setupTouch = function () {
    touchLayer = document.getElementById('touch');
    if (!touchLayer) return;
    /* Offered on any device that reports touch, including touch laptops -
       there is no cost to a control layer nobody presses.  ?touch=1 forces it
       on anywhere, which is how it gets tested from a desktop. */
    if (!hud.isTouchDevice()) return;

    build();
    touchLayer.classList.remove('hidden');
    document.body.classList.add('touch');

    /* Portrait works, but this is a game about seeing what is coming. */
    if (window.innerHeight > window.innerWidth) {
      SS.msg('Turn your device sideways for a much wider view.', '#9fd6ff');
    }

    document.addEventListener('pointerdown', onPointerDown, { passive: false });
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp, { passive: false });
    document.addEventListener('pointercancel', onPointerUp, { passive: false });
    /* a long press on a control should not offer to select or search it */
    touchLayer.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    hud.layoutTouch();
    window.addEventListener('resize', hud.layoutTouch);
    window.addEventListener('orientationchange', hud.layoutTouch);
  };

  function build() {
    var html = '';
    PADS.forEach(function (pad) {
      html += '<div class="tpad ' + pad.cls + '">';
      pad.buttons.forEach(function (b) {
        html += '<button class="tbtn ' + (b.cls || '') + '"' +
          (b.hold ? ' data-hold="' + b.hold + '"' : '') +
          (b.act ? ' data-act="' + b.act + '"' : '') +
          '>' + b.label + '</button>';
      });
      html += '</div>';
    });

    html += '<div class="ttop">' +
      '<button class="tbtn small" data-hold="Alt">MAP</button>' +
      '<button class="tbtn small" id="tgear">GEAR</button>' +
      '<button class="tbtn small" data-act="menu">☰</button>' +
      '</div>';

    html += '<div class="tgear-panel hidden" id="tgearpanel">';
    GEAR.forEach(function (g) {
      html += '<button class="tbtn gear" data-act="' + g.act + '">' +
        escapeHtml(g.label) + '</button>';
    });
    html += '</div>';

    touchLayer.innerHTML = html;
    gearPanel = document.getElementById('tgearpanel');

    document.getElementById('tgear').addEventListener('click', function (e) {
      e.preventDefault();
      gearPanel.classList.toggle('hidden');
    });
  }

  /* Portrait on a phone leaves very little room between the two thumb zones,
     so the controls shrink rather than overlap. */
  hud.layoutTouch = function () {
    if (!touchLayer || touchLayer.classList.contains('hidden')) return;
    var w = window.innerWidth, h = window.innerHeight;
    var compact = Math.min(w, h) < 420 || h < 480;
    touchLayer.classList.toggle('compact', compact);
    /* tell the renderer how much of the bottom of the screen is thumbs */
    if (SS.render && SS.render.setInsets) {
      var pad = touchLayer.querySelector('.tpad-left');
      var rect = pad ? pad.getBoundingClientRect() : null;
      SS.render.setInsets({
        controls: true,
        top: 0,
        bottom: rect ? Math.round(rect.height + 18) : 0,
        gutter: rect ? Math.round(rect.width + 20) : 0
      });
    }
  };

  /* ---- pointer plumbing ------------------------------------------------ */

  function controlAt(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el || !el.closest) return null;
    return el.closest('.tbtn');
  }

  function press(name) {
    holdCounts[name] = (holdCounts[name] || 0) + 1;
    if (holdCounts[name] === 1) SS.input.setVirtual(name, true);
  }

  function release(name) {
    if (!holdCounts[name]) return;
    holdCounts[name]--;
    if (holdCounts[name] <= 0) {
      delete holdCounts[name];
      SS.input.setVirtual(name, false);
    }
  }

  /* The pointer stays tracked even when it is over nothing, so a thumb that
     wanders off the pad mid-turn can wander back on again.  Forgetting it the
     moment it left meant the finger was dead until you lifted it. */
  function setPointerHold(id, name) {
    var current = pointerHold[id] || null;
    if (current === name && (id in pointerHold)) return;
    if (current) release(current);
    pointerHold[id] = name;          // may be null: tracked, holding nothing
    if (name) press(name);
  }

  function forgetPointer(id) {
    if (!(id in pointerHold)) return;
    setPointerHold(id, null);
    delete pointerHold[id];
  }

  function onPointerDown(e) {
    if (hud.isOpen()) return;
    var btn = controlAt(e.clientX, e.clientY);
    if (!btn) return;
    e.preventDefault();
    btn.classList.add('lit');
    if (btn.dataset.act) {
      SS.input.pushAction(btn.dataset.act);
      window.setTimeout(function () { btn.classList.remove('lit'); }, 110);
      return;
    }
    if (btn.dataset.hold) setPointerHold(e.pointerId, btn.dataset.hold);
  }

  function onPointerMove(e) {
    /* only tracks pointers that started on a held control, so dragging on the
       map does not start steering the ship */
    if (!(e.pointerId in pointerHold)) return;
    e.preventDefault();
    var btn = controlAt(e.clientX, e.clientY);
    var name = btn && btn.dataset.hold ? btn.dataset.hold : null;
    setPointerHold(e.pointerId, name);
    paintLit();
  }

  function onPointerUp(e) {
    if (e.pointerId in pointerHold) {
      e.preventDefault();
      forgetPointer(e.pointerId);
    }
    paintLit();
  }

  function paintLit() {
    if (!touchLayer) return;
    var btns = touchLayer.querySelectorAll('[data-hold]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('lit', !!holdCounts[btns[i].dataset.hold]);
    }
  }

  /* Releasing everything matters more here than on a keyboard: a thumb lifted
     during a menu never produces a pointerup on the button. */
  hud.releaseTouch = function () {
    Object.keys(pointerHold).forEach(forgetPointer);
    holdCounts = {};
    paintLit();
  };

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
