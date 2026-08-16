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

    function close(result) {
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
    keyQueue.length = 0;
    var rows = lines.map(function (l) {
      return typeof l === 'string' ? { text: l } : l;
    });
    overlay.innerHTML = '';
    overlay.appendChild(buildMenu(title, rows, {
      full: true, footerText: footer || '(Press any key to continue)'
    }));
    return hud.getKey().then(function () {
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

  hud.getLine = function (prompt, maxLen) {
    maxLen = maxLen || 40;
    overlay.classList.remove('hidden');
    overlayOpen = true;
    keyQueue.length = 0;
    var buf = '';

    function draw() {
      overlay.innerHTML = '';
      overlay.appendChild(buildMenu(prompt, [
        { text: '', html: '<span class="entry">' + escapeHtml(buf) + '<span class="caret">_</span></span>' }
      ], { footerText: '(Enter to accept, Esc to cancel)' }));
    }
    draw();

    function close(result) {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
      overlayOpen = false;
      return result;
    }

    return (function loop() {
      return hud.getKey().then(function (k) {
        if (k === 'Escape') return close(null);
        if (k === 'Enter') return close(buf);
        if (k === 'Backspace') buf = buf.slice(0, -1);
        else if (k.length === 1 && buf.length < maxLen) buf += k;
        draw();
        return loop();
      });
    })();
  };

  /* ------------------------------------------------------------------ */
  /* touch controls                                                     */
  /* ------------------------------------------------------------------ */

  /* Enough of a control set to fly with on a tablet.  Flight needs held
     buttons rather than taps, so these set and clear the same virtual key
     state that input.js reads. */
  hud.setupTouch = function () {
    var isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (!isTouch) return;
    var bar = document.getElementById('touchbar');
    if (!bar) return;
    bar.classList.remove('hidden');

    var keys = [
      ['↶', 'ArrowLeft'], ['▲', 'ArrowUp'], ['↷', 'ArrowRight'],
      ['▼', 'ArrowDown'], ['GUN', 'Control'], ['BOMB', 'Tab'],
      ['AB', 'Shift'], ['MAP', 'Alt'], ['☰', 'Escape']
    ];
    keys.forEach(function (k) {
      var b = document.createElement('button');
      b.textContent = k[0];
      function down(e) { e.preventDefault(); SS.input.setVirtual(k[1], true); }
      function up(e) { e.preventDefault(); SS.input.setVirtual(k[1], false); }
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
      b.addEventListener('mousedown', down);
      b.addEventListener('mouseup', up);
      b.addEventListener('mouseleave', up);
      bar.appendChild(b);
    });
  };

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
