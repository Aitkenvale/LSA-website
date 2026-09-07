import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { readConfig } from '../../lib/calendar/config-store';
import {
  MAX_PHOTOS_PER_DAY, MAX_UPLOAD_BYTES, imageKey, isPhotoDate, newPhotoId, readDay, writeDay,
  type Photo,
} from '../../lib/calendar/photo-store';
import { meetsTier, readSession, sessionCookie } from '../../lib/calendar/tiers';

export const prerender = false;

/**
 * Photographs against a day.
 *
 * Each act is gated on its own permission rather than on one blanket check,
 * because looking at a photograph and destroying it are different things. The
 * tiers come from the shared calendar configuration, so an administrator sets
 * them once for everyone in the same place as everything else.
 *
 * Nothing here trusts the browser about who is asking. The session cookie is
 * signed and read on the server, and a request that fails its check is refused
 * before the bucket is touched.
 */

function bucket(): R2Bucket | undefined {
  return (env as Record<string, unknown>).PHOTOS as R2Bucket | undefined;
}

function kv(): KVNamespace | undefined {
  return (env as Record<string, unknown>).SESSION as KVNamespace | undefined;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

/** What this caller may do, decided on the server and told to the page. */
async function permissionsFor(request: Request) {
  const tier = await readSession(sessionCookie(request), env.SESSION_SECRET ?? '');
  const config = await readConfig(kv());
  const p = config.photos;
  return {
    tier,
    config,
    may: {
      view: meetsTier(tier, p.view),
      upload: meetsTier(tier, p.upload),
      edit: meetsTier(tier, p.edit),
      download: meetsTier(tier, p.download),
      delete: meetsTier(tier, p.delete),
    },
  };
}

/**
 * What a day holds, and what this caller may do with it.
 *
 * Someone who may not view is told nothing at all — not that photographs
 * exist, not how many. An empty answer and a withheld one look identical from
 * outside, which is the point.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const date = url.searchParams.get('date') ?? '';
  if (!isPhotoDate(date)) return json({ error: 'A date is required.' }, 400);

  const { may } = await permissionsFor(request);
  if (!may.view) return json({ photos: [], may: { ...may } });

  const day = await readDay(bucket(), date);
  return json({ photos: day.photos, may });
};

export const POST: APIRoute = async ({ request, url }) => {
  const store = bucket();
  if (!store) return json({ error: 'Photo storage is not configured.' }, 503);

  const date = url.searchParams.get('date') ?? '';
  if (!isPhotoDate(date)) return json({ error: 'A date is required.' }, 400);

  const { may } = await permissionsFor(request);
  if (!may.upload) return json({ error: 'Not permitted.' }, 403);

  const form = await request.formData().catch(() => null);
  const file = form?.get('photo');
  if (!(file instanceof File)) return json({ error: 'No photograph was sent.' }, 400);

  // Checked here as well as in the browser. The browser's resize is a courtesy
  // to the person uploading; this is the rule.
  if (file.size > MAX_UPLOAD_BYTES) {
    return json({ error: 'That photograph is too large. It should be resized first.' }, 413);
  }
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    return json({ error: 'Only JPEG, PNG and WebP images can be added.' }, 415);
  }

  const day = await readDay(store, date);
  if (day.photos.length >= MAX_PHOTOS_PER_DAY) {
    return json({ error: `A day holds at most ${MAX_PHOTOS_PER_DAY} photographs.` }, 409);
  }

  const id = newPhotoId();
  const width = Number(form?.get('width')) || 0;
  const height = Number(form?.get('height')) || 0;
  const takenAt = String(form?.get('takenAt') ?? '').trim();

  await store.put(imageKey(date, id), await file.arrayBuffer(), {
    httpMetadata: { contentType: 'image/jpeg' },
  });

  const photo: Photo = {
    id,
    description: '',
    takenAt: /^\d{4}-\d{2}-\d{2}/.test(takenAt) ? takenAt : undefined,
    addedAt: new Date().toISOString().slice(0, 10),
    width,
    height,
    bytes: file.size,
  };
  const photos = [...day.photos, photo];
  await writeDay(store, date, { version: 1, photos });
  return json({ ok: true, photos });
};

/** Change what a photograph says. */
export const PATCH: APIRoute = async ({ request, url }) => {
  const store = bucket();
  if (!store) return json({ error: 'Photo storage is not configured.' }, 503);

  const date = url.searchParams.get('date') ?? '';
  if (!isPhotoDate(date)) return json({ error: 'A date is required.' }, 400);

  const { may } = await permissionsFor(request);
  if (!may.edit) return json({ error: 'Not permitted.' }, 403);

  const body = (await request.json().catch(() => ({}))) as { id?: string; description?: string };
  const id = String(body.id ?? '');
  // Long enough for a sentence about who is in the photograph and why, short
  // enough that the lightbox stays a lightbox.
  const description = String(body.description ?? '').slice(0, 500);

  const day = await readDay(store, date);
  if (!day.photos.some((p) => p.id === id)) return json({ error: 'No such photograph.' }, 404);

  const photos = day.photos.map((p) => (p.id === id ? { ...p, description } : p));
  await writeDay(store, date, { version: 1, photos });
  return json({ ok: true, photos });
};

/**
 * Destroy a photograph.
 *
 * The index entry goes first. If the object delete then fails, the day reads
 * correctly and an orphan sits in the bucket costing a fraction of a cent —
 * the other order would leave an entry pointing at nothing, which the viewer
 * would present as a broken image.
 */
export const DELETE: APIRoute = async ({ request, url }) => {
  const store = bucket();
  if (!store) return json({ error: 'Photo storage is not configured.' }, 503);

  const date = url.searchParams.get('date') ?? '';
  const id = url.searchParams.get('id') ?? '';
  if (!isPhotoDate(date) || !id) return json({ error: 'A date and a photograph are required.' }, 400);

  const { may } = await permissionsFor(request);
  if (!may.delete) return json({ error: 'Not permitted.' }, 403);

  const day = await readDay(store, date);
  if (!day.photos.some((p) => p.id === id)) return json({ error: 'No such photograph.' }, 404);

  const photos = day.photos.filter((p) => p.id !== id);
  await writeDay(store, date, { version: 1, photos });
  await store.delete(imageKey(date, id));
  return json({ ok: true, photos });
};
