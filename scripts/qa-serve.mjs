import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  try { response.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(await readFile(path)); }
  catch { response.writeHead(404).end('Not found'); }
}).listen(5173, '127.0.0.1', () => console.log('Meal UI preview: http://127.0.0.1:5173'));
