/** Tiers and the signed session that carries them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIERS, meetsTier, tierRank, signSession, readSession, sessionCookieHeader, timingSafeEqual,
} from '../src/lib/calendar/tiers.ts';

const SECRET = 'a-long-random-signing-secret-for-tests';

test('tiers form a ladder, each seeing everything below', () => {
  assert.deepEqual([...TIERS], ['public', 'community', 'hoods', 'assembly']);
  assert.ok(meetsTier('assembly', 'public'));
  assert.ok(meetsTier('assembly', 'community'));
  assert.ok(meetsTier('hoods', 'community'), 'a coordinator is also a community member');
  assert.ok(meetsTier('community', 'community'));
  assert.ok(!meetsTier('community', 'hoods'));
  assert.ok(!meetsTier('public', 'community'));
  assert.ok(tierRank('assembly') > tierRank('hoods'));
});

test('session: a signed token round-trips to its tier', async () => {
  const token = await signSession('hoods', SECRET);
  assert.equal(await readSession(token, SECRET), 'hoods');
});

test('session: a forged or tampered token is worth nothing', async () => {
  const token = await signSession('assembly', SECRET);

  // Signed with a different secret.
  assert.equal(await readSession(token, 'some-other-secret'), 'public');

  // Body swapped for a higher tier, original signature kept.
  const [, signature] = token.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ tier: 'assembly', exp: 9e9 }))
    .toString('base64url');
  assert.equal(await readSession(`${forgedBody}.${signature}`, SECRET), 'public');

  // Nonsense in, public out — never an exception.
  for (const junk of ['', 'x', 'a.b', '....', 'not-base64.$$$$']) {
    assert.equal(await readSession(junk, SECRET), 'public');
  }
  assert.equal(await readSession(undefined, SECRET), 'public');
});

test('session: an expired token drops back to public', async () => {
  const issued = Date.now();
  const token = await signSession('community', SECRET, issued);
  // Community sessions last 180 days.
  const almost = issued + 179 * 86400 * 1000;
  const after = issued + 181 * 86400 * 1000;
  assert.equal(await readSession(token, SECRET, almost), 'community');
  assert.equal(await readSession(token, SECRET, after), 'public');
});

test('session: the assembly tier expires soonest', async () => {
  const issued = Date.now();
  const at = issued + 45 * 86400 * 1000;
  assert.equal(await readSession(await signSession('assembly', SECRET, issued), SECRET, at), 'public');
  assert.equal(await readSession(await signSession('hoods', SECRET, issued), SECRET, at), 'hoods');
});

test('session cookie is not readable by script and does not leak cross-site', () => {
  const header = sessionCookieHeader('token-value', 'community');
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Max-Age=15552000/); // 180 days
  // Clearing.
  assert.match(sessionCookieHeader(null), /Max-Age=0/);
});

test('code comparison does not short-circuit on the first wrong character', () => {
  assert.ok(timingSafeEqual('abc123', 'abc123'));
  assert.ok(!timingSafeEqual('abc123', 'abc124'));
  assert.ok(!timingSafeEqual('abc', 'abc123'), 'a prefix is not a match');
  assert.ok(!timingSafeEqual('', 'x'));
});
