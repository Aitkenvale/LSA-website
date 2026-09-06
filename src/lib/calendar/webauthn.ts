/**
 * WebAuthn, implemented directly.
 *
 * The obvious move was a library — better-auth and its passkey plugin, on D1.
 * It was not taken. That stack brings its own user table, its own session
 * cookie and its own idea of who is signed in, and this calendar already has
 * one: a tier held in an HMAC-signed cookie, checked on every request. Two
 * session systems in one Worker is a standing invitation for them to disagree
 * about who you are, and the tier is the thing that decides who sees an
 * address. So a passkey here does exactly one thing — it proves you may hold
 * the admin tier — and then the existing session takes over unchanged.
 *
 * What that costs is the code below: CBOR enough to read an attestation
 * object, COSE enough to read a public key, and the signature check. What it
 * buys is no new dependency, no second notion of identity, and nothing to keep
 * in step. Verification is the part worth being careful about, so it is
 * separated from any storage or HTTP concern and tested on its own.
 *
 * Attestation is deliberately not verified. Passkeys are registered with
 * "none" attestation in practice, and checking which manufacturer made an
 * authenticator answers a question this community does not have. What matters
 * is that the same key signs each time, which is what the assertion proves.
 */

/**
 * A failure this code chose to report.
 *
 * Distinguished from an ordinary Error so that callers can repeat these
 * messages to a person — they are written for one, and say nothing an attacker
 * gains by hearing — while anything unexpected becomes a flat refusal. A
 * malformed attestation once surfaced "attestation.get is not a function" to
 * the browser, which tells a stranger about the inside of the Worker and tells
 * an administrator nothing at all.
 */
export class WebAuthnError extends Error {}

// ---- base64url --------------------------------------------------------------

export function bytesToB64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

export function randomChallenge(bytes = 32): string {
  return bytesToB64u(crypto.getRandomValues(new Uint8Array(bytes)));
}

/**
 * Compare two strings without revealing where they first differ.
 *
 * A challenge is a secret for the length of one sign-in, and comparing it with
 * === leaks its prefix through timing the same way a password would.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- CBOR -------------------------------------------------------------------

/**
 * Just enough CBOR to read an attestation object and a COSE key.
 *
 * Both are small, closed structures: maps of integers and short strings to
 * byte strings. Floats, tags, indefinite lengths and 64-bit integers cannot
 * appear in either, so they are refused rather than half-implemented — a
 * decoder that guesses at input it does not understand is worse than one that
 * stops.
 */
export function cborDecode(bytes: Uint8Array, start = 0): { value: unknown; next: number } {
  if (start >= bytes.length) throw new WebAuthnError('CBOR ended early');
  const first = bytes[start];
  const major = first >> 5;
  const minor = first & 0x1f;
  let pos = start + 1;

  let length = minor;
  if (minor === 24) { length = bytes[pos]; pos += 1; }
  else if (minor === 25) { length = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; }
  else if (minor === 26) {
    length = ((bytes[pos] << 24) >>> 0) + (bytes[pos + 1] << 16) + (bytes[pos + 2] << 8) + bytes[pos + 3];
    pos += 4;
  } else if (minor >= 27) throw new WebAuthnError('CBOR value too large to be expected here');

  switch (major) {
    case 0: return { value: length, next: pos };
    case 1: return { value: -1 - length, next: pos };
    case 2: return { value: bytes.slice(pos, pos + length), next: pos + length };
    case 3: return { value: new TextDecoder().decode(bytes.slice(pos, pos + length)), next: pos + length };
    case 4: {
      const items: unknown[] = [];
      for (let i = 0; i < length; i += 1) {
        const item = cborDecode(bytes, pos);
        items.push(item.value);
        pos = item.next;
      }
      return { value: items, next: pos };
    }
    case 5: {
      const map = new Map<unknown, unknown>();
      for (let i = 0; i < length; i += 1) {
        const key = cborDecode(bytes, pos);
        const value = cborDecode(bytes, key.next);
        map.set(key.value, value.value);
        pos = value.next;
      }
      return { value: map, next: pos };
    }
    case 7:
      if (minor === 20) return { value: false, next: pos };
      if (minor === 21) return { value: true, next: pos };
      if (minor === 22) return { value: null, next: pos };
      throw new WebAuthnError('Unsupported CBOR simple value');
    default:
      throw new WebAuthnError('Unsupported CBOR major type');
  }
}

// ---- authenticator data -----------------------------------------------------

export interface AuthenticatorData {
  rpIdHash: Uint8Array;
  /** Whether a person was present — a touch, not merely a reachable device. */
  userPresent: boolean;
  /** Whether they were verified — a PIN, a fingerprint, a face. */
  userVerified: boolean;
  signCount: number;
  credentialId?: Uint8Array;
  credentialPublicKey?: Map<unknown, unknown>;
}

export function parseAuthenticatorData(data: Uint8Array): AuthenticatorData {
  if (data.length < 37) throw new WebAuthnError('Authenticator data is too short');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const flags = data[32];

  const parsed: AuthenticatorData = {
    rpIdHash: data.slice(0, 32),
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    signCount: view.getUint32(33),
  };

  // Attested credential data is present only when a credential is created.
  if ((flags & 0x40) !== 0) {
    if (data.length < 55) throw new WebAuthnError('Attested credential data is truncated');
    const idLength = view.getUint16(53);
    const idStart = 55;
    if (data.length < idStart + idLength) throw new WebAuthnError('Credential id is truncated');
    parsed.credentialId = data.slice(idStart, idStart + idLength);
    const key = cborDecode(data, idStart + idLength);
    if (!(key.value instanceof Map)) throw new WebAuthnError('Credential key was malformed');
    parsed.credentialPublicKey = key.value as Map<unknown, unknown>;
  }
  return parsed;
}

// ---- COSE keys --------------------------------------------------------------

export const ES256 = -7;
export const RS256 = -257;

/**
 * A COSE public key as something crypto.subtle will verify with.
 *
 * Only the two algorithms authenticators actually produce: ES256 from every
 * platform authenticator worth the name, and RS256 from the TPM-backed ones
 * Windows Hello uses. An unknown algorithm is refused rather than guessed at.
 */
export async function importCoseKey(cose: Map<unknown, unknown>): Promise<{ key: CryptoKey; alg: number }> {
  const alg = cose.get(3);
  if (alg === ES256) {
    const x = cose.get(-2) as Uint8Array;
    const y = cose.get(-3) as Uint8Array;
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) throw new WebAuthnError('Malformed EC2 key');
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: bytesToB64u(x), y: bytesToB64u(y), ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return { key, alg: ES256 };
  }
  if (alg === RS256) {
    const n = cose.get(-1) as Uint8Array;
    const e = cose.get(-2) as Uint8Array;
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) throw new WebAuthnError('Malformed RSA key');
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: bytesToB64u(n), e: bytesToB64u(e), ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return { key, alg: RS256 };
  }
  throw new WebAuthnError('Unsupported key algorithm');
}

/**
 * An ECDSA signature as WebCrypto wants it.
 *
 * Authenticators emit the ASN.1 DER form, two length-prefixed integers that
 * carry a leading zero when the high bit is set and drop leading zeros
 * otherwise. WebCrypto wants r and s as two fixed 32-byte halves. Getting this
 * wrong fails open in the worst way — a mis-sized buffer can make a valid
 * signature look invalid, and a careless one can make anything look valid — so
 * each half is length-checked rather than trusted.
 */
export function derToRawSignature(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new WebAuthnError('Signature is not a DER sequence');
  let pos = 2;
  if (der[1] & 0x80) pos = 2 + (der[1] & 0x7f);

  const read = (): Uint8Array => {
    if (der[pos] !== 0x02) throw new WebAuthnError('Signature integer expected');
    const length = der[pos + 1];
    let value = der.slice(pos + 2, pos + 2 + length);
    pos += 2 + length;
    // Strip the sign byte DER adds, then left-pad to the curve's 32.
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    if (value.length > 32) throw new WebAuthnError('Signature integer is too long');
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return padded;
  };

  const r = read();
  const s = read();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

// ---- client data ------------------------------------------------------------

export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

/**
 * Check the browser's account of what it was asked to do.
 *
 * Three things must hold, and each closes a different door: the ceremony must
 * be the one we started, so a signature gathered during registration cannot be
 * replayed as a sign-in; the challenge must be the one we issued, so an old
 * exchange cannot be replayed at all; and the origin must be ours, so a
 * look-alike site cannot collect a signature that works here.
 */
export function checkClientData(
  json: string,
  expected: { type: 'webauthn.create' | 'webauthn.get'; challenge: string; origins: string[] },
): ClientData {
  let data: ClientData;
  try {
    data = JSON.parse(json) as ClientData;
  } catch {
    throw new WebAuthnError('Client data was not valid JSON');
  }
  if (data.type !== expected.type) throw new WebAuthnError('Wrong ceremony type');
  if (!timingSafeEqual(data.challenge, expected.challenge)) throw new WebAuthnError('Challenge did not match');
  if (!expected.origins.includes(data.origin)) throw new WebAuthnError('Origin did not match');
  return data;
}

// ---- the two ceremonies -----------------------------------------------------

export interface StoredCredential {
  /** base64url credential id, as the browser reports it. */
  id: string;
  /** base64url COSE public key. */
  publicKey: string;
  alg: number;
  signCount: number;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface RegistrationInput {
  clientDataJSON: string;
  attestationObject: Uint8Array;
  credentialId: string;
  expectedChallenge: string;
  expectedOrigins: string[];
  rpId: string;
}

export async function verifyRegistration(
  input: RegistrationInput,
): Promise<{ publicKey: string; alg: number; signCount: number }> {
  checkClientData(input.clientDataJSON, {
    type: 'webauthn.create',
    challenge: input.expectedChallenge,
    origins: input.expectedOrigins,
  });

  const decoded = cborDecode(input.attestationObject).value;
  if (!(decoded instanceof Map)) throw new WebAuthnError('Attestation object was malformed');
  const attestation = decoded as Map<unknown, unknown>;
  const authData = attestation.get('authData');
  if (!(authData instanceof Uint8Array)) throw new WebAuthnError('Attestation carried no authenticator data');

  const parsed = parseAuthenticatorData(authData);
  const expectedRpIdHash = await sha256(new TextEncoder().encode(input.rpId));
  if (bytesToB64u(parsed.rpIdHash) !== bytesToB64u(expectedRpIdHash)) {
    throw new WebAuthnError('Credential was made for another site');
  }
  // Without user presence the ceremony proves only that a device was reachable,
  // not that anybody agreed to it.
  if (!parsed.userPresent) throw new WebAuthnError('No one was present');
  if (!parsed.credentialId || !parsed.credentialPublicKey) {
    throw new WebAuthnError('Registration carried no credential');
  }
  if (bytesToB64u(parsed.credentialId) !== input.credentialId) {
    throw new WebAuthnError('Credential id did not match the one reported');
  }

  const { alg } = await importCoseKey(parsed.credentialPublicKey);
  // Re-encode from the authenticator's own bytes rather than rebuilding the
  // structure, so what is stored is exactly what was attested.
  const keyStart = 55 + parsed.credentialId.length;
  const keyEnd = cborDecode(authData, keyStart).next;
  return {
    publicKey: bytesToB64u(authData.slice(keyStart, keyEnd)),
    alg,
    signCount: parsed.signCount,
  };
}

export interface AssertionInput {
  clientDataJSON: string;
  authenticatorData: Uint8Array;
  signature: Uint8Array;
  credential: StoredCredential;
  expectedChallenge: string;
  expectedOrigins: string[];
  rpId: string;
}

export async function verifyAssertion(input: AssertionInput): Promise<{ signCount: number }> {
  checkClientData(input.clientDataJSON, {
    type: 'webauthn.get',
    challenge: input.expectedChallenge,
    origins: input.expectedOrigins,
  });

  const parsed = parseAuthenticatorData(input.authenticatorData);
  const expectedRpIdHash = await sha256(new TextEncoder().encode(input.rpId));
  if (bytesToB64u(parsed.rpIdHash) !== bytesToB64u(expectedRpIdHash)) {
    throw new WebAuthnError('Signed for another site');
  }
  if (!parsed.userPresent) throw new WebAuthnError('No one was present');

  const decodedKey = cborDecode(b64uToBytes(input.credential.publicKey)).value;
  if (!(decodedKey instanceof Map)) throw new WebAuthnError('Stored key was malformed');
  const cose = decodedKey as Map<unknown, unknown>;
  const { key, alg } = await importCoseKey(cose);

  const clientHash = await sha256(new TextEncoder().encode(input.clientDataJSON));
  const signed = new Uint8Array(input.authenticatorData.length + clientHash.length);
  signed.set(input.authenticatorData, 0);
  signed.set(clientHash, input.authenticatorData.length);

  const ok = alg === ES256
    ? await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' }, key, derToRawSignature(input.signature), signed)
    : await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, input.signature, signed);
  if (!ok) throw new WebAuthnError('Signature did not verify');

  /*
   * A counter that has gone backwards means two authenticators are answering
   * for one credential, which is what a cloned key looks like. Many passkeys
   * sync between devices and report zero forever; those cannot be checked this
   * way, and a zero counter is accepted rather than treated as suspicious.
   */
  if (input.credential.signCount > 0 && parsed.signCount > 0
      && parsed.signCount <= input.credential.signCount) {
    throw new WebAuthnError('Sign counter went backwards');
  }
  return { signCount: parsed.signCount };
}
