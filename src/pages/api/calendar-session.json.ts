import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  SESSION_COOKIE,
  TIER_LABELS,
  isTier,
  readSession,
  sessionCookie,
  sessionCookieHeader,
  signSession,
  timingSafeEqual,
  type Tier,
} from '../../lib/calendar/tiers';

export const prerender = false;

/**
 * Signing in, out, and reporting which tier the caller holds.
 *
 * The three signed-in tiers each have one shared code, kept as a Worker secret.
 * The codes never reach the browser: a caller sends a code and gets back a
 * signed cookie naming the tier, or nothing.
 *
 * Codes are checked from the top down so that if two were ever set to the same
 * value, the holder gets the lower privilege rather than the higher.
 */
const CODE_SECRETS: { tier: Tier; secretName: string }[] = [
  { tier: 'community', secretName: 'CALENDAR_CODE_COMMUNITY' },
  { tier: 'hoods', secretName: 'CALENDAR_CODE_HOODS' },
  { tier: 'assembly', secretName: 'CALENDAR_CODE_ASSEMBLY' },
];

/**
 * Attempts allowed from one address before it has to wait.
 *
 * Short shared codes are guessable by a machine even when they are not by a
 * person, so this is the control that actually matters here. Counted in the KV
 * namespace the Worker already has bound.
 */
const MAX_ATTEMPTS = 8;
const WINDOW_SECONDS = 900;

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders },
  });
}

function signingSecret(): string {
  return (env as Record<string, unknown>).CALENDAR_SESSION_SECRET as string || '';
}

/** Count a failed attempt, and report whether this address is now locked out. */
async function tooManyAttempts(request: Request): Promise<boolean> {
  const kv = (env as Record<string, unknown>).SESSION as KVNamespace | undefined;
  if (!kv) return false; // No store bound — fail open rather than lock everyone out.
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const key = `calendar-auth-attempts:${ip}`;
  const current = Number((await kv.get(key)) ?? '0');
  if (current >= MAX_ATTEMPTS) return true;
  await kv.put(key, String(current + 1), { expirationTtl: WINDOW_SECONDS });
  return false;
}

async function clearAttempts(request: Request): Promise<void> {
  const kv = (env as Record<string, unknown>).SESSION as KVNamespace | undefined;
  if (!kv) return;
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  await kv.delete(`calendar-auth-attempts:${ip}`);
}

/** Which tier the caller currently holds. */
export const GET: APIRoute = async ({ request }) => {
  const tier = await readSession(sessionCookie(request), signingSecret());
  return json({ tier, label: TIER_LABELS[tier] });
};

/** Exchange a code for a session. */
export const POST: APIRoute = async ({ request }) => {
  const secret = signingSecret();
  if (!secret) {
    return json({ ok: false, error: 'Sign-in is not configured for this site.' }, 503);
  }

  let submitted = '';
  try {
    const body = (await request.json()) as { code?: unknown };
    if (typeof body.code === 'string') submitted = body.code.trim();
  } catch {
    return json({ ok: false }, 400);
  }
  if (!submitted) return json({ ok: false, error: 'Enter a code.' }, 400);

  if (await tooManyAttempts(request)) {
    return json(
      { ok: false, error: 'Too many attempts. Wait a few minutes and try again.' },
      429,
    );
  }

  let matched: Tier | null = null;
  for (const { tier, secretName } of CODE_SECRETS) {
    const expected = (env as Record<string, unknown>)[secretName] as string | undefined;
    // Every configured code is compared, rather than stopping at the first
    // match, so the time taken does not reveal which tier a code belongs to.
    if (expected && timingSafeEqual(submitted, expected) && !matched) matched = tier;
  }

  if (!matched) {
    return json({ ok: false, error: 'That code was not recognised.' }, 401);
  }

  await clearAttempts(request);
  const token = await signSession(matched, secret);
  return json(
    { ok: true, tier: matched, label: TIER_LABELS[matched] },
    200,
    { 'set-cookie': sessionCookieHeader(token, matched) },
  );
};

/** Sign out. */
export const DELETE: APIRoute = async () =>
  json({ ok: true, tier: 'public' }, 200, { 'set-cookie': sessionCookieHeader(null) });
