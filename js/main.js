/* 5Space - startup: the title screen, picking a hull, and the entry point. */
(function (SS) {
  'use strict';

  var main = {};
  SS.main = main;

  var LOGO = [
    '  ______  ____                                ',
    ' /      \\/    \\                               ',
    '|  $$$$$$|  $$$$$ ______   ____  _______  ___ ',
    '| $$____ \\$$    \\|      \\ /    \\/       \\/   \\',
    ' \\$$    \\  \\$$$$$|  $$$$$|  $$$$|  $$$$$$|  $$',
    ' _\\$$$$$$      \\$| $$  $$| $$   | $$   $$| $$ ',
    '|  \\__| $|\\__| $$| $$__$$| $$__ | $$$$$$$| $$ ',
    ' \\$$    $$\\$$   $$\\$$    $$\\$$  $$\\$$    $$\\$$ ',
    '  \\$$$$$$  \\$$$$$  \\$$$$$$$ \\$$$$  \\$$$$$$ \\$$ '
  ];

  main.titleScreen = async function () {
    SS.game.started = false;
    SS.hud.clearMessages();
    SS.input.clear();

    var info = SS.save.saveInfo();
    var rows = [];
    LOGO.forEach(function (l) {
      rows.push({ html: '<span class="logo">' + SS.hud.escapeHtml(l) + '</span>' });
    });
    rows.push({ text: '' });
    rows.push({ text: '  A SubSpace roguelike, version ' + SS.VERSION });
    rows.push({ text: '  Twenty-six sectors down, take the Prime Flag, fly it back out.' });
    rows.push({ text: '' });

    if (info) {
      var where = 'sector ' + info.depth + (info.hasFlag ? ', carrying the Flag' : '');
      rows.push({
        letter: 'c', selectable: true, value: 'continue',
        html: '<span class="hi">Continue</span> &mdash; ' + SS.hud.escapeHtml(
          info.name + ' in a ' + (SS.SHIPS[info.ship] ? SS.SHIPS[info.ship].name : info.ship) +
          ', ' + where + ' (' + SS.clockString(info.elapsed) + ')' +
          (info.difficulty === 'normal' ? '' :
            '  [' + SS.difficultyByKey(info.difficulty).name +
            (info.shipsLeft > 1 ? ', ' + info.shipsLeft + ' hulls' : ', last hull') + ']'))
      });
    }
    rows.push({ letter: 'n', selectable: true, value: 'new', text: 'New run' });
    rows.push({ letter: 'r', selectable: true, value: 'random', text: 'New run, random hull' });
    rows.push({ letter: 'i', selectable: true, value: 'import', text: 'Import a run from a file' });
    if (info) rows.push({ letter: 'e', selectable: true, value: 'export', text: 'Export the saved run' });
    rows.push({ letter: 's', selectable: true, value: 'scores', text: 'Top scores' });
    rows.push({ letter: '?', selectable: true, value: 'help', text: 'How to play' });

    var sel = await SS.hud.menu('', rows, {
      full: true, footerText: '(Choose with a letter)'
    });
    var choice = sel && sel.length ? sel[0] : null;

    switch (choice) {
      case 'continue':
        if (SS.save.loadGame()) {
          SS.radar.revealAround(SS.game.sector, SS.game.player.x, SS.game.player.y, 24);
          SS.msg('Welcome back, ' + SS.game.player.name + '.');
          SS.game.start();
        } else {
          SS.msg('That saved run could not be loaded.');
          await main.titleScreen();
        }
        return;
      case 'new': await main.newRun(false); return;
      case 'random': await main.newRun(true); return;
      case 'import': {
        var ok = await SS.save.importFromFile();
        if (ok) {
          SS.radar.revealAround(SS.game.sector, SS.game.player.x, SS.game.player.y, 24);
          SS.msg('Run restored.');
          SS.game.start();
        } else {
          await SS.hud.showText([{ text: '  That file could not be read as a 5Space run.' }],
            'Import failed');
          await main.titleScreen();
        }
        return;
      }
      case 'export': SS.save.exportToFile(); await main.titleScreen(); return;
      case 'scores': await SS.game.showScores(); await main.titleScreen(); return;
      case 'help': await SS.commands.help(); await main.titleScreen(); return;
      default: await main.titleScreen(); return;
    }
  };

  /* ------------------------------------------------------------------ */
  /* picking a hull                                                     */
  /* ------------------------------------------------------------------ */

  main.newRun = async function (randomize) {
    var stored = '';
    try { stored = localStorage.getItem('5space.name') || ''; } catch (e) { /* ignore */ }

    var name = null;
    if (!randomize) {
      name = await SS.hud.getLine('Pilot name (Enter for "' + (stored || 'Pilot') + '")', 20);
      if (name === null) { await main.titleScreen(); return; }
    }
    if (!name) name = stored || 'Pilot';
    try { localStorage.setItem('5space.name', name); } catch (e) { /* ignore */ }

    /* Difficulty is asked before the hull, because it changes what the hull
       has to survive.  The last choice is remembered, since most people pick
       one and stay there. */
    var stored_diff = '';
    try { stored_diff = localStorage.getItem('5space.difficulty') || ''; } catch (e) { /* ignore */ }
    var difficulty = SS.difficultyByKey(stored_diff).key;

    if (!randomize) {
      var drows = SS.DIFFICULTY_ORDER.map(function (k) {
        var d = SS.DIFFICULTIES[k];
        return {
          letter: d.code, selectable: true, value: k,
          html: '<span class="shipname">' + SS.hud.escapeHtml(pad(d.name, 9)) + '</span>' +
            '<span class="shipstats">' +
            (d.ships > 1 ? d.ships + ' hulls' : 'one hull, permadeath') + '</span>' +
            '<div class="shipblurb">' + SS.hud.escapeHtml(d.blurb) + '</div>' +
            '<div class="shiphint">' + SS.hud.escapeHtml(d.hint) + '</div>'
        };
      });
      var dsel = await SS.hud.menu('Difficulty', drows, {
        full: true, footerText: '(Choose with a letter, Esc to go back)'
      });
      if (!dsel || !dsel.length) { await main.titleScreen(); return; }
      difficulty = dsel[0];
    }
    try { localStorage.setItem('5space.difficulty', difficulty); } catch (e) { /* ignore */ }

    var keys = SS.shipList();
    var shipKey;

    if (randomize) {
      shipKey = SS.pick(keys);
    } else {
      var rows = [];
      keys.forEach(function (k) {
        var d = SS.SHIPS[k];
        var s = d.settings;
        rows.push({
          letter: d.code, selectable: true, value: k,
          html: '<span class="shipname" style="color:' + d.color + '">' +
            SS.hud.escapeHtml(pad(d.name, 11)) + '</span>' +
            '<span class="shipstats">' +
            'energy ' + pad(s.InitialEnergy + '-' + s.MaximumEnergy, 10) +
            ' guns L' + s.MaximumGuns +
            '  bombs ' + (s.MaximumBombs ? 'L' + s.MaximumBombs : '-') +
            '</span><div class="shipblurb">' + SS.hud.escapeHtml(d.blurb) + '</div>' +
            '<div class="shiphint">' + SS.hud.escapeHtml(d.hint) + '</div>'
        });
      });
      rows.push({ letter: '*', selectable: true, value: '__random', text: 'Pick a hull at random' });

      var sel = await SS.hud.menu('Choosing a hull for ' + name, rows, {
        full: true, footerText: '(Choose with a letter, Esc to go back)'
      });
      if (!sel || !sel.length) { await main.titleScreen(); return; }
      shipKey = sel[0] === '__random' ? SS.pick(keys) : sel[0];
    }

    SS.game.newGame({ name: name, shipKey: shipKey, difficulty: difficulty });
    SS.save.saveGame();
    SS.game.start();
  };

  function pad(s, n) {
    s = String(s);
    while (s.length < n) s += ' ';
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* entry point                                                        */
  /* ------------------------------------------------------------------ */

  main.init = function () {
    SS.hud.init();
    SS.render.init();
    SS.input.init();
    SS.hud.setupTouch();

    window.addEventListener('beforeunload', function () {
      if (SS.game.started && !SS.game.over) SS.save.saveGame();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && SS.game.started && !SS.game.over) SS.save.saveGame();
    });

    main.titleScreen();
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', main.init);
    } else {
      main.init();
    }
  }

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
