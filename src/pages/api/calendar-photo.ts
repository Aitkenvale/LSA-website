import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { readConfig } from '../../lib/calendar/config-store';
import { imageKey, isPhotoDate, readDay } from '../../lib/calendar/photo-store';
import { meetsTier, readSession, sessionCookie } from '../../lib/calendar/tiers';

export const prerender = false;

/**
 * One photograph's bytes.
 *
 * Every request is checked. The bucket is not public and no signed or
 * unguessable URL is issued, because an address that grants access is an
 * address that can be forwarded, pasted into a message, or left in a browser
 * history — and it would still work months after someone's tier changed.
 *
 * The cost is that these cannot be cached at the edge. At a few photographs a
 * week that is no cost at all, and `private` keeps them out of any shared
 * cache while still letting the reader's own browser hold one.
 */

export const GET: APIRoute = async ({ request, url }) => {
  const bucket = (env as Record<string, unknown>).PHOTOS as R2Bucket | undefined;
  if (!bucket) return new Response('Not configured', { status: 503 });

  const date = url.searchParams.get('date') ?? '';
  const id = url.searchParams.get('id') ?? '';
  // The id is used to name an object, so it is checked rather than trusted:
  // anything but hexadecimal cannot reach the bucket at all.
  if (!isPhotoDate(date) || !/^[0-9a-f]{8,64}$/.test(id)) {
    return new Response('Not found', { status: 404 });
  }

  const tier = await readSession(sessionCookie(request), env.SESSION_SECRET ?? '');
  const config = await readConfig((env as Record<string, unknown>).SESSION as KVNamespace | undefined);

  const download = url.searchParams.get('download') === '1';
  // Taking a copy away is a separate permission from looking at one, so a
  // download is refused on its own terms even when viewing is allowed.
  const allowed = download
    ? meetsTier(tier, config.photos.view) && meetsTier(tier, config.photos.download)
    : meetsTier(tier, config.photos.view);

  /*
   * Refused and absent look identical from outside. Answering 403 for a
   * photograph that exists and 404 for one that does not would let anyone
   * discover which days have photographs by asking.
   */
  if (!allowed) return new Response('Not found', { status: 404 });

  const object = await bucket.get(imageKey(date, id));
  if (!object) return new Response('Not found', { status: 404 });

  const headers: Record<string, string> = {
    'content-type': 'image/jpeg',
    'cache-control': 'private, max-age=3600',
  };

  if (download) {
    // Named for the day it records, so a folder of them sorts into order.
    const day = await readDay(bucket, date);
    const index = day.photos.findIndex((p) => p.id === id);
    const suffix = index > 0 ? `-${index + 1}` : '';
    headers['content-disposition'] = `attachment; filename="${date}${suffix}.jpg"`;
  }

  return new Response(object.body, { headers });
};
