import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import { createDemoStore, DemoError } from './core.mjs';

const make = (store, kinds = ['adult', 'minor', 'uncertain']) => store.create({
  participants: kinds.map((kind, i) => ({ id: `p${i + 1}`, kind })) });
const approve = (store, batch) => batch.participants.forEach(p => store.consent(batch.batchId, {
  participantId: p.id, decision: 'approved', actor: p.kind === 'adult' ? 'self' : 'guardian', purpose: 'private-delivery' }));
const token = link => new URL(link.url).hash.slice(1);
const throwsCode = (fn, code) => assert.throws(fn, error => error instanceof DemoError && error.code === code);

test('all people start pending, with no default or omitted guardian approval', async () => {
  const store = createDemoStore();
  const batch = make(store);
  assert.equal(batch.status, 'blocked');
  assert.ok(batch.participants.every(p => p.consent.decision === 'pending'));
  await assert.rejects(store.issue(batch.batchId, {}), { code: 'CONSENT_REQUIRED' });
  for (const [participantId, actor] of [['p2', 'self'], ['p3', 'self'], ['p2', undefined], ['p1', 'guardian']]) {
    throwsCode(() => store.consent(batch.batchId, { participantId, decision: 'approved', actor,
      purpose: 'private-delivery' }), 'ACTOR_REQUIRED');
  }
  throwsCode(() => store.consent(batch.batchId, { participantId: 'p1', decision: '', actor: 'self',
    purpose: 'private-delivery' }), 'INVALID_CONSENT');
  throwsCode(() => store.consent(batch.batchId, { participantId: 'p1', decision: 'approved', actor: 'self',
    purpose: 'marketing' }), 'INVALID_CONSENT');
  store.consent(batch.batchId, { participantId: 'p1', decision: 'approved', actor: 'self', purpose: 'private-delivery' });
  assert.equal(store.read(batch.batchId).status, 'blocked');
  approve(store, batch);
  assert.equal(store.read(batch.batchId).status, 'ready');
});

test('unique random per-person tokens, individual claims, QR payload, sanitized GET', async () => {
  const store = createDemoStore();
  const batch = make(store);
  approve(store, batch);
  const { links } = await store.issue(batch.batchId, {});
  assert.equal(new Set(links.map(token)).size, 3);
  assert.deepEqual(links.map(l => l.control), ['self', 'guardian', 'guardian']);
  for (const link of links) {
    assert.equal(Buffer.from(token(link), 'base64url').length, 32);
    assert.match(link.qrSvg, /^<svg/);
    assert.equal(link.qrSvg, await QRCode.toString(link.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 240 }));
    const qr = QRCode.create(link.url, { errorCorrectionLevel: 'M' });
    const decodedSegments = qr.segments.map(segment => typeof segment.data === 'string'
      ? segment.data : Buffer.from(segment.data).toString('utf8')).join('');
    assert.equal(decodedSegments, link.url);
    assert.deepEqual(store.claim({ token: token(link) }), store.claim({ token: token(link) }));
    assert.equal(store.claim({ token: token(link) }).participantId, link.participantId);
    assert.equal(store.claim({ token: token(link) }).batchId, batch.batchId);
    assert.equal(store.claim({ token: token(link) }).control, link.participantId === 'p1' ? 'self' : 'guardian');
    assert.ok(!JSON.stringify(store.read(batch.batchId)).includes(token(link)));
  }
  const exposed = JSON.stringify(store.read(batch.batchId));
  assert.ok(!exposed.includes('tokenHash') && !exposed.includes('links'));
});

test('unknown participants, immutable scope and batch substitution rejected', async () => {
  const store = createDemoStore();
  const one = make(store, ['adult']);
  const two = make(store, ['minor']);
  approve(store, one);
  approve(store, two);
  const [link] = (await store.issue(one.batchId, {})).links;
  throwsCode(() => store.consent(one.batchId, { participantId: 'p2', decision: 'approved', actor: 'self',
    purpose: 'private-delivery' }), 'UNKNOWN_PARTICIPANT');
  throwsCode(() => store.revoke(two.batchId, link.linkId, {}), 'UNKNOWN_LINK');
  throwsCode(() => store.claim({ token: token(link), batchId: two.batchId }), 'INVALID_INPUT');
  throwsCode(() => store.claim({ token: token(link), participantId: 'p2' }), 'INVALID_INPUT');
  throwsCode(() => store.read('unknown'), 'UNKNOWN_BATCH');
  assert.equal(store.claim({ token: token(link) }).batchId, one.batchId);
});

test('single revoke leaves others valid, denial revokes entire batch', async () => {
  const store = createDemoStore();
  const batch = make(store);
  approve(store, batch);
  const { links } = await store.issue(batch.batchId, {});
  store.revoke(batch.batchId, links[0].linkId, {});
  throwsCode(() => store.claim({ token: token(links[0]) }), 'INVALID_LINK');
  assert.equal(store.claim({ token: token(links[1]) }).status, 'access-example');
  store.consent(batch.batchId, { participantId: 'p3', decision: 'denied', actor: 'guardian', purpose: 'private-delivery' });
  assert.equal(store.read(batch.batchId).status, 'blocked');
  for (const link of links) throwsCode(() => store.claim({ token: token(link) }), 'INVALID_LINK');
  await assert.rejects(store.issue(batch.batchId, {}), { code: 'CONSENT_REQUIRED' });
  approve(store, batch);
  for (const link of links) throwsCode(() => store.claim({ token: token(link) }), 'INVALID_LINK');
  const fresh = (await store.issue(batch.batchId, {})).links;
  assert.equal(store.claim({ token: token(fresh[0]) }).status, 'access-example');
  for (const link of links) throwsCode(() => store.claim({ token: token(link) }), 'INVALID_LINK');
});

test('reset irrevocable, new issuance invalidates previous links', async () => {
  const store = createDemoStore();
  const batch = make(store, ['adult']);
  approve(store, batch);
  const old = (await store.issue(batch.batchId, {})).links[0];
  const fresh = (await store.issue(batch.batchId, {})).links[0];
  throwsCode(() => store.claim({ token: token(old) }), 'INVALID_LINK');
  assert.notEqual(token(old), token(fresh));
  assert.equal(store.reset(batch.batchId, {}).reset, true);
  throwsCode(() => store.claim({ token: token(fresh) }), 'INVALID_LINK');
  throwsCode(() => approve(store, batch), 'BATCH_RESET');
  await assert.rejects(store.issue(batch.batchId, {}), { code: 'BATCH_RESET' });
});

test('token expiry boundary, batch expiry, and bounded synthetic input', async () => {
  let clock = 0;
  const store = createDemoStore({ now: () => clock, tokenTtlMs: 1000, batchTtlMs: 2000, maxBatches: 1 });
  const batch = make(store, ['adult']);
  approve(store, batch);
  const link = (await store.issue(batch.batchId, {})).links[0];
  clock = 999;
  assert.equal(store.claim({ token: token(link) }).status, 'access-example');
  clock = 1000;
  throwsCode(() => store.claim({ token: token(link) }), 'INVALID_LINK');
  throwsCode(() => make(store), 'DEMO_CAPACITY');
  clock = 2000;
  throwsCode(() => store.read(batch.batchId), 'UNKNOWN_BATCH');
  assert.equal(make(store).status, 'blocked');
  throwsCode(() => store.create({ participants: [] }), 'INVALID_PARTICIPANTS');
  throwsCode(() => store.create({ participants: Array.from({ length: 7 }, (_, i) => ({ id: `p${i + 1}`, kind: 'adult' })) }), 'INVALID_PARTICIPANTS');
  throwsCode(() => store.create({ participants: [{ id: 'Actual Person', kind: 'adult' }] }), 'INVALID_PARTICIPANT');
  throwsCode(() => store.create({ participants: [{ id: 'p1', kind: 'adult', name: 'No personal data' }] }), 'INVALID_INPUT');
  throwsCode(() => store.create({ participants: [{ id: 'p1', kind: 'adult' }, { id: 'p1', kind: 'adult' }] }), 'INVALID_PARTICIPANT');
  throwsCode(() => store.claim({ token: 'bad' }), 'INVALID_LINK');
  throwsCode(() => store.claim({ token: 'A'.repeat(43) }), 'INVALID_LINK');
});

test('revocation during asynchronous QR generation cannot produce valid links', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const store = createDemoStore({ encodeQr: async () => { await gate; return '<svg/>'; } });
  const batch = make(store, ['adult']);
  approve(store, batch);
  const pending = store.issue(batch.batchId, {});
  store.reset(batch.batchId, {});
  release();
  await assert.rejects(pending, { code: 'BATCH_CHANGED' });
});

test('encoder failure revokes prior issuance and creates no partially active grant', async () => {
  let shouldFail = false;
  const store = createDemoStore({ encodeQr: async () => {
    if (shouldFail) throw new Error('Synthetic encoder failure');
    return '<svg/>';
  } });
  const batch = make(store, ['adult', 'minor']);
  approve(store, batch);
  const old = (await store.issue(batch.batchId, {})).links;
  shouldFail = true;
  await assert.rejects(store.issue(batch.batchId, {}), /Synthetic encoder failure/);
  for (const link of old) throwsCode(() => store.claim({ token: token(link) }), 'INVALID_LINK');
  assert.equal(store.read(batch.batchId).status, 'ready');
  shouldFail = false;
  const fresh = (await store.issue(batch.batchId, {})).links;
  assert.equal(fresh.length, 2);
  assert.equal(store.claim({ token: token(fresh[1]) }).control, 'guardian');
  for (const link of old) throwsCode(() => store.claim({ token: token(link) }), 'INVALID_LINK');
});
