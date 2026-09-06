import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

/**
 * Checks the calendar administrator code.
 *
 * The code lives in the CALENDAR_ADMIN_CODE Worker secret and is compared here,
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
  const expected = env.CALENDAR_ADMIN_CODE;
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

  if (!timingSafeEqual(submitted, expected)) {
    return json({ ok: false }, 401);
  }
  return json({ ok: true });
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
