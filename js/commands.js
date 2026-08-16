/* 5Space - the screens you can open mid-flight.
 *
 * All of these pause the simulation, because they are all things a pilot
 * would be reading rather than doing: the ship readout, the log of greens you
 * have opened, the key guide, and the menu that lets you save and walk away.
 */
(function (SS) {
  'use strict';

  var commands = {};
  SS.commands = commands;

  /* ------------------------------------------------------------------ */
  /* the escape menu                                                    */
  /* ------------------------------------------------------------------ */

  commands.openMenu = async function () {
    var game = SS.game;
    var rows = [
      { letter: 'c', selectable: true, value: 'close', text: 'Back to flight' },
      { text: '  ' + SS.difficulty().name +
        (game.shipsLeft > 1 ? '  -  ' + game.shipsLeft + ' hulls left' : '  -  last hull') },
      { letter: 'i', selectable: true, value: 'ship', text: 'Ship readout' },
      { letter: '\\', selectable: true, value: 'log', text: 'Greens you have opened' },
      { letter: '?', selectable: true, value: 'help', text: 'Controls' },
      { letter: 's', selectable: true, value: 'save', text: 'Save and quit to title' },
      { letter: 'e', selectable: true, value: 'export', text: 'Export this run to a file' },
      { letter: 'Q', selectable: true, value: 'quit', text: 'Abandon the run' }
    ];
    var sel = await SS.hud.menu('Sector ' + game.depth, rows, {
      footerText: '(Esc returns to flight)'
    });
    var choice = sel && sel.length ? sel[0] : 'close';

    switch (choice) {
      case 'ship': await commands.shipReadout(); return commands.openMenu();
      case 'log': await commands.discoveries(); return commands.openMenu();
      case 'help': await commands.help(); return commands.openMenu();
      case 'save':
        if (SS.save.saveGame()) {
          SS.game.stop();
          await SS.main.titleScreen();
        } else {
          SS.msg('The run could not be saved.', '#ff8a6a');
        }
        return;
      case 'export': SS.save.exportToFile(); return commands.openMenu();
      case 'quit': {
        var yn = await SS.hud.yn('Abandon this run? It cannot be resumed.', 'yn', 'n');
        if (yn === 'y') SS.game.quitRun();
        return;
      }
      default: return;
    }
  };

  /* ------------------------------------------------------------------ */
  /* ship readout                                                       */
  /* ------------------------------------------------------------------ */

  /* What the greens have actually built, drawn as bars between the hull's
     factory numbers and its ceiling.  This is the closest thing the game has
     to an inventory screen, and it is the thing you check before deciding
     whether sector 14 is survivable. */
  commands.readoutLines = function (p) {
    var s = SS.ship.settings(p);
    var prog = SS.ship.progress(p);
    var lines = [];

    function bar(label, frac, detail) {
      var width = 20;
      var filled = Math.round(frac * width);
      var b = '[' + '='.repeat(filled) + '.'.repeat(width - filled) + ']';
      lines.push({ text: '  ' + SS.game.padRight(label, 11) + b + '  ' + detail });
    }

    bar('Recharge', prog.recharge, Math.round(SS.physics.rechargeToEnergy(p.stat.recharge)) + '/s');
    bar('Energy', prog.energy, Math.round(p.stat.energyCap));
    bar('Rotation', prog.rotation, (SS.physics.rotationToRev(p.stat.rotation)).toFixed(2) + ' rev/s');
    bar('Thrust', prog.thrust, SS.physics.thrustToAccel(p.stat.thrust).toFixed(1) + ' t/s²');
    bar('Top speed', prog.speed, SS.physics.speedToTiles(p.stat.speed).toFixed(1) + ' t/s');
    bar('Guns', prog.guns, 'L' + p.guns + ' of L' + s.MaximumGuns);
    if (s.MaximumBombs) bar('Bombs', prog.bombs, 'L' + p.bombs + ' of L' + s.MaximumBombs);
    if (s.MaximumMines) lines.push({ text: '  ' + SS.game.padRight('Mines', 11) + 'L' + p.mines + ' of L' + s.MaximumMines });

    lines.push({ text: '' });

    var abilities = [];
    ['cloak', 'stealth', 'xradar', 'antiwarp', 'multifire', 'proximity', 'bouncing'].forEach(function (k) {
      if (p.has[k]) abilities.push(k);
    });
    if (p.stat.shrapnel) abilities.push('shrapnel x' + p.stat.shrapnel);
    lines.push({ text: '  Abilities: ' + (abilities.length ? abilities.join(', ') : 'none yet') });

    var stock = [];
    SS.weapons.UTILITIES.forEach(function (u) {
      var cap = SS.ship.capFor(s, u.key);
      if (!cap) return;
      stock.push(u.label + ' ' + p.count[u.key] + '/' + cap);
    });
    lines.push({ text: '  Stock: ' + (stock.length ? stock.join(', ') : 'this hull carries none') });
    lines.push({ text: '  Bounty: ' + Math.round(p.bounty) +
      '   Energy: ' + Math.round(p.energy) + '/' + Math.round(SS.ship.energyMax(p)) });

    return lines;
  };

  commands.shipReadout = async function () {
    var p = SS.game.player;
    var def = SS.ship.def(p);
    var lines = [];
    lines.push({ text: '  ' + def.blurb });
    lines.push({ text: '' });
    commands.readoutLines(p).forEach(function (l) { lines.push(l); });
    await SS.hud.showText(lines, def.name + '  -  ' + p.name);
  };

  /* ------------------------------------------------------------------ */
  /* the discovery log                                                  */
  /* ------------------------------------------------------------------ */

  commands.discoveries = async function () {
    var game = SS.game;
    var lines = SS.describePrizeLog(game.prizeLog);
    lines.push({ text: '' });
    lines.push({ text: '  ' + game.greensTaken + ' greens opened in ' +
      SS.clockString(game.elapsed) + '.' });
    lines.push({ text: '  Deeper sectors sour the table: one green in ' +
      SS.negativeFactorFor(game.depth) + ' down here takes something away.' });
    await SS.hud.showText(lines, 'Greens');
  };

  /* ------------------------------------------------------------------ */
  /* help                                                               */
  /* ------------------------------------------------------------------ */

  commands.help = async function () {
    var lines = [];
    lines.push({ header: true, text: 'Flying' });
    SS.input.BINDINGS.forEach(function (b) {
      lines.push({ text: '  ' + SS.game.padRight(b[0], 20) + SS.game.padRight(b[1], 28) +
        (b[2] ? '- ' + b[2] : '') });
    });
    lines.push({ text: '' });
    lines.push({ header: true, text: 'The run' });
    [
      'Energy is health, ammunition and afterburner at once. It recharges.',
      'Green diamonds are prizes. You never know which one you are taking.',
      'Some greens are negative, and there are more of them the deeper you go.',
      'Green pads are safe zones: no damage, fast recharge, and a loiter timer.',
      'Purple wells are wormholes. They pull, then they throw you.',
      'The gold ring is the warp portal down. The blue one goes back up.',
      'Sector 26 holds the Prime Flag. Take it and carry it back out through',
      'the blue portal in sector 1. Carrying it makes every sector hostile.'
    ].forEach(function (t) { lines.push({ text: '  ' + t }); });

    lines.push({ text: '' });
    lines.push({ header: true, text: 'This run: ' + SS.difficulty().name });
    if (SS.game.shipsLeft > 1) {
      lines.push({ text: '  ' + SS.game.shipsLeft + ' hulls left. Losing one costs you every green ' +
        'it had collected,' });
      lines.push({ text: '  and drops the Prime Flag back into the Core - but the run goes on.' });
    } else if (SS.difficulty().ships > 1) {
      lines.push({ text: '  Last hull. The next one you lose ends the run.' });
    } else {
      lines.push({ text: '  One hull, no respawn. Dying ends the run and deletes the save.' });
    }
    await SS.hud.showText(lines, '5Space');
  };

})(typeof window !== 'undefined' ? (window.SS = window.SS || {}) : (global.SS = global.SS || {}));
