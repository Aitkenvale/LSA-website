import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  VIC_CATALOGUE,
  VIC_DATES_PACKAGE,
  canLoadTerms,
  isAuState,
  type SchoolTerm,
} from '../../lib/calendar/school-terms';
import { meetsTier, readSession, sessionCookie } from '../../lib/calendar/tiers';

export const prerender = false;

/**
 * Fetch a state's school term dates, where the state publishes them as data.
 *
 * Only Victoria does, so this is one loader rather than eight. It is an
 * administrator's action — it changes what the whole community will see — and
 * it returns dates for the panel to display rather than writing them itself,
 * so nothing is committed until somebody has looked at it and saved.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** Victoria writes dates as d/m/yyyy; every other date in this project is ISO. */
function toIso(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * A minimal CSV reader.
 *
 * The file quotes fields containing commas, and a description in it runs to a
 * sentence or two, so splitting on commas alone tears rows apart.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Turn the catalogue's rows into terms.
 *
 * Each term appears as two rows, a start and an end, named "Term 2 2027 -
 * Start date". A term is kept only once both halves have been seen, so a file
 * that is mid-update cannot produce a term with one end missing.
 */
function termsFromVictoria(csv: string): SchoolTerm[] {
  const rows = parseCsv(csv);
  const header = rows.shift();
  if (!header) return [];
  const col = (name: string) => header.findIndex((h) => h.replace(/^﻿/, '').trim() === name);
  const iType = col('dateType');
  const iName = col('name');
  const iDate = col('important_date');
  if (iType < 0 || iName < 0 || iDate < 0) return [];

  const building = new Map<string, { year: number; term: 1 | 2 | 3 | 4; start?: string; end?: string }>();
  for (const row of rows) {
    if (row[iType] !== 'SCHOOL_TERM') continue;
    const m = /^Term\s+([1-4])\s+(\d{4})\s*-\s*(Start|End)\s+date/i.exec(row[iName] ?? '');
    const iso = toIso(row[iDate] ?? '');
    if (!m || !iso) continue;
    const term = Number(m[1]) as 1 | 2 | 3 | 4;
    const year = Number(m[2]);
    const key = `${year}-${term}`;
    const entry = building.get(key) ?? { year, term };
    if (m[3].toLowerCase() === 'start') entry.start = iso;
    else entry.end = iso;
    building.set(key, entry);
  }

  return [...building.values()]
    .filter((t): t is SchoolTerm => Boolean(t.start && t.end) && t.end! >= t.start!)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

export const GET: APIRoute = async ({ request, url }) => {
  const tier = await readSession(sessionCookie(request), env.SESSION_SECRET ?? '');
  if (!meetsTier(tier, 'admin')) return json({ ok: false, error: 'Not permitted.' }, 403);

  const state = url.searchParams.get('state');
  if (!isAuState(state)) return json({ ok: false, error: 'Unknown state.' }, 400);
  if (!canLoadTerms(state)) {
    return json({ ok: false, error: 'That state does not publish its term dates as data.' }, 400);
  }

  try {
    const meta = await fetch(`${VIC_CATALOGUE}?id=${VIC_DATES_PACKAGE}`, {
      headers: { accept: 'application/json' },
    });
    if (!meta.ok) return json({ ok: false, error: `The catalogue answered ${meta.status}.` }, 502);
    const pkg = (await meta.json()) as {
      result?: { resources?: { format?: string; url?: string }[] };
    };
    const csvUrl = pkg.result?.resources?.find((r) => (r.format ?? '').toUpperCase() === 'CSV')?.url;
    if (!csvUrl) return json({ ok: false, error: 'The catalogue listed no dates file.' }, 502);

    const file = await fetch(csvUrl);
    if (!file.ok) return json({ ok: false, error: `The dates file answered ${file.status}.` }, 502);
    const terms = termsFromVictoria(await file.text());
    if (!terms.length) {
      return json({ ok: false, error: 'No term dates were found in the file.' }, 502);
    }

    return json({
      ok: true,
      terms,
      source: {
        name: 'Victorian Department of Education, via Victorian Government important dates',
        url: 'https://discover.data.vic.gov.au/dataset/government-dates-api-data',
        checked: new Date().toISOString().slice(0, 10),
      },
    });
  } catch (err) {
    return json({ ok: false, error: `Could not reach the catalogue: ${String(err)}` }, 502);
  }
};
