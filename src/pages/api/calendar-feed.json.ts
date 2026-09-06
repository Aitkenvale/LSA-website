import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { feedFor, readConfig } from '../../lib/calendar/config-store';
import { parseIcs, type IcsEvent } from '../../lib/calendar/ics';
import { readSession, sessionCookie } from '../../lib/calendar/tiers';

export const prerender = false;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Events from a linked calendar, for a caller entitled to them.
 *
 * The browser asks for a calendar by id, never by address. The address is held
 * in the shared configuration and resolved here, so it does not exist in the
 * page, in a response, or in anybody's browser storage.
 *
 * View labels are applied here too. Previously the real titles were sent and
 * replaced in the page, which hid them from the reader but not from anyone who
 * opened the network tab. A caller below a calendar's detail tier now receives
 * the label and nothing else — no title, no location, no description.
 */
const ALLOWED_HOSTS = new Set([
  'calendar.google.com',
  'www.google.com',
  'outlook.office365.com',
  'outlook.office.com',
  'outlook.live.com',
]);

function json(body: unknown, status = 200, cacheControl = 'no-store'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cacheControl },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const id = url.searchParams.get('id') ?? '';
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  if (!id || !ISO.test(from) || !ISO.test(to) || from > to) {
    return json({ error: 'id, from and to are required.' }, 400);
  }

  const tier = await readSession(sessionCookie(request), env.CALENDAR_SESSION_SECRET ?? '');
  const config = await readConfig((env as Record<string, unknown>).SESSION as KVNamespace | undefined);
  const entitled = feedFor(config, tier, id);
  if (!entitled) {
    // The same answer whether the calendar is missing, unconfigured, or simply
    // not for this tier — so the response cannot be used to enumerate what
    // exists.
    return json({ events: [] });
  }

  const { calendar, showsDetail } = entitled;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(calendar.icsUrl!);
  } catch {
    return json({ error: 'That calendar has an invalid address.' }, 502);
  }
  if (parsedUrl.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsedUrl.hostname)) {
    return json({ error: 'That calendar has an address we will not fetch.' }, 502);
  }

  let text: string;
  try {
    const res = await fetch(parsedUrl.toString(), {
      headers: { accept: 'text/calendar' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const gone = res.status === 404 || res.status === 417;
      return json(
        {
          error: gone
            ? 'That calendar could not be found — check the address is current and still shared.'
            : `The calendar service returned ${res.status}.`,
        },
        502,
      );
    }
    text = await res.text();
  } catch {
    return json({ error: 'Could not reach the calendar service.' }, 502);
  }
  if (!text.includes('BEGIN:VCALENDAR')) {
    return json({ error: 'That address did not return a calendar feed.' }, 502);
  }

  const events = parseIcs(text, from, to, 10);
  const label = calendar.viewLabel?.trim();

  // Below the detail tier, only the shape of the day survives: that something
  // is on, when, and for how long.
  const payload: IcsEvent[] = showsDetail || !label
    ? events
    : events.map((e) => ({
        uid: e.uid,
        summary: label,
        date: e.date,
        endDate: e.endDate,
        allDay: e.allDay,
        startTime: e.startTime,
        endTime: e.endTime,
      }));

  return json({ events: payload }, 200, 'private, max-age=60');
};
