import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../ui/recipient.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const elements = Object.fromEntries(['claim-status', 'claim-metadata', 'recheck'].map(id =>
    [id, { textContent: '', hidden: false, disabled: false, addEventListener() {} }]));
  const requests = [];
  const handlers = {};
  const location = { hash: '#first', pathname: '/recipient.html', origin: 'http://127.0.0.1:5608' };
  const context = {
    location,
    history: { replaceState() { location.hash = ''; } },
    document: { getElementById: id => elements[id] },
    window: { addEventListener: (name, handler) => { handlers[name] = handler; } },
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }))
  };
  vm.runInNewContext(source, context);
  return { elements, requests, location, next(token) { location.hash = `#${token}`; handlers.hashchange(); } };
}
const success = id => ({ ok: true, json: async () => ({ participantId: id, control: 'guardian' }) });

test('recipient consumes fragment and sends its captured token only in the POST body', () => {
  const h = harness();
  assert.equal(h.location.hash, '');
  assert.equal(h.requests[0].url, '/api/demo/claim');
  assert.equal(h.requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(h.requests[0].options.body), { token: 'first' });
  h.next('second');
  assert.deepEqual(JSON.parse(h.requests[1].options.body), { token: 'second' });
});

test('stale recipient response cannot expose metadata or unlock a newer pending claim', async () => {
  const h = harness();
  h.next('second');
  h.requests[0].resolve(success('p1'));
  await tick();
  assert.equal(h.elements['claim-metadata'].hidden, true);
  assert.equal(h.elements.recheck.disabled, true);
  h.requests[1].resolve(success('p2'));
  await tick();
  assert.match(h.elements['claim-metadata'].textContent, /p2/);
  assert.equal(h.elements.recheck.disabled, false);
});

test('stale JSON completion cannot overwrite the current recipient', async () => {
  const h = harness();
  let finishJson;
  h.requests[0].resolve({ ok: true, json: () => new Promise(resolve => { finishJson = resolve; }) });
  await tick();
  h.next('second');
  h.requests[1].resolve(success('p2'));
  await tick();
  finishJson({ participantId: 'p1', control: 'self' });
  await tick();
  assert.match(h.elements['claim-metadata'].textContent, /p2/);
  assert.doesNotMatch(h.elements['claim-metadata'].textContent, /p1/);
});

test('stale network failure cannot replace a newer successful claim', async () => {
  const h = harness();
  h.next('second');
  h.requests[1].resolve(success('p2'));
  await tick();
  h.requests[0].reject(new Error('Synthetic network failure'));
  await tick();
  assert.equal(h.elements['claim-metadata'].hidden, false);
  assert.match(h.elements['claim-metadata'].textContent, /p2/);
  assert.equal(h.elements['claim-status'].textContent, 'Acceso de ejemplo válido. Consulta de estado, sin derecho de descarga.');
});
