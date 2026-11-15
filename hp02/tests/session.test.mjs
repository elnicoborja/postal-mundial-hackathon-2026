import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureSession } from '../public/session.mjs';

function setup(options = {}) {
  let next = 0;
  const revoked = [];
  const session = new CaptureSession({ createUrl: () => `blob:test-${++next}`, revokeUrl: url => revoked.push(url), ...options });
  return { session, revoked };
}
const frame = (text = 'frame') => ({ blob: new Blob([text], { type: 'image/jpeg' }), width: 640, height: 480 });

test('byte budget and frame validation prevent unbounded or false accepted counts', () => {
  const { session } = setup({ maxBytes: 8 });
  session.confirmAdults(true);
  const epoch = session.begin();
  for (const invalid of [frame(''), { ...frame(), width: 0 }, { ...frame(), width: 4000, height: 4000 }]) {
    assert.throws(() => session.accept(epoch, invalid), /INVALID_FRAME/);
  }
  assert.equal(session.accept(epoch, frame('12345')), true);
  assert.equal(session.accept(epoch, frame('6789')), false);
  assert.equal(session.frames.length, 1);
  assert.equal(session.bytes, 5);
});

test('reset during output preparation cannot revive photos or old capture confirmation', async () => {
  const { session } = setup();
  session.confirmAdults(true);
  const epoch = session.begin();
  session.accept(epoch, frame());
  session.finish(epoch);
  session.select(1);
  let release;
  const pending = session.lock(original => new Promise(resolve => { release = () => resolve({ ...original, preview: original.blob }); }));
  session.reset();
  release();
  await assert.rejects(pending, /SESSION_RESET/);
  assert.equal(session.status, 'idle');
  assert.equal(session.output, null);
  assert.equal(session.frames.length, 0);
});

test('selection locks exact output and digest; reset invalidates pending work and releases URLs', async () => {
  const { session, revoked } = setup();
  session.confirmAdults(true);
  const epoch = session.begin();
  session.accept(epoch, frame('exact output'));
  session.finish(epoch);
  session.select(1);
  const output = await session.lock(async original => ({ ...original, preview: original.blob, filter: 'original' }));
  assert.equal(await output.blob.text(), 'exact output');
  const expected = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('exact output'))).toString('hex');
  assert.equal(output.digest, expected);
  assert.equal(session.output, output);
  assert.ok(Object.isFrozen(output));
  assert.throws(() => session.select(1), /REVIEW_REQUIRED/);
  session.reset();
  assert.equal(session.frames.length, 0);
  assert.equal(session.output, null);
  assert.equal(revoked.length, 3);
  assert.equal(session.accept(epoch, frame('late')), false);
  assert.throws(() => session.begin(), /CAPTURE_CONFIRMATION/);
});

test('capture requires fresh adult capture confirmation and accepts at most 30 actual frames', () => {
  const { session } = setup();
  assert.throws(() => session.begin(), /CAPTURE_CONFIRMATION/);
  session.confirmAdults(true);
  const epoch = session.begin();
  for (let i = 0; i < 30; i++) assert.equal(session.accept(epoch, frame(String(i))), true);
  assert.equal(session.accept(epoch, frame('extra')), false);
  assert.equal(session.frames.length, 30);
  assert.equal(session.frames[0].width, 640);
  session.finish(epoch);
  assert.equal(session.status, 'review');
  assert.throws(() => session.begin(), /RESET_REQUIRED/);
});
