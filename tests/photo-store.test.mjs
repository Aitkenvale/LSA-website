import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PHOTO_PERMISSIONS, asPhotoPermissions, countsFor, imageKey, indexKey,
  isPhotoDate, newPhotoId, readDay, writeDay,
} from '../src/lib/calendar/photo-store.ts';

/** A bucket that behaves enough like R2 for these to mean something. */
function fakeBucket(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key) {
      if (!store.has(key)) return null;
      const body = store.get(key);
      return { json: async () => JSON.parse(body), text: async () => body };
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

const day = (n) => ({ version: 1, photos: Array.from({ length: n }, (_, i) => ({
  id: `id${i}`, description: '', addedAt: '2026-09-07', width: 2000, height: 1500, bytes: 500000,
})) });

test('object names put a day together and disclose nothing', () => {
  assert.equal(indexKey('2026-09-14'), 'photos/2026-09-14.json');
  assert.equal(imageKey('2026-09-14', 'abc123'), 'photos/2026-09-14/abc123.jpg');
  // The index sorts beside its own day's images.
  assert.ok(imageKey('2026-09-14', 'a').startsWith('photos/2026-09-14'));
});

test('an id carries no meaning', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newPhotoId()));
  assert.equal(ids.size, 200, 'ids collided');
  for (const id of ids) assert.match(id, /^[0-9a-f]{24}$/);
});

test('only a real date is accepted as a key', () => {
  assert.ok(isPhotoDate('2026-09-14'));
  for (const bad of ['2026-9-14', 'yesterday', '', null, 42, '../../etc/passwd', '2026-09-14/x']) {
    assert.ok(!isPhotoDate(bad), `accepted ${JSON.stringify(bad)}`);
  }
});

test('a day round-trips', async () => {
  const bucket = fakeBucket();
  await writeDay(bucket, '2026-09-14', day(2));
  const back = await readDay(bucket, '2026-09-14');
  assert.equal(back.photos.length, 2);
  assert.equal(back.photos[0].id, 'id0');
});

test('a day with no photographs leaves no index behind', async () => {
  const bucket = fakeBucket();
  await writeDay(bucket, '2026-09-14', day(1));
  assert.ok(bucket.store.has(indexKey('2026-09-14')));
  await writeDay(bucket, '2026-09-14', day(0));
  assert.ok(!bucket.store.has(indexKey('2026-09-14')), 'an empty index was left');
});

test('a missing or corrupt index yields no photographs rather than failing', async () => {
  assert.deepEqual((await readDay(fakeBucket(), '2026-09-14')).photos, []);
  const broken = fakeBucket({ [indexKey('2026-09-14')]: '{not json' });
  assert.deepEqual((await readDay(broken, '2026-09-14')).photos, []);
  // No bucket bound at all — local development, or a missing binding.
  assert.deepEqual((await readDay(undefined, '2026-09-14')).photos, []);
});

test('counts cover a month and omit the empty days', async () => {
  const bucket = fakeBucket();
  await writeDay(bucket, '2026-09-14', day(3));
  await writeDay(bucket, '2026-09-20', day(1));
  const counts = await countsFor(bucket, ['2026-09-13', '2026-09-14', '2026-09-20']);
  assert.deepEqual(counts, { '2026-09-14': 3, '2026-09-20': 1 });
  assert.ok(!('2026-09-13' in counts), 'an empty day should not be listed at all');
});

// ---- permissions -----------------------------------------------------------

test('everything starts at admin', () => {
  assert.deepEqual(DEFAULT_PHOTO_PERMISSIONS, {
    view: 'admin', upload: 'admin', edit: 'admin', download: 'admin', delete: 'admin',
  });
});

test('the four acts are settable apart from one another', () => {
  const p = asPhotoPermissions({
    view: 'community', upload: 'assembly', edit: 'assembly', download: 'hoods', delete: 'admin',
  });
  assert.equal(p.view, 'community');
  assert.equal(p.download, 'hoods');
  assert.equal(p.delete, 'admin');
});

/*
 * A tier that does not parse must never widen access. Falling back to the
 * stored value's neighbour, or to public, would turn a typo into a disclosure.
 */
test('a malformed tier falls back to admin, never to something looser', () => {
  const p = asPhotoPermissions({ view: 'everyone', upload: '', edit: null, download: 7, delete: {} });
  assert.deepEqual(p, DEFAULT_PHOTO_PERMISSIONS);
  assert.deepEqual(asPhotoPermissions(undefined), DEFAULT_PHOTO_PERMISSIONS);
  assert.deepEqual(asPhotoPermissions('nonsense'), DEFAULT_PHOTO_PERMISSIONS);
});
