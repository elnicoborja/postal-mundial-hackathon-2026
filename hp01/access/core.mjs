import { createHash, randomBytes, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';

export class DemoError extends Error {
  constructor(status, code, message) {
    super(message);
    Object.assign(this, { status, code });
  }
}

const fail = (status, code, message) => { throw new DemoError(status, code, message); };
const hash = token => createHash('sha256').update(token).digest('hex');
const exactObject = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !keys.includes(key))) {
    fail(400, 'INVALID_INPUT', 'Use only the documented demo fields.');
  }
};

// This is an in-memory example policy, never identity or guardian verification.
export function createDemoStore({ now = Date.now, tokenTtlMs = 15 * 60_000,
  batchTtlMs = 60 * 60_000, maxBatches = 100,
  origin = 'http://127.0.0.1:5608', encodeQr = text => QRCode.toString(text,
    { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 240 }) } = {}) {
  const batches = new Map();
  const tokens = new Map();

  const revokeAll = batch => {
    for (const link of batch.links.values()) {
      tokens.delete(link.tokenHash);
      link.revoked = true;
    }
  };
  const sweep = () => {
    for (const [id, batch] of batches) {
      if (batch.expiresAt <= now()) { revokeAll(batch); batches.delete(id); }
    }
    for (const [key, link] of tokens) if (link.expiresAt <= now()) tokens.delete(key);
  };
  const get = id => {
    sweep();
    const batch = batches.get(id);
    if (!batch) fail(404, 'UNKNOWN_BATCH', 'This demo batch is unknown or expired.');
    return batch;
  };
  const ready = batch => !batch.reset && batch.participants.every(p => p.consent.decision === 'approved');
  const snapshot = batch => ({ batchId: batch.id, mode: 'demo',
    status: ready(batch) ? 'ready' : 'blocked', reset: batch.reset,
    expiresAt: new Date(batch.expiresAt).toISOString(),
    participants: batch.participants.map(p => ({ id: p.id, kind: p.kind, consent: { ...p.consent } })) });
  const active = batch => {
    if (batch.reset) fail(409, 'BATCH_RESET', 'This demo batch was reset. Create a new batch.');
  };

  return {
    create(input) {
      exactObject(input, ['participants']);
      if (!Array.isArray(input.participants) || input.participants.length < 1 || input.participants.length > 6) {
        fail(400, 'INVALID_PARTICIPANTS', 'Choose 1 to 6 synthetic participants.');
      }
      const seen = new Set();
      const participants = input.participants.map(p => {
        exactObject(p, ['id', 'kind']);
        if (typeof p.id !== 'string' || !/^p[1-9][0-9]{0,2}$/.test(p.id) || seen.has(p.id)
            || !['adult', 'minor', 'uncertain'].includes(p.kind)) {
          fail(400, 'INVALID_PARTICIPANT', 'Use unique synthetic IDs p1 to p999 and a supported kind.');
        }
        seen.add(p.id);
        return { id: p.id, kind: p.kind, consent: { decision: 'pending', actor: null, purpose: null } };
      });
      sweep();
      if (batches.size >= maxBatches) fail(429, 'DEMO_CAPACITY', 'Demo capacity reached. Restart or wait for expiry.');
      const batch = { id: randomUUID(), participants, links: new Map(), revision: 0,
        reset: false, expiresAt: now() + batchTtlMs };
      batches.set(batch.id, batch);
      return snapshot(batch);
    },
    read(id) { return snapshot(get(id)); },
    consent(id, input) {
      exactObject(input, ['participantId', 'decision', 'actor', 'purpose']);
      const batch = get(id);
      active(batch);
      const person = batch.participants.find(p => p.id === input.participantId);
      if (!person) fail(404, 'UNKNOWN_PARTICIPANT', 'The participant is not in this demo batch.');
      if (!['approved', 'denied'].includes(input.decision) || input.purpose !== 'private-delivery') {
        fail(400, 'INVALID_CONSENT', 'Choose approved or denied for the private-delivery example.');
      }
      const requiredActor = person.kind === 'adult' ? 'self' : 'guardian';
      if (input.actor !== requiredActor) {
        fail(403, 'ACTOR_REQUIRED', `This example requires the ${requiredActor} actor. No identity is verified.`);
      }
      person.consent = { decision: input.decision, actor: input.actor, purpose: input.purpose };
      batch.revision++;
      // Any consent edit invalidates earlier issuance, including repeated approval.
      revokeAll(batch);
      return snapshot(batch);
    },
    async issue(id, input) {
      exactObject(input, []);
      const batch = get(id);
      active(batch);
      if (!ready(batch)) fail(409, 'CONSENT_REQUIRED', 'Every participant needs an explicit approval example first.');
      const revision = ++batch.revision;
      revokeAll(batch);
      batch.links.clear();
      const issuedAt = now();
      const expiresAt = Math.min(issuedAt + tokenTtlMs, batch.expiresAt);
      const pending = await Promise.all(batch.participants.map(async person => {
        const token = randomBytes(32).toString('base64url');
        const url = `${origin}/recipient.html#${token}`;
        return { stored: { linkId: randomUUID(), participantId: person.id, batchId: id,
          tokenHash: hash(token), expiresAt, revoked: false },
          qrSvg: await encodeQr(url), url, control: person.kind === 'adult' ? 'self' : 'guardian' };
      }));
      // Consent edits, concurrent issuance, resets, or expiry while encoding must win.
      if (batch.revision !== revision || !ready(batch) || batch.expiresAt <= now() || expiresAt <= now()) {
        fail(409, 'BATCH_CHANGED', 'The example changed while links were being prepared. Review it again.');
      }
      for (const { stored } of pending) {
        batch.links.set(stored.linkId, stored);
        tokens.set(stored.tokenHash, stored);
      }
      return { mode: 'demo', links: pending.map(({ stored, qrSvg, url, control }) => ({
        participantId: stored.participantId, linkId: stored.linkId, url, qrSvg, control,
        expiresAt: new Date(stored.expiresAt).toISOString() })) };
    },
    revoke(id, linkId, input) {
      exactObject(input, []);
      const batch = get(id);
      const link = batch.links.get(linkId);
      if (!link) fail(404, 'UNKNOWN_LINK', 'The link is not in this demo batch.');
      tokens.delete(link.tokenHash);
      link.revoked = true;
      return { mode: 'demo', participantId: link.participantId, linkId, status: 'revoked' };
    },
    reset(id, input) {
      exactObject(input, []);
      const batch = get(id);
      revokeAll(batch);
      batch.reset = true;
      batch.revision++;
      return snapshot(batch);
    },
    claim(input) {
      exactObject(input, ['token']);
      if (typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.token)) {
        fail(401, 'INVALID_LINK', 'This demo link is invalid, expired, or revoked.');
      }
      sweep();
      const link = tokens.get(hash(input.token));
      const batch = link && batches.get(link.batchId);
      if (!link || link.revoked || link.expiresAt <= now() || !batch || !ready(batch)) {
        fail(401, 'INVALID_LINK', 'This demo link is invalid, expired, or revoked.');
      }
      return { mode: 'demo', batchId: link.batchId, participantId: link.participantId,
        control: batch.participants.find(p => p.id === link.participantId).kind === 'adult' ? 'self' : 'guardian',
        status: 'access-example',
        message: 'Synthetic access example only. No media, payment, download entitlement, identity, or guardian verification.' };
    }
  };
}
