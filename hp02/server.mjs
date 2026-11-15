import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const publicRoot = new URL('./public/', import.meta.url);
const routes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ...['app', 'session', 'camera'].map(name => [`/${name}.mjs`, [`${name}.mjs`, 'text/javascript; charset=utf-8']]),
  ...['general-sans-400', 'general-sans-600', 'zodiak-700', 'space-mono-400-latin'].map(name => [`/assets/${name}.woff2`, [`assets/${name}.woff2`, 'font/woff2']])
]);
export function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src blob:; media-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const host = `127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== host) { res.writeHead(403).end(); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const route = routes.get(req.url);
    if (!route) { res.writeHead(404).end(); return; }
    try {
      const data = await readFile(new URL(route[0], publicRoot));
      res.writeHead(200, { 'Content-Type': route[1], 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(500).end('Local asset unavailable'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createServer();
  server.on('error', error => { console.error(`HP02 could not start: ${error.code}. Do not stop another owner\u0027s server.`); process.exitCode = 1; });
  server.listen(5609, '127.0.0.1', () => console.log('HP02 local adult capture: http://127.0.0.1:5609 | no uploads or payments'));
}
