import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';
import { generateAll } from '../../lib/calendar/registry';
import { indexOverrides, type DateOverride } from '../../lib/calendar/overrides';
import type { FeastOverrides } from '../../lib/calendar/bahai-generated';

export const prerender = false;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every generated (calculated) holy day in a window.
 *
 * This is pure arithmetic — no network, no ephemeris files — so it is cheap to
 * run per request in the Worker and is cached hard at the edge. Feast overrides
 * arrive as JSON because a community may hold its Feast on any day of the month.
 */
export const GET: APIRoute = async ({ url }) => {
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  if (!ISO.test(from) || !ISO.test(to) || from > to) {
    return new Response(JSON.stringify({ error: 'from and to must be YYYY-MM-DD, from <= to' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  // Guard against someone asking for a century in one request.
  if (Number(to.slice(0, 4)) - Number(from.slice(0, 4)) > 3) {
    return new Response(JSON.stringify({ error: 'range may not exceed three years' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  let feastOverrides: FeastOverrides = {};
  const raw = url.searchParams.get('feastOverrides');
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') feastOverrides = parsed as FeastOverrides;
    } catch {
      // A malformed override is not worth failing the request over; use defaults.
    }
  }

  // Verified dates are read here rather than accepted from the browser, so a
  // viewer cannot invent one.
  const entry = await getEntry('calendarOverrides', 'overrides');
  const dateOverrides = indexOverrides((entry?.data.overrides ?? []) as DateOverride[]);

  const occurrences = generateAll(from, to, { feastOverrides, dateOverrides });

  return new Response(JSON.stringify({ occurrences }), {
    headers: {
      'content-type': 'application/json',
      // Dates for a given window never change, bar a config edit.
      'cache-control': 'public, max-age=300, s-maxage=86400',
    },
  });
};
