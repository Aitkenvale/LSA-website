import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  defaultStoredConfig,
  normaliseConfig,
  readConfig,
  visibleTo,
  writeConfig,
  type StoredConfig,
} from '../../lib/calendar/config-store';
import { meetsTier, readSession, sessionCookie } from '../../lib/calendar/tiers';

export const prerender = false;

/**
 * The shared calendar configuration.
 *
 * A reader gets only what their tier may know: names, colours, sections and
 * order, with private feed addresses removed. An administrator gets the whole
 * document, and is the only tier that may write it.
 */

function kv(): KVNamespace | undefined {
  return (env as Record<string, unknown>).SESSION as KVNamespace | undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const tier = await readSession(sessionCookie(request), env.SESSION_SECRET ?? '');
  const config = await readConfig(kv());

  if (meetsTier(tier, 'admin')) {
    // The only response that carries addresses.
    return json({ tier, admin: true, config });
  }
  // The location is not sensitive and every viewer needs it, since the Fast's
  // hours are worked out in the page.
  //
  // Cycle boundaries go only to those who can open the cycle view. They are
  // derived from published school terms and would harm nobody, but sending
  // them to a tier that cannot use them would be the beginning of the habit of
  // sending things because they seem harmless.
  return json({
    tier,
    admin: false,
    calendars: visibleTo(config, tier),
    location: config.location,
    ...(meetsTier(tier, 'community') ? { cycles: config.cycles } : {}),
  });
};

export const PUT: APIRoute = async ({ request }) => {
  const tier = await readSession(sessionCookie(request), env.SESSION_SECRET ?? '');
  if (!meetsTier(tier, 'admin')) {
    // Deliberately the same answer whether or not the document exists.
    return json({ ok: false, error: 'Not permitted.' }, 403);
  }

  const store = kv();
  if (!store) return json({ ok: false, error: 'No configuration store is bound.' }, 503);

  let incoming: unknown;
  try {
    incoming = await request.json();
  } catch {
    return json({ ok: false, error: 'Malformed configuration.' }, 400);
  }

  // Normalised rather than trusted: an unrecognised tier falls back to the
  // stricter value, so a malformed write cannot widen access to a calendar.
  const config: StoredConfig = normaliseConfig(incoming);
  await writeConfig(store, config);
  return json({ ok: true, config });
};

/** Reset to the calendars a community starts with. Administrators only. */
export const DELETE: APIRoute = async ({ request }) => {
  const tier = await readSession(sessionCookie(request), env.SESSION_SECRET ?? '');
  if (!meetsTier(tier, 'admin')) return json({ ok: false, error: 'Not permitted.' }, 403);
  const store = kv();
  if (!store) return json({ ok: false, error: 'No configuration store is bound.' }, 503);
  const config = defaultStoredConfig();
  await writeConfig(store, config);
  return json({ ok: true, config });
};
