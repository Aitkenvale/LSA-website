import type { APIRoute } from 'astro';
import { parseIcs } from '../../lib/calendar/ics';

export const prerender = false;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Hosts this endpoint will fetch from.
 *
 * This allowlist is the whole security of the endpoint and must stay narrow.
 * Without it this is an open proxy: anyone could ask the Worker to fetch an
 * arbitrary URL on their behalf, including addresses reachable only from inside
 * Cloudflare's network. Google Calendar's secret iCal addresses live on
 * calendar.google.com, so that is all we allow.
 */
const ALLOWED_HOSTS = new Set([
  // Google Calendar secret iCal addresses
  'calendar.google.com',
  'www.google.com',
  // Microsoft 365 / Outlook published calendars
  'outlook.office365.com',
  'outlook.office.com',
  'outlook.live.com',
]);

export const GET: APIRoute = async ({ url }) => {
  const target = url.searchParams.get('url') ?? '';
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';

  if (!ISO.test(from) || !ISO.test(to) || from > to) {
    return json({ error: 'from and to must be YYYY-MM-DD, from <= to' }, 400);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(target);
  } catch {
    return json({ error: 'url is not a valid address' }, 400);
  }
  if (parsedUrl.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsedUrl.hostname)) {
    return json(
      {
        error:
          'Only Google Calendar or Outlook iCal addresses are accepted ' +
          '(calendar.google.com or outlook.office365.com).',
      },
      400,
    );
  }

  let text: string;
  try {
    const res = await fetch(parsedUrl.toString(), {
      headers: { accept: 'text/calendar' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      // Outlook answers a stale or unpublished calendar with 404 or 417, and
      // Google with 404, so both point at the same thing: the address is wrong
      // or has been revoked.
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

  return json(
    { events: parseIcs(text, from, to, 10) },
    200,
    // Short cache: a booking added in Google should appear without a long wait,
    // but repeated views within a few minutes should not re-fetch.
    'public, max-age=60, s-maxage=300',
  );
};

function json(body: unknown, status = 200, cacheControl = 'no-store'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cacheControl },
  });
}
