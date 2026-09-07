/**
 * Photographs kept against a day.
 *
 * Against a day, not against an event. The events come from iCalendar feeds
 * whose identifiers belong to Microsoft: editing an occurrence in Outlook can
 * change it, recurrences carry synthesised ones, and republishing a calendar
 * reissues them. Photographs keyed on any of that would silently orphan.
 *
 * A date cannot be taken away. And for a record it is the truer key anyway —
 * a photograph is evidence of what happened on a day. If the event it belonged
 * to is later moved, the photograph should stay where it was taken.
 *
 * The bytes live in R2. So does the index, as one small JSON object per day
 * beside the images: reading a day is then a single GET rather than a HEAD for
 * every object, and editing a caption touches nothing else.
 */

import type { Tier } from './tiers.ts';
import { isTier } from './tiers.ts';

export interface Photo {
  /** Opaque id, also the object's name in the bucket. */
  id: string;
  /** What it shows. Written by whoever may edit; empty until someone does. */
  description: string;
  /** When the camera took it, where the file said so. ISO, or absent. */
  takenAt?: string;
  /** When it was added here. */
  addedAt: string;
  /** Pixel dimensions after resizing, so the viewer can size a frame. */
  width: number;
  height: number;
  bytes: number;
}

export interface DayPhotos {
  version: 1;
  /** Ordered as they were added. */
  photos: Photo[];
}

/**
 * Who may do what.
 *
 * Four separate tiers rather than one. Looking at a photograph, changing what
 * it says, taking a copy away and destroying it are different acts, and an
 * Assembly may reasonably draw the line in a different place for each. All
 * start at admin, which is where a thing being tried out belongs.
 */
export interface PhotoPermissions {
  view: Tier;
  upload: Tier;
  edit: Tier;
  download: Tier;
  delete: Tier;
}

export const DEFAULT_PHOTO_PERMISSIONS: PhotoPermissions = {
  view: 'admin',
  upload: 'admin',
  edit: 'admin',
  download: 'admin',
  delete: 'admin',
};

export function asPhotoPermissions(value: unknown): PhotoPermissions {
  const raw = (value ?? {}) as Partial<PhotoPermissions>;
  const pick = (v: unknown, fallback: Tier): Tier => (isTier(v) ? v : fallback);
  // A malformed tier must never widen access, so each falls back to admin
  // rather than to the most permissive thing that parses.
  return {
    view: pick(raw.view, DEFAULT_PHOTO_PERMISSIONS.view),
    upload: pick(raw.upload, DEFAULT_PHOTO_PERMISSIONS.upload),
    edit: pick(raw.edit, DEFAULT_PHOTO_PERMISSIONS.edit),
    download: pick(raw.download, DEFAULT_PHOTO_PERMISSIONS.download),
    delete: pick(raw.delete, DEFAULT_PHOTO_PERMISSIONS.delete),
  };
}

/**
 * How many photographs a day may hold.
 *
 * Two is what anyone expects to add; ten is where it stops. The ceiling is not
 * for storage — ten thousand would fit — but because this is a record of a day
 * rather than an album, and a cell that says 40 has stopped being a record and
 * become a place to put things.
 */
export const MAX_PHOTOS_PER_DAY = 10;

/** The longest side of a stored image, after resizing in the browser. */
export const MAX_IMAGE_EDGE = 2000;

/**
 * The largest upload accepted.
 *
 * A 2000px JPEG at reasonable quality lands well under a megabyte. Four is
 * generous enough that an unusual photograph is not refused, and small enough
 * that something which has not been resized at all is.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isPhotoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE.test(value);
}

/**
 * Object names.
 *
 * The date leads, so a day's images and its index sort together and a listing
 * of the bucket reads like a diary.
 */
export const indexKey = (date: string) => `photos/${date}.json`;
export const imageKey = (date: string, id: string) => `photos/${date}/${id}.jpg`;

/** An id with no meaning in it, so nothing is disclosed by the object's name. */
export function newPhotoId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function readDay(bucket: R2Bucket | undefined, date: string): Promise<DayPhotos> {
  if (!bucket) return { version: 1, photos: [] };
  const object = await bucket.get(indexKey(date));
  if (!object) return { version: 1, photos: [] };
  try {
    const parsed = (await object.json()) as Partial<DayPhotos>;
    return { version: 1, photos: Array.isArray(parsed.photos) ? parsed.photos : [] };
  } catch {
    // A corrupt index would otherwise take the day's photographs with it. The
    // images are still in the bucket, and this at least keeps the page working.
    return { version: 1, photos: [] };
  }
}

export async function writeDay(bucket: R2Bucket, date: string, day: DayPhotos): Promise<void> {
  if (!day.photos.length) {
    // An empty day leaves no index behind to be listed or read.
    await bucket.delete(indexKey(date));
    return;
  }
  await bucket.put(indexKey(date), JSON.stringify(day), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/**
 * How many photographs each of a set of days holds.
 *
 * The grid asks about a month at a time, so this reads the indexes rather than
 * listing the bucket: a listing would return every image object as well, and
 * the count is all the cell needs.
 */
export async function countsFor(
  bucket: R2Bucket | undefined,
  dates: string[],
): Promise<Record<string, number>> {
  if (!bucket || !dates.length) return {};
  const found = await Promise.all(
    dates.map(async (date) => [date, (await readDay(bucket, date)).photos.length] as const),
  );
  return Object.fromEntries(found.filter(([, n]) => n > 0));
}
