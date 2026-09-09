import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { parseIcs, type IcsEvent } from '../../lib/calendar/ics';

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

/**
 * Busy periods from a published Outlook calendar.
 *
 * Outlook's "Can view when I'm busy" level strips titles, locations and notes
 * before anything leaves Microsoft, so what arrives here is a list of times
 * with the word "Busy" against each — the same thing Google's free/busy scope
 * gives us, withheld at their end rather than at ours.
 *
 * Queensland keeps no daylight saving, so the offset is +10:00 all year and
 * the arithmetic needs no timezone library.
 */
function busyFromIcs(text: string, month: string, monthEnd: string) {
  const events: IcsEvent[] = parseIcs(text, `${month}-01`, monthEnd, 10);
  const dayAfter = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  };

  return events.map((event) => {
    if (event.allDay) {
      // An all-day booking runs to the start of the following day; endDate is
      // the last day it covers, not the moment it ends.
      const last = event.endDate ?? event.date;
      return { start: `${event.date}T00:00:00+10:00`, end: `${dayAfter(last)}T00:00:00+10:00` };
    }
    const start = `${event.date}T${event.startTime ?? '00:00'}:00+10:00`;
    let endDay = event.endDate ?? event.date;
    // A booking finishing earlier in the clock than it began has run past
    // midnight, so it ends the next day rather than lasting minus four hours.
    if (endDay === event.date && event.endTime && event.startTime && event.endTime <= event.startTime) {
      endDay = dayAfter(event.date);
    }
    return { start, end: `${endDay}T${event.endTime ?? '23:59'}:00+10:00` };
  });
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
  const icsUrl = secrets.VENUE_ICS_URL;
  if (!icsUrl) {
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

  // Serve from the edge cache when fresh (see the note on the cache header below)
  const cache = (globalThis as { caches?: { default: Cache } }).caches?.default;
  const cacheKey = new Request(url.toString());
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const [y, m] = month.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  try {
    const res = await fetch(icsUrl, {
      headers: { accept: 'text/calendar' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`calendar feed answered ${res.status}`);
    const busy = busyFromIcs(await res.text(), month, monthEnd);

    /*
     * Two minutes, not fifteen.
     *
     * The old window was chosen when the source was thought to be slow. The
     * published feed is generated per request — measured at seconds, not
     * hours — so the cache was the only real staleness the page had. Short
     * enough to be honest about a booking taken this morning, long enough
     * that a page reloaded a few times does not hammer Microsoft.
     */
    const response = json(
      { month, busy },
      200,
      { 'cache-control': 'public, max-age=60, s-maxage=120' },
    );
    if (cache) await cache.put(cacheKey, response.clone());
    return response;
  } catch (err) {
    /*
     * An error must never read as "the hall is free". Showing nothing booked
     * when the feed is unreachable would invite an enquiry for a date already
     * taken, so the page is told the truth: it could not find out.
     */
    console.error('availability error:', err);
    return json({ error: 'Could not load availability' }, 502);
  }
};
