import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import {
  ES256, b64uToBytes, bytesToB64u, cborDecode, checkClientData, derToRawSignature,
  importCoseKey, parseAuthenticatorData, sha256, timingSafeEqual, verifyAssertion,
  verifyRegistration,
} from '../src/lib/calendar/webauthn.ts';

const RP_ID = 'lsa-calendar.assembly-972.workers.dev';
const ORIGIN = `https://${RP_ID}`;

// ---- helpers that build what an authenticator would ------------------------

function cborBytes(b) {
  const head = b.length < 24 ? [0x40 | b.length]
    : b.length < 256 ? [0x58, b.length]
    : [0x59, b.length >> 8, b.length & 0xff];
  return new Uint8Array([...head, ...b]);
}
function cborText(s) {
  const b = new TextEncoder().encode(s);
  return new Uint8Array([...(b.length < 24 ? [0x60 | b.length] : [0x78, b.length]), ...b]);
}
function cborInt(n) {
  if (n >= 0) return new Uint8Array(n < 24 ? [n] : n < 256 ? [0x18, n] : [0x19, n >> 8, n & 0xff]);
  const m = -1 - n;
  return new Uint8Array(m < 24 ? [0x20 | m] : m < 256 ? [0x38, m] : [0x39, m >> 8, m & 0xff]);
}
function cborMap(entries) {
  const parts = entries.flatMap(([k, v]) => [typeof k === 'number' ? cborInt(k) : cborText(k), v]);
  const out = [0xa0 | entries.length];
  for (const p of parts) out.push(...p);
  return new Uint8Array(out);
}
const concat = (...a) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of a) { out.set(x, at); at += x.length; }
  return out;
};

async function makeKey() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const cose = cborMap([
    [1, cborInt(2)], [3, cborInt(ES256)], [-1, cborInt(1)],
    [-2, cborBytes(b64uToBytes(jwk.x))], [-3, cborBytes(b64uToBytes(jwk.y))],
  ]);
  return { pair, cose };
}

async function authData({ rpId = RP_ID, flags = 0x45, signCount = 1, credentialId, cose } = {}) {
  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, signCount);
  const base = concat(rpIdHash, new Uint8Array([flags]), counter);
  if (!credentialId) return base;
  const idLen = new Uint8Array(2);
  new DataView(idLen.buffer).setUint16(0, credentialId.length);
  return concat(base, new Uint8Array(16), idLen, credentialId, cose);
}

const clientData = (type, challenge, origin = ORIGIN) =>
  JSON.stringify({ type, challenge, origin, crossOrigin: false });

/** Sign as an authenticator does: over authData || SHA-256(clientDataJSON). */
async function sign(privateKey, ad, cdJson) {
  const hash = await sha256(new TextEncoder().encode(cdJson));
  const raw = new Uint8Array(await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privateKey, concat(ad, hash)));
  // Node hands back raw r||s; authenticators emit DER, so re-encode.
  const der = (r, s) => {
    const trim = (v) => { let i = 0; while (i < v.length - 1 && v[i] === 0) i += 1;
      const t = v.slice(i); return t[0] & 0x80 ? new Uint8Array([0, ...t]) : t; };
    const R = trim(r), S = trim(s);
    return new Uint8Array([0x30, R.length + S.length + 4, 0x02, R.length, ...R, 0x02, S.length, ...S]);
  };
  return der(raw.slice(0, 32), raw.slice(32));
}

// ---- base64url and constant-time comparison --------------------------------

test('base64url round-trips, including bytes that need padding', () => {
  for (const n of [0, 1, 2, 3, 31, 32, 64, 100]) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 37) % 256);
    assert.deepEqual(b64uToBytes(bytesToB64u(bytes)), bytes, `failed at ${n} bytes`);
  }
  assert.ok(!bytesToB64u(new Uint8Array([251, 255, 254])).match(/[+/=]/), 'url-unsafe characters');
});

test('comparison does not stop at the first differing character', () => {
  assert.ok(timingSafeEqual('abcdef', 'abcdef'));
  assert.ok(!timingSafeEqual('abcdef', 'abcdeg'));
  assert.ok(!timingSafeEqual('abcdef', 'zbcdef'));
  assert.ok(!timingSafeEqual('abc', 'abcd'));
});

// ---- CBOR -------------------------------------------------------------------

test('CBOR reads the shapes an authenticator sends', () => {
  assert.equal(cborDecode(cborInt(10)).value, 10);
  assert.equal(cborDecode(cborInt(300)).value, 300);
  assert.equal(cborDecode(cborInt(-7)).value, -7);
  assert.equal(cborDecode(cborInt(-257)).value, -257);
  assert.equal(cborDecode(cborText('none')).value, 'none');
  assert.deepEqual(cborDecode(cborBytes(new Uint8Array([1, 2, 3]))).value, new Uint8Array([1, 2, 3]));
  const map = cborDecode(cborMap([['fmt', cborText('none')], ['x', cborInt(1)]])).value;
  assert.equal(map.get('fmt'), 'none');
  assert.equal(map.get('x'), 1);
});

test('CBOR refuses what it does not understand rather than guessing', () => {
  // A float and a 64-bit integer: neither appears in an attestation object or
  // a COSE key, and both are refused before any value is read from them.
  assert.throws(() => cborDecode(new Uint8Array([0xfb, 0, 0, 0, 0, 0, 0, 0, 0])), /too large|Unsupported/);
  assert.throws(() => cborDecode(new Uint8Array([0x1b, 0, 0, 0, 0, 0, 0, 0, 1])), /too large/);
  // A tag, which is a major type this decoder has no business interpreting.
  assert.throws(() => cborDecode(new Uint8Array([0xc0, 0x01])), /Unsupported CBOR major/);
  assert.throws(() => cborDecode(new Uint8Array([])), /ended early/);
});

// ---- DER signatures ---------------------------------------------------------

test('DER signatures become two fixed halves, however they were encoded', () => {
  // A short r, which DER emits without leading zeros.
  const short = new Uint8Array([0x30, 0x08, 0x02, 0x01, 0x05, 0x02, 0x03, 0x01, 0x02, 0x03]);
  const raw = derToRawSignature(short);
  assert.equal(raw.length, 64);
  assert.equal(raw[31], 5, 'r right-aligned in its half');
  assert.deepEqual([...raw.slice(61)], [1, 2, 3], 's right-aligned in its half');
  assert.ok(raw.slice(0, 31).every((b) => b === 0));
});

test('a high-bit value keeps its magnitude when the DER sign byte is stripped', () => {
  const r = new Uint8Array(32).fill(0xff);
  const der = new Uint8Array([0x30, 0x46, 0x02, 0x21, 0x00, ...r, 0x02, 0x21, 0x00, ...r]);
  const raw = derToRawSignature(der);
  assert.deepEqual([...raw.slice(0, 32)], [...r]);
  assert.deepEqual([...raw.slice(32)], [...r]);
});

test('a malformed signature is refused, not padded into something plausible', () => {
  assert.throws(() => derToRawSignature(new Uint8Array([0x31, 0x02, 0x02, 0x00])), /not a DER/);
  const tooLong = new Uint8Array([0x30, 0x46, 0x02, 0x22, ...new Uint8Array(34).fill(9), 0x02, 0x01, 1]);
  assert.throws(() => derToRawSignature(tooLong), /too long/);
});

// ---- authenticator data -----------------------------------------------------

test('flags and counter are read as the authenticator wrote them', async () => {
  const ad = await authData({ flags: 0x05, signCount: 42 });
  const parsed = parseAuthenticatorData(ad);
  assert.equal(parsed.userPresent, true);
  assert.equal(parsed.userVerified, true);
  assert.equal(parsed.signCount, 42);
  assert.equal(parsed.credentialId, undefined, 'no credential outside registration');

  const absent = parseAuthenticatorData(await authData({ flags: 0x00 }));
  assert.equal(absent.userPresent, false);
  assert.equal(absent.userVerified, false);
});

test('truncated authenticator data is refused', async () => {
  assert.throws(() => parseAuthenticatorData(new Uint8Array(20)), /too short/);
  const ad = await authData({ flags: 0x45 });
  assert.throws(() => parseAuthenticatorData(ad), /truncated/);
});

// ---- registration -----------------------------------------------------------

async function register(overrides = {}) {
  const { pair, cose } = await makeKey();
  const credentialId = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
  const ad = await authData({ credentialId, cose, signCount: 0, ...overrides.authData });
  const attestationObject = cborMap([
    ['fmt', cborText('none')], ['attStmt', cborMap([])], ['authData', cborBytes(ad)],
  ]);
  return {
    pair,
    credentialId,
    input: {
      clientDataJSON: clientData('webauthn.create', 'CHALLENGE-1', overrides.origin ?? ORIGIN),
      attestationObject,
      credentialId: bytesToB64u(credentialId),
      expectedChallenge: 'CHALLENGE-1',
      expectedOrigins: [ORIGIN],
      rpId: RP_ID,
      ...overrides.input,
    },
  };
}

test('a registration yields a storable key', async () => {
  const { input } = await register();
  const stored = await verifyRegistration(input);
  assert.equal(stored.alg, ES256);
  assert.equal(stored.signCount, 0);
  const cose = cborDecode(b64uToBytes(stored.publicKey)).value;
  assert.equal(cose.get(3), ES256, 'the stored key is the attested one');
  await importCoseKey(cose);
});

test('a registration for another site, challenge or origin is refused', async () => {
  for (const [label, patch] of [
    ['another site', { input: { rpId: 'evil.example' } }],
    ['a stale challenge', { input: { expectedChallenge: 'CHALLENGE-2' } }],
    ['a look-alike origin', { origin: 'https://lsa-calendar.assembly-972.workers.dev.evil.example' }],
    ['nobody present', { authData: { flags: 0x40 } }],
  ]) {
    const { input } = await register(patch);
    await assert.rejects(verifyRegistration(input), undefined, `accepted ${label}`);
  }
});

test('a credential id that disagrees with the authenticator is refused', async () => {
  const { input } = await register();
  input.credentialId = bytesToB64u(new Uint8Array([1, 1, 1, 1]));
  await assert.rejects(verifyRegistration(input), /did not match/);
});

// ---- assertion --------------------------------------------------------------

async function assertion(overrides = {}) {
  const { pair, input: reg, credentialId } = await register();
  const stored = await verifyRegistration(reg);
  const credential = {
    id: bytesToB64u(credentialId), publicKey: stored.publicKey, alg: stored.alg,
    signCount: 0, name: 'Test key', createdAt: '2026-09-07',
  };
  // An assertion's authenticator data carries no attested credential, so the
  // 0x40 bit the registration helper defaults to must not be set here.
  const ad = await authData({ flags: 0x05, signCount: 5, ...overrides.authData });
  const cdJson = clientData('webauthn.get', 'CHALLENGE-9', overrides.origin ?? ORIGIN);
  const signature = await sign(pair.privateKey, ad, overrides.signedOver ?? cdJson);
  return {
    credential,
    input: {
      clientDataJSON: cdJson, authenticatorData: ad, signature, credential,
      expectedChallenge: 'CHALLENGE-9', expectedOrigins: [ORIGIN], rpId: RP_ID,
      ...overrides.input,
    },
  };
}

test('a genuine assertion verifies and reports the new counter', async () => {
  const { input } = await assertion();
  const result = await verifyAssertion(input);
  assert.equal(result.signCount, 5);
});

test('a signature over different data does not verify', async () => {
  const { input } = await assertion({
    signedOver: clientData('webauthn.get', 'SOMETHING-ELSE'),
  });
  await assert.rejects(verifyAssertion(input), /did not verify/);
});

test('a signature from another key does not verify', async () => {
  const { input } = await assertion();
  const other = await assertion();
  input.signature = other.input.signature;
  await assert.rejects(verifyAssertion(input), /did not verify/);
});

test('a replayed challenge, wrong origin or wrong ceremony is refused', async () => {
  for (const [label, patch] of [
    ['a stale challenge', { input: { expectedChallenge: 'CHALLENGE-8' } }],
    ['another origin', { origin: 'https://evil.example' }],
    ['another site', { input: { rpId: 'evil.example' } }],
    ['nobody present', { authData: { flags: 0x04, signCount: 5 } }],
  ]) {
    const { input } = await assertion(patch);
    await assert.rejects(verifyAssertion(input), undefined, `accepted ${label}`);
  }
});

test('a registration signature cannot be replayed as a sign-in', () => {
  assert.throws(
    () => checkClientData(clientData('webauthn.create', 'C'), {
      type: 'webauthn.get', challenge: 'C', origins: [ORIGIN],
    }),
    /ceremony/,
  );
});

/*
 * A counter going backwards is what a cloned authenticator looks like. Synced
 * passkeys report zero forever and cannot be checked this way, so zero is
 * accepted rather than treated as suspicious.
 */
test('a counter that goes backwards is refused; a counter of zero is not', async () => {
  const { input } = await assertion({ authData: { signCount: 3 } });
  input.credential = { ...input.credential, signCount: 7 };
  await assert.rejects(verifyAssertion(input), /backwards/);

  const synced = await assertion({ authData: { signCount: 0 } });
  synced.input.credential = { ...synced.input.credential, signCount: 0 };
  assert.equal((await verifyAssertion(synced.input)).signCount, 0);
});
