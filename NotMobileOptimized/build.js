/* Bundle 5Space into a single self-contained HTML file.
 *   node build.js [output.html]
 * The result has no external references at all, so it can be emailed, dropped
 * on a USB stick, or opened straight off the filesystem. */
'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const out = process.argv[2] || path.join(root, '5space.html');

/* play.html is the game shell; index.html is the landing page */
const html = fs.readFileSync(path.join(root, 'play.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

/* Pull the script list out of play.html so the two can never drift apart. */
const scripts = [];
const scriptRe = /<script src="([^"]+)"><\/script>/g;
let m;
while ((m = scriptRe.exec(html)) !== null) scripts.push(m[1]);

const js = scripts
  .map((src) => {
    const body = fs.readFileSync(path.join(root, src), 'utf8');
    return '/* ===== ' + src + ' ===== */\n' + body;
  })
  .join('\n');

/* Replacer FUNCTIONS, not replacement strings: the game source contains "$&"
   and similar sequences that String.replace would otherwise expand as special
   replacement patterns. */
let bundled = html
  .replace('<link rel="stylesheet" href="css/style.css">',
           () => '<style>\n' + css + '\n</style>')
  .replace(/<!-- Classic scripts[\s\S]*?<\/script>\s*(?=<\/body>)/,
           () => '<script>\n' + js + '\n</script>\n');

/* belt and braces: strip any script tag that still points at a file */
bundled = bundled.replace(/<script src="[^"]+"><\/script>\s*/g, '');

fs.writeFileSync(out, bundled, 'utf8');

const kb = (Buffer.byteLength(bundled, 'utf8') / 1024).toFixed(0);
console.log('Wrote ' + path.relative(root, out) + ' (' + kb + 'KB, ' +
  scripts.length + ' scripts inlined)');

/* Nothing may point outside the file. data: URIs are inline, so they are fine. */
const external = bundled.match(/(?:src|href)="(?!data:|#)[^"]*"/g) || [];
if (external.length) {
  console.error('WARNING: the bundle still references external files:');
  external.forEach((r) => console.error('  ' + r));
  process.exit(1);
}
