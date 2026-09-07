import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listCredentials, readPolicy } from '../../lib/calendar/passkey-store';
import { sessionCookieHeader, signSession, TIER_LABELS } from '../../lib/calendar/tiers';

export const prerender = false;

/**
 * Checks the calendar administrator code.
 *
 * The code lives in the ADMIN_CODE Worker secret and is compared here,
 * on the server. It is deliberately never placed in site settings: this
 * repository is public, so anything committed to it is readable by anyone, and
 * anything passed into the page is readable in the browser.
 *
 * This gates the settings drawer, which today edits per-browser preferences
 * only. It is a deterrent, not an authorisation boundary — when the calendar
 * grows member and public tiers, privileged data must be withheld by the
 * server rather than hidden by the page.
 */
export const POST: APIRoute = async ({ request }) => {
  const expected = env.ADMIN_CODE;
  if (!expected) {
    return json({ ok: false, error: 'No administrator code is configured for this site.' }, 503);
  }

  let submitted = '';
  try {
    const body = (await request.json()) as { code?: unknown };
    if (typeof body.code === 'string') submitted = body.code;
  } catch {
    return json({ ok: false }, 400);
  }

  /*
   * Once passkeys are enrolled and the code has been retired, this route stops
   * accepting it. What remains is ADMIN_RECOVERY_CODE, a Worker secret that is
   * normally not set at all — the way back in when every enrolled device is
   * lost at once. Leaving it unset is the intended state: a secret that exists
   * only during an emergency cannot be stolen during an ordinary week.
   *
   * The two are still compared in the same way and in the same order whatever
   * the policy, so a wrong code takes the same time to be refused either way.
   */
  const store = (env as Record<string, unknown>).SESSION as KVNamespace | undefined;
  const policy = await readPolicy(store);
  const enrolled = policy.requirePasskey ? (await listCredentials(store)).length > 0 : false;
  const recovery = (env as Record<string, unknown>).ADMIN_RECOVERY_CODE as string | undefined;

  const codeMatches = timingSafeEqual(submitted, expected);
  const recoveryMatches = recovery ? timingSafeEqual(submitted, recovery) : false;
  const accepted = enrolled ? recoveryMatches : codeMatches || recoveryMatches;

  if (!accepted) {
    return json(
      enrolled
        ? { ok: false, error: 'The administrator code has been retired. Use a passkey.' }
        : { ok: false },
      401,
    );
  }

  // Issue a session rather than only answering yes, so that later requests can
  // be judged the same way as every other tier: one signed cookie, one
  // comparison. Administrator sessions are deliberately short.
  const signing = env.SESSION_SECRET;
  if (!signing) {
    return json({ ok: false, error: 'Sign-in is not configured for this site.' }, 503);
  }
  const token = await signSession('admin', signing);
  return new Response(JSON.stringify({ ok: true, tier: 'admin', label: TIER_LABELS.admin }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'set-cookie': sessionCookieHeader(token, 'admin'),
    },
  });
};

/**
 * Compare without leaking the answer through how long the comparison took.
 * Lengths are compared too, so pad to a common length first.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
