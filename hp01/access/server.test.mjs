import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoServer } from '../server.mjs';

test('HTTP loopback origin boundary, API flow, private server files and request limits', async t => {
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const uiRoot = await mkdtemp(join(tmpdir(), 'postal-demo-test-'));
  await writeFile(join(uiRoot, 'index.html'), '<!doctype html><title>Synthetic fixture</title>');
  const server = createDemoServer({ port, uiRoot });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(uiRoot, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${port}`;
  const call = (path, { method = 'GET', headers = {}, data } = {}) => new Promise((resolve, reject) => {
    const request = http.request(`${origin}${path}`, { method, headers }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text,
        json: response.headers['content-type']?.includes('application/json') ? JSON.parse(text) : null }));
    });
    request.on('error', reject);
    request.end(data);
  });
  const post = (path, data) => call(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, data: JSON.stringify(data) });
  assert.equal((await call('/api/demo/health')).json.mode, 'demo');
  assert.equal((await call('/', { headers: { Host: 'attacker.example' } })).status, 403);
  for (const requestOrigin of [undefined, 'null', 'https://attacker.example', 'http://localhost:' + port]) {
    const headers = { 'Content-Type': 'application/json' };
    if (requestOrigin) headers.Origin = requestOrigin;
    assert.equal((await call('/api/demo/batches', { method: 'POST', headers, data: '{}' })).status, 403);
  }
  assert.equal((await call('/api/demo/batches', { method: 'POST', headers: { Origin: origin,
    'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, data: '{}' })).status, 403);
  assert.equal((await call('/api/demo/batches', { method: 'POST', headers: { Origin: origin }, data: '{}' })).status, 415);
  assert.equal((await call('/api/demo/batches', { method: 'POST', headers: { Origin: origin,
    'Content-Type': 'application/json' }, data: '!' })).status, 400);
  assert.equal((await post('/api/demo/batches', { participants: [], padding: 'x'.repeat(9000) })).status, 413);
  const created = await post('/api/demo/batches', { participants: [{ id: 'p1', kind: 'minor' }] });
  assert.equal(created.status, 201);
  const id = created.json.batchId;
  assert.equal((await post(`/api/demo/batches/${id}/links`, {})).status, 409);
  assert.equal((await post(`/api/demo/batches/${id}/consents`, { participantId: 'p1', decision: 'approved', actor: 'self', purpose: 'private-delivery' })).status, 403);
  assert.equal((await post(`/api/demo/batches/${id}/consents`, { participantId: 'p1', decision: 'approved', actor: 'guardian', purpose: 'private-delivery' })).json.status, 'ready');
  const links = await post(`/api/demo/batches/${id}/links`, {});
  assert.equal(links.status, 201);
  const link = links.json.links[0];
  const token = new URL(link.url).hash.slice(1);
  assert.equal((await post('/api/demo/claim', { token })).json.status, 'access-example');
  assert.equal((await post(`/api/demo/batches/${id}/links/${link.linkId}/revoke`, {})).json.status, 'revoked');
  assert.equal((await post('/api/demo/claim', { token })).status, 401);
  assert.equal((await call('/api/demo/claim?token=not-a-secret')).status, 400);
  for (const path of ['/server.mjs', '/access/core.mjs', '/package.json', '/.env', '/%2e%2e/server.mjs', '/%2e%2e%5cserver.mjs']) {
    assert.equal((await call(path)).status, 404, path);
  }
  const page = await call('/');
  assert.equal(page.status, 200);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.equal(page.headers['access-control-allow-origin'], undefined);
  assert.equal(server.address().address, '127.0.0.1');
});
