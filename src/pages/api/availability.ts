import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { parseIcs, type IcsEvent } from '../../lib/calendar/ics';

export const prerender = false;

/**
 * How far ahead the booking grid may look, in months.
 *
 * Must match the constant of the same name in AvailabilityCalendar.astro: that
 * one decides which months the page offers, this one decides which it will
 * answer for, and a disagreement shows as a "next" arrow that errors when
 * clicked.
 *
 * Eighteen, because a hall is booked further ahead than it is enquired about.
 * At three months the grid stopped inside the current year, so anyone planning
 * a wedding or a conference was told nothing at all.
 */
const MONTHS_AHEAD = 18;

/**
 * How far ahead the published Outlook feed actually carries bookings.
 *
 * NOT the same thing as MONTHS_AHEAD, and the difference is the whole point of
 * this constant. Outlook publishes a ROLLING TWELVE MONTHS, not the calendar.
 * Past that edge the feed is still perfectly reachable and simply stops, so a
 * month beyond it returns no busy blocks — which, left alone, the grid would
 * draw as a completely free hall. That is worse than an outage: an outage is
 * visible, this is confidently wrong, and it would invite an enquiry for a date
 * already taken. The catch block below guards the unreachable case for exactly
 * this reason; the horizon walks straight around that guard.
 *
 * Measured 2026-10-18. The Centre has a standing Mon/Thu 18:00–20:00 booking.
 * The feed served it in unbroken rhythm to Mon 18 Oct 2027 and stopped; the
 * next instance, Thu 21 Oct, was absent. That is twelve months to the day from
 * the date of measurement — a series cut mid-rhythm on today+12mo is a
 * publishing horizon, not the end of the bookings.
 *
 * Because it rolls daily it is a DATE, not a month: today it is good to the
 * 18th of the twelfth month and unknown for the rest of it. The page is sent
 * that date and greys out what lies beyond, rather than claiming it is free.
 *
 * If Microsoft changes the window, re-measure and change this: too small wastes
 * real data, too large resurrects the lie.
 */
const FEED_HORIZON_MONTHS = 12;

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
 * The last day the feed can be trusted to know about: `from` plus
 * FEED_HORIZON_MONTHS.
 *
 * Clamped to the end of the target month rather than allowed to roll over, so
 * 29 February lands on 28 February and never on 1 March. Erring a day early
 * costs one day of real data; erring a day late claims a day we do not have.
 */
function feedHorizon(from: string): string {
  const [y, m, d] = from.split('-').map(Number);
  const target = m - 1 + FEED_HORIZON_MONTHS;
  const ty = y + Math.floor(target / 12);
  const tm = (((target % 12) + 12) % 12) + 1;
  const lastOfMonth = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const td = Math.min(d, lastOfMonth);
  return `${ty}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
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

  // Only serve current month .. +MONTHS_AHEAD (Brisbane clock)
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
      return json({ month, busy: sample, sample: true, horizon: feedHorizon(nowBrisbane) });
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
      { month, busy, horizon: feedHorizon(nowBrisbane) },
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
