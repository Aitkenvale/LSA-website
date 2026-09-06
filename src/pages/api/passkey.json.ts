import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  findCredential, listCredentials, readPolicy, rememberChallenge,
  saveCredentials, spendChallenge, summarise, writePolicy,
} from '../../lib/calendar/passkey-store';
import { TIER_LABELS, meetsTier, readSession, sessionCookie, sessionCookieHeader, signSession }
  from '../../lib/calendar/tiers';
import {
  WebAuthnError, b64uToBytes, bytesToB64u, randomChallenge, verifyAssertion, verifyRegistration,
  type StoredCredential,
} from '../../lib/calendar/webauthn';

export const prerender = false;

/**
 * Enrolling and using a passkey.
 *
 * A passkey here proves one thing: that the holder may take the administrator
 * tier. It then issues exactly the same signed cookie the administrator code
 * issues, so everything downstream — every check of who may see a private
 * calendar address — is unchanged and has only one notion of identity to
 * consult.
 *
 * The relying party is taken from the request rather than written down. A
 * passkey is bound to the domain it was made on, which is the property that
 * makes it unphishable, and hard-coding a hostname here would have meant
 * either a broken sign-in or a dangerous mismatch when this calendar moves to
 * its own address.
 */

function kv(): KVNamespace | undefined {
  return (env as Record<string, unknown>).SESSION as KVNamespace | undefined;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

function relyingParty(request: Request): { rpId: string; origins: string[] } {
  const url = new URL(request.url);
  return { rpId: url.hostname, origins: [url.origin] };
}

async function isAdmin(request: Request): Promise<boolean> {
  const tier = await readSession(sessionCookie(request), env.SESSION_SECRET ?? '');
  return meetsTier(tier, 'admin');
}

/** Whether a passkey can be offered, and whether the code still works. */
export const GET: APIRoute = async () => {
  const store = kv();
  const [credentials, policy] = await Promise.all([listCredentials(store), readPolicy(store)]);
  return json({
    available: credentials.length > 0,
    requirePasskey: policy.requirePasskey,
    // Named so the panel can say which key was used, never the key itself.
    count: credentials.length,
  });
};

export const POST: APIRoute = async ({ request }) => {
  const store = kv();
  if (!store) return json({ ok: false, error: 'No store is bound.' }, 503);
  const signing = env.SESSION_SECRET;
  if (!signing) return json({ ok: false, error: 'Sign-in is not configured.' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'Malformed request.' }, 400);
  }
  const action = String(body.action ?? '');
  const { rpId, origins } = relyingParty(request);

  // ---- enrolling ---------------------------------------------------------

  if (action === 'register-start') {
    if (!(await isAdmin(request))) return json({ ok: false, error: 'Not permitted.' }, 403);
    const challenge = randomChallenge();
    await rememberChallenge(store, challenge, 'webauthn.create');
    const existing = await listCredentials(store);
    return json({
      ok: true,
      options: {
        challenge,
        rp: { id: rpId, name: "Bahá'í Community of Townsville" },
        // One administrator account rather than one per person: the tier is
        // what is being proved, and several keys may prove it.
        user: { id: bytesToB64u(new TextEncoder().encode('calendar-admin')), name: 'Administrator', displayName: 'Calendar administrator' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        // Offering the keys already held stops a device quietly enrolling twice
        // and leaving two entries nobody can tell apart.
        excludeCredentials: existing.map((c) => ({ type: 'public-key', id: c.id })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
        timeout: 120000,
        attestation: 'none',
      },
    });
  }

  if (action === 'register-finish') {
    if (!(await isAdmin(request))) return json({ ok: false, error: 'Not permitted.' }, 403);
    const clientDataJSON = new TextDecoder().decode(b64uToBytes(String(body.clientDataJSON ?? '')));
    let challenge = '';
    try {
      challenge = String((JSON.parse(clientDataJSON) as { challenge: string }).challenge ?? '');
    } catch {
      return json({ ok: false, error: 'Malformed client data.' }, 400);
    }
    if (!(await spendChallenge(store, challenge, 'webauthn.create'))) {
      return json({ ok: false, error: 'That registration has expired. Try again.' }, 400);
    }

    try {
      const credentialId = String(body.credentialId ?? '');
      const verified = await verifyRegistration({
        clientDataJSON,
        attestationObject: b64uToBytes(String(body.attestationObject ?? '')),
        credentialId,
        expectedChallenge: challenge,
        expectedOrigins: origins,
        rpId,
      });
      const credentials = await listCredentials(store);
      if (credentials.some((c) => c.id === credentialId)) {
        return json({ ok: false, error: 'That passkey is already enrolled.' }, 409);
      }
      const name = String(body.name ?? '').trim().slice(0, 60) || 'Passkey';
      const credential: StoredCredential = {
        id: credentialId,
        publicKey: verified.publicKey,
        alg: verified.alg,
        signCount: verified.signCount,
        name,
        createdAt: new Date().toISOString().slice(0, 10),
      };
      await saveCredentials(store, [...credentials, credential]);
      return json({ ok: true, passkeys: summarise([...credentials, credential]) });
    } catch (err) {
      // Only the messages this code wrote are repeated back. Anything else is
      // a bug, and describing it to the browser tells a stranger about the
      // inside of the Worker while telling an administrator nothing.
      return json({
        ok: false,
        error: err instanceof WebAuthnError ? err.message : 'That passkey could not be verified.',
      }, 400);
    }
  }

  // ---- signing in --------------------------------------------------------

  if (action === 'sign-in-start') {
    const credentials = await listCredentials(store);
    if (!credentials.length) return json({ ok: false, error: 'No passkey is enrolled.' }, 404);
    const challenge = randomChallenge();
    await rememberChallenge(store, challenge, 'webauthn.get');
    return json({
      ok: true,
      options: {
        challenge,
        rpId,
        // Left empty on purpose: the credentials are discoverable, so the
        // browser offers what it holds without this page naming anybody.
        allowCredentials: [],
        userVerification: 'preferred',
        timeout: 120000,
      },
    });
  }

  if (action === 'sign-in-finish') {
    const clientDataJSON = new TextDecoder().decode(b64uToBytes(String(body.clientDataJSON ?? '')));
    let challenge = '';
    try {
      challenge = String((JSON.parse(clientDataJSON) as { challenge: string }).challenge ?? '');
    } catch {
      return json({ ok: false, error: 'Malformed client data.' }, 400);
    }
    if (!(await spendChallenge(store, challenge, 'webauthn.get'))) {
      return json({ ok: false, error: 'That sign-in has expired. Try again.' }, 400);
    }

    const credential = await findCredential(store, String(body.credentialId ?? ''));
    // The same answer whether the credential is unknown or the signature is
    // wrong, so this cannot be used to enumerate which keys are enrolled.
    const refuse = () => json({ ok: false, error: 'That passkey was not recognised.' }, 401);
    if (!credential) return refuse();

    try {
      const { signCount } = await verifyAssertion({
        clientDataJSON,
        authenticatorData: b64uToBytes(String(body.authenticatorData ?? '')),
        signature: b64uToBytes(String(body.signature ?? '')),
        credential,
        expectedChallenge: challenge,
        expectedOrigins: origins,
        rpId,
      });
      const credentials = await listCredentials(store);
      await saveCredentials(store, credentials.map((c) => (c.id === credential.id
        ? { ...c, signCount, lastUsedAt: new Date().toISOString().slice(0, 10) }
        : c)));
      const token = await signSession('admin', signing);
      return json(
        { ok: true, tier: 'admin', label: TIER_LABELS.admin, usedKey: credential.name },
        200,
        { 'set-cookie': sessionCookieHeader(token, 'admin') },
      );
    } catch {
      return refuse();
    }
  }

  // ---- managing ----------------------------------------------------------

  if (!(await isAdmin(request))) return json({ ok: false, error: 'Not permitted.' }, 403);

  if (action === 'list') {
    return json({
      ok: true,
      passkeys: summarise(await listCredentials(store)),
      policy: await readPolicy(store),
    });
  }

  if (action === 'remove') {
    const id = String(body.id ?? '');
    const credentials = await listCredentials(store);
    const remaining = credentials.filter((c) => c.id !== id);
    const policy = await readPolicy(store);
    /*
     * Removing the last passkey while the code is retired would leave nobody
     * able to sign in at all, short of the recovery code. Refused rather than
     * warned about: an administrator can turn the requirement off first, which
     * is a deliberate act and reversible.
     */
    if (!remaining.length && policy.requirePasskey) {
      return json({
        ok: false,
        error: 'This is the only passkey, and the administrator code is retired. '
          + 'Allow the code again before removing it.',
      }, 409);
    }
    await saveCredentials(store, remaining);
    return json({ ok: true, passkeys: summarise(remaining) });
  }

  if (action === 'rename') {
    const id = String(body.id ?? '');
    const name = String(body.name ?? '').trim().slice(0, 60);
    if (!name) return json({ ok: false, error: 'A passkey needs a name.' }, 400);
    const credentials = await listCredentials(store);
    await saveCredentials(store, credentials.map((c) => (c.id === id ? { ...c, name } : c)));
    return json({ ok: true, passkeys: summarise(await listCredentials(store)) });
  }

  if (action === 'policy') {
    const requirePasskey = body.requirePasskey === true;
    const credentials = await listCredentials(store);
    // Retiring the code with no passkey enrolled would lock the door and throw
    // away the key, so it is simply not allowed.
    if (requirePasskey && !credentials.length) {
      return json({ ok: false, error: 'Enrol a passkey before retiring the code.' }, 409);
    }
    const policy = { requirePasskey, changedAt: new Date().toISOString().slice(0, 10) };
    await writePolicy(store, policy);
    return json({ ok: true, policy });
  }

  return json({ ok: false, error: 'Unknown action.' }, 400);
};
