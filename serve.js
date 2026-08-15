/* Minimal static file server for local development.
 *
 *   node serve.js [port] [--root=<dir>]
 *
 * Serves the same tree GitHub Pages would: index.html is the welcome page and
 * play.html is the game.  Both also open fine straight from the filesystem; a
 * server just makes reloading and devtools friendlier.
 *
 * `--root` exists to rehearse the thing that actually breaks on Pages.  A
 * project site is served from https://user.github.io/<repo>/, not from a
 * domain root, so pointing the server at the *parent* directory and visiting
 * /5space/ reproduces the deployed layout exactly - and any path that only
 * worked because it happened to start at the root shows up immediately.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let port = Number(process.env.PORT || 8125);
let root = __dirname;

args.forEach((a) => {
  if (/^\d+$/.test(a)) port = Number(a);
  else if (a.startsWith('--root=')) root = path.resolve(a.slice('--root='.length));
});

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  /* serve index.html for any directory, the way GitHub Pages does */
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.join(root, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}).listen(port, () => {
  console.log('5Space serving ' + root + ' at http://localhost:' + port + '/');
});
