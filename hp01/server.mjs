import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDemoStore, DemoError } from './access/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.ico': 'image/x-icon' };

export function createDemoServer({ port = 5608, store = createDemoStore({ origin: `http://127.0.0.1:${port}` }),
  uiRoot = resolve(here, 'ui') } = {}) {
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  const body = async req => {
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      throw new DemoError(415, 'JSON_REQUIRED', 'Use application/json for this demo.');
    }
    if (req.headers['content-encoding']) throw new DemoError(415, 'ENCODING_UNSUPPORTED', 'Encoded bodies are unsupported.');
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) throw new DemoError(413, 'BODY_TOO_LARGE', 'Demo requests are limited to 8 KiB.');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new DemoError(400, 'INVALID_JSON', 'Provide a JSON object.'); }
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    // Existing reviewed prototype uses inline CSS and scripts. No external resources.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    try {
      if (req.headers.host !== host) throw new DemoError(403, 'LOOPBACK_ONLY', 'Use the exact local demo address.');
      const url = new URL(req.url, origin);
      if (url.origin !== origin) throw new DemoError(403, 'LOOPBACK_ONLY', 'Use the exact local demo address.');
      if (req.method === 'POST' && (req.headers.origin !== origin
          || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin'))) {
        throw new DemoError(403, 'ORIGIN_REQUIRED', 'Mutations require the same-origin local demo page.');
      }
      if (url.pathname.startsWith('/api/')) {
        if (url.search) throw new DemoError(400, 'NO_QUERY', 'Do not place demo tokens or fields in query strings.');
        if (req.method === 'GET' && url.pathname === '/api/demo/health') {
          return json(res, 200, { mode: 'demo', status: 'ok' });
        }
        const match = url.pathname.match(/^\/api\/demo\/batches\/([0-9a-f-]{36})(?:\/(consents|links|reset)(?:\/([0-9a-f-]{36})\/(revoke))?)?$/);
        if (req.method === 'GET' && match && !match[2]) return json(res, 200, store.read(match[1]));
        if (req.method !== 'POST') throw new DemoError(405, 'METHOD_NOT_ALLOWED', 'Use a documented demo method.');
        const input = await body(req);
        if (url.pathname === '/api/demo/batches') return json(res, 201, store.create(input));
        if (url.pathname === '/api/demo/claim') return json(res, 200, store.claim(input));
        if (match) {
          const [, id, action, linkId, revoke] = match;
          if (action === 'consents' && !linkId) return json(res, 200, store.consent(id, input));
          if (action === 'links' && !linkId) return json(res, 201, await store.issue(id, input));
          if (action === 'links' && linkId && revoke) return json(res, 200, store.revoke(id, linkId, input));
          if (action === 'reset' && !linkId) return json(res, 200, store.reset(id, input));
        }
        throw new DemoError(404, 'NOT_FOUND', 'Unknown demo endpoint.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new DemoError(405, 'METHOD_NOT_ALLOWED', 'Static files are read only.');
      let decoded;
      try { decoded = decodeURIComponent(url.pathname); }
      catch { throw new DemoError(400, 'INVALID_PATH', 'Invalid path.'); }
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(p => p.startsWith('.'))) {
        throw new DemoError(404, 'NOT_FOUND', 'Not found.');
      }
      const file = resolve(uiRoot, `.${decoded === '/' ? '/index.html' : decoded}`);
      const inside = (root, target) => { const rel = relative(root, target); return rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel); };
      if (!inside(uiRoot, file) || !types[extname(file)]) throw new DemoError(404, 'NOT_FOUND', 'Not found.');
      let resolvedFile;
      try {
        resolvedFile = await realpath(file);
        const resolvedRoot = await realpath(uiRoot);
        if (!inside(resolvedRoot, resolvedFile) || !(await stat(resolvedFile)).isFile()) throw new Error();
      } catch { throw new DemoError(404, 'NOT_FOUND', 'Not found.'); }
      const data = await readFile(resolvedFile);
      res.writeHead(200, { 'Content-Type': types[extname(file)], 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      const known = error instanceof DemoError;
      json(res, known ? error.status : 500, { mode: 'demo', error: {
        code: known ? error.code : 'DEMO_ERROR', message: known ? error.message : 'The local demo could not complete the request.' } });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 30;
  server.maxRequestsPerSocket = 100;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createDemoServer();
  server.listen(5608, '127.0.0.1', () => console.log('Postal Mundial DEMO: http://127.0.0.1:5608 | synthetic memory-only examples'));
}
