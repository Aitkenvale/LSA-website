/**
 * Where passkeys are kept.
 *
 * In the KV namespace the Worker already has bound, not in the calendar
 * configuration document. That document is rewritten in full every time an
 * administrator drags a calendar or picks a colour, and a stray write must
 * never be able to remove the thing that lets people sign in. Keeping the
 * credentials apart means the two can only be changed deliberately.
 *
 * A credential holds a public key and nothing else of value. There is no
 * secret here to leak: what it protects is the private key, which never leaves
 * the authenticator and was never ours to hold.
 */

import type { StoredCredential } from './webauthn.ts';

const CREDENTIALS_KEY = 'passkey:credentials';
const POLICY_KEY = 'passkey:policy';
const challengeKey = (challenge: string) => `passkey:challenge:${challenge}`;

/** How long a ceremony may take before its challenge is no longer accepted. */
const CHALLENGE_SECONDS = 300;

export interface PasskeyPolicy {
  /**
   * Whether the shared administrator code has been retired.
   *
   * While false, the code and a passkey both work, which is what makes the
   * first enrolment possible at all. Turning it on is the point at which
   * passkeys stop being a convenience and start being the boundary.
   */
  requirePasskey: boolean;
  changedAt?: string;
}

export const DEFAULT_POLICY: PasskeyPolicy = { requirePasskey: false };

export async function listCredentials(kv: KVNamespace | undefined): Promise<StoredCredential[]> {
  if (!kv) return [];
  const stored = await kv.get(CREDENTIALS_KEY, 'json');
  return Array.isArray(stored) ? (stored as StoredCredential[]) : [];
}

export async function saveCredentials(
  kv: KVNamespace,
  credentials: StoredCredential[],
): Promise<void> {
  await kv.put(CREDENTIALS_KEY, JSON.stringify(credentials));
}

export async function findCredential(
  kv: KVNamespace | undefined,
  id: string,
): Promise<StoredCredential | null> {
  return (await listCredentials(kv)).find((c) => c.id === id) ?? null;
}

export async function readPolicy(kv: KVNamespace | undefined): Promise<PasskeyPolicy> {
  if (!kv) return { ...DEFAULT_POLICY };
  const stored = (await kv.get(POLICY_KEY, 'json')) as Partial<PasskeyPolicy> | null;
  // A policy that cannot be read must not lock anybody out, so the safe
  // reading of a missing or malformed value is "the code still works".
  return { requirePasskey: stored?.requirePasskey === true, changedAt: stored?.changedAt };
}

export async function writePolicy(kv: KVNamespace, policy: PasskeyPolicy): Promise<void> {
  await kv.put(POLICY_KEY, JSON.stringify(policy));
}

export async function rememberChallenge(kv: KVNamespace, challenge: string, type: string) {
  await kv.put(challengeKey(challenge), type, { expirationTtl: CHALLENGE_SECONDS });
}

/**
 * Spend a challenge, so it cannot be spent twice.
 *
 * Read-then-delete is not atomic in KV, so two requests arriving in the same
 * instant could both be told yes. That does not help an attacker: they would
 * need the authenticator's signature over that challenge to get any further,
 * and holding that they need no race. What this actually closes is the reuse
 * of a challenge minutes later, which is worth closing.
 */
export async function spendChallenge(
  kv: KVNamespace | undefined,
  challenge: string,
  type: string,
): Promise<boolean> {
  if (!kv) return false;
  const stored = await kv.get(challengeKey(challenge));
  if (stored !== type) return false;
  await kv.delete(challengeKey(challenge));
  return true;
}

/** A credential as the panel may see it: no key material, nothing to misuse. */
export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
}

export function summarise(credentials: StoredCredential[]): PasskeySummary[] {
  return credentials.map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt,
  }));
}
