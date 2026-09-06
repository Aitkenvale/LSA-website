/**
 * Viewer tiers, and the signed session that carries one.
 *
 * The calendar shows different things to different people. Rather than hiding
 * detail in the page — which only hides it from the reader, not from anyone who
 * opens the network tab — the tier travels with the request and the server
 * decides what to send.
 *
 * Tiers are a ladder: each includes everything below it. A neighbourhood
 * coordinator is also a community member, and an Assembly member is both.
 *
 * The middle tiers share one code each rather than having accounts. That is
 * deliberate. The community tier could run to hundreds of people, which no
 * per-person system does for free, and what it protects — which home a Feast is
 * at, by family name and not by address — is a publication boundary rather than
 * a secret.
 *
 * Administrator sits on the same ladder but has a different door. It can change
 * what everyone else sees and can read every calendar's address, so it will be
 * per-person passkeys. It is on the ladder so that entitlement is one
 * comparison everywhere; only the way in differs.
 */

export const TIERS = ['public', 'community', 'hoods', 'assembly', 'admin'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABELS: Record<Tier, string> = {
  public: 'Public',
  community: 'Community member',
  hoods: 'Neighbourhood',
  assembly: 'Assembly and Secretariat',
  admin: 'Administrator',
};

/** Position on the ladder; higher sees more. */
export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}

/** Does `held` reach at least `required`? */
export function meetsTier(held: Tier, required: Tier): boolean {
  return tierRank(held) >= tierRank(required);
}

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Session token
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = 'cal_tier';

/** How long a signed-in session lasts, by tier. */
const SESSION_DAYS: Record<Tier, number> = {
  public: 0,
  // Long, because signing in again is friction for something this low-stakes.
  community: 180,
  hoods: 90,
  // Shortest of the three: it sees everything, so a forgotten session on a
  // shared or lost device matters most here.
  assembly: 30,
  // Shorter still. This tier can change what everyone else sees and can read
  // every calendar's address, so a session left open is the worst case.
  admin: 1,
};

interface SessionPayload {
  tier: Tier;
  /** Expiry, epoch seconds. */
  exp: number;
}

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Issue a session token for a tier.
 *
 * Signed rather than encrypted: the tier is not a secret, and the only thing
 * that matters is that a reader cannot mint one for a tier they did not earn.
 */
export async function signSession(tier: Tier, secret: string, now = Date.now()): Promise<string> {
  const payload: SessionPayload = {
    tier,
    exp: Math.floor(now / 1000) + SESSION_DAYS[tier] * 86400,
  };
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** The tier a token carries, or 'public' if it is missing, forged or expired. */
export async function readSession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<Tier> {
  if (!token || !secret) return 'public';
  const [body, signature] = token.split('.');
  if (!body || !signature) return 'public';

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      base64UrlDecode(signature),
      encoder.encode(body),
    );
  } catch {
    return 'public';
  }
  if (!valid) return 'public';

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as SessionPayload;
    if (!isTier(payload.tier)) return 'public';
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) return 'public';
    return payload.tier;
  } catch {
    return 'public';
  }
}

/** Read the session cookie out of a request. */
export function sessionCookie(request: Request): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return undefined;
}

/** The Set-Cookie value for a session, or for clearing one. */
export function sessionCookieHeader(token: string | null, tier: Tier = 'public'): string {
  const base = `${SESSION_COOKIE}=${token ?? ''}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  return token ? `${base}; Max-Age=${SESSION_DAYS[tier] * 86400}` : `${base}; Max-Age=0`;
}

/**
 * Compare without revealing, through timing, how much of a code was right.
 * Lengths are compared too, so pad to a common length first.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
