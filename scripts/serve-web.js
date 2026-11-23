'use strict';
// Petit serveur local pour tester la web-app téléphone : node scripts/serve-web.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'dist-web');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const port = Number(process.argv[2]) || 5173;
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(dir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(port, () => console.log(`Web-app sur http://localhost:${port}/`));
