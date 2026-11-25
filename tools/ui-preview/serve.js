'use strict';

// Tiny static file server for previewing the renderer UI in a browser (development only).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const port = Number(process.env.PORT) || 5178;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') {
      res.writeHead(302, { location: '/tools/ui-preview/preview.html' }).end();
      return;
    }
    const file = path.resolve(root, `.${urlPath}`);
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`UI preview on http://127.0.0.1:${port}`));
