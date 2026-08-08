import { SignJWT, importPKCS8 } from 'jose';

// Granular scope added by Google in 2024: can see availability only.
// (Defence in depth — the calendar share itself is also free/busy-only.)
const SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy';

// Access tokens last 1h; cache per isolate so warm requests skip a Google round-trip.
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(saEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token;

  // Secrets pasted into dashboards often have literal \n instead of newlines
  const pem = privateKeyPem.replace(/\\n/g, '\n');
  const key = await importPKCS8(pem, 'RS256');

  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(saEmail)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: now + data.expires_in };
  return data.access_token;
}

export interface BusyBlock {
  start: string;
  end: string;
}

export async function queryFreeBusy(
  token: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<BusyBlock[]> {
  const res = await fetch(FREEBUSY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone: 'Australia/Brisbane',
      items: [{ id: calendarId }],
    }),
  });
  if (!res.ok) {
    throw new Error(`freeBusy query failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as {
    calendars: Record<string, { busy?: BusyBlock[]; errors?: { reason: string }[] }>;
  };
  const cal = data.calendars?.[calendarId];
  if (!cal) throw new Error('freeBusy response missing calendar');
  if (cal.errors?.length) throw new Error(`freeBusy calendar error: ${cal.errors[0].reason}`);

  // Merge overlapping/adjacent blocks and strip to bare start/end —
  // the only data that ever reaches the browser.
  const sorted = (cal.busy ?? [])
    .map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const b of sorted) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  }
  return merged.map((b) => ({
    start: new Date(b.start).toISOString(),
    end: new Date(b.end).toISOString(),
  }));
}
