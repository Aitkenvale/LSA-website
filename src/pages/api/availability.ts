import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAccessToken, queryFreeBusy } from '../../lib/google-freebusy';

export const prerender = false;

const MONTHS_AHEAD = 3;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function monthIndex(key: string): number {
  const [y, m] = key.split('-').map(Number);
  return y * 12 + (m - 1);
}

export const GET: APIRoute = async (context) => {
  const url = new URL(context.request.url);
  const month = url.searchParams.get('month') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return json({ error: 'Invalid month' }, 400);
  }

  // Only serve current month .. +3 (Brisbane clock)
  const nowBrisbane = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date());
  const currentIdx = monthIndex(nowBrisbane.slice(0, 7));
  const requestedIdx = monthIndex(month);
  if (requestedIdx < currentIdx || requestedIdx > currentIdx + MONTHS_AHEAD) {
    return json({ error: 'Month out of range' }, 400);
  }

  // Cloudflare secrets (production) / .dev.vars (local dev)
  const secrets = env as Record<string, string | undefined>;
  const saEmail = secrets.GOOGLE_SA_EMAIL;
  const saKey = secrets.GOOGLE_SA_KEY;
  const calendarId = secrets.VENUE_CALENDAR_ID;
  if (!saEmail || !saKey || !calendarId) {
    // Local dev without credentials: serve sample data so the UI can be built/tested
    if (import.meta.env.DEV) {
      const sample = [
        { day: 12, s: 8, e: 22 },
        { day: 7, s: 18, e: 21 },
        { day: 19, s: 9, e: 12 },
        { day: 26, s: 14, e: 17 },
      ].map(({ day, s, e }) => {
        const d = String(day).padStart(2, '0');
        return {
          start: `${month}-${d}T${String(s).padStart(2, '0')}:00:00+10:00`,
          end: `${month}-${d}T${String(e).padStart(2, '0')}:00:00+10:00`,
        };
      });
      return json({ month, busy: sample, sample: true });
    }
    return json({ error: 'Calendar not configured yet' }, 503);
  }

  // Serve from the edge cache when fresh (15 min)
  const cache = (globalThis as { caches?: { default: Cache } }).caches?.default;
  const cacheKey = new Request(url.toString());
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const timeMin = `${month}-01T00:00:00+10:00`;
  const timeMax = `${next}-01T00:00:00+10:00`;

  try {
    const token = await getAccessToken(saEmail, saKey);
    const busy = await queryFreeBusy(token, calendarId, timeMin, timeMax);
    const response = json(
      { month, busy },
      200,
      { 'cache-control': 'public, max-age=300, s-maxage=900' },
    );
    if (cache) await cache.put(cacheKey, response.clone());
    return response;
  } catch (err) {
    console.error('availability error:', err);
    return json({ error: 'Could not load availability' }, 502);
  }
};
