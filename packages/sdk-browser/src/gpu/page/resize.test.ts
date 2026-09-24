import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuPageCache } from './pages.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

const LIMITS = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 };

test('the page pool shrinks while keeping its pages: copy, move, eviction of the last ones', async () => {
  const { device: gpu, copies, destroyed } = fakeDevice({ limits: LIMITS });
  const cache = createGpuPageCache(
    gpu,
    { read: async () => new Uint8Array(8) },
    { pageBytes: 8, slots: 6 },
  );
  // Six pages, one per slot: a..f. Slots are taken from the top (5, 4, …).
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) await cache.load(key);
  cache.pin('a'); // slot 5, the highest: it keeps a place before any unpinned page
  const before = cache.buffer;
  const evicted = await cache.resize(3);
  // Three places for six pages: a (pinned) first, then the most recent — f, e. Slots 0 and 1
  // survive with f and e; a takes slot 2, which d leaves free; b, c and d are evicted.
  assert.equal(cache.stats().slots, 3);
  assert.equal(cache.stats().allocatedBytes, 24);
  assert.notEqual(cache.buffer, before);
  assert.equal(destroyed.length, 1, 'the old buffer is destroyed');
  assert.equal(copies[0].size, 24, 'the common prefix is copied in one go');
  assert.deepEqual(evicted.sort(), ['b', 'c', 'd']);
  assert.ok(cache.get('e') && cache.get('f'));
  assert.equal(cache.get('a')!.slot, 2, 'moved into the slot the evicted page left');
  assert.equal(cache.get('d'), undefined);
  const keys: string[] = [],
    slots: number[] = [];
  cache.drainResidencyChanges(keys, slots);
  assert.deepEqual(keys.slice(-4), ['d', 'c', 'b', 'a'], 'evictions, then the move');
  assert.deepEqual(slots.slice(-4), [-1, -1, -1, 4], 'word offset of slot 2');
});

test('the held cover keeps its place before every pinned page, and no held page is evicted', async () => {
  const { device: gpu } = fakeDevice({ limits: LIMITS });
  const cache = createGpuPageCache(
    gpu,
    { read: async () => new Uint8Array(8) },
    { pageBytes: 8, slots: 4 },
  );
  for (const key of ['root', 'a', 'b', 'c']) await cache.load(key);
  // Everything the image draws is pinned; the root cover is the oldest of all.
  for (const key of ['root', 'a', 'b', 'c']) cache.pin(key);
  const evicted = await cache.resize(2, new Set(['root']));
  assert.deepEqual(evicted.sort(), ['a', 'b'], 'pinned pages go before the held cover');
  assert.ok(cache.get('root'), 'the cover survives');
  assert.ok(cache.get('c'), 'and the most recent pinned page with it');
});

test('a page outside the pool is moved into a free slot rather than evicted, and the log says so', async () => {
  const { device: gpu, copies } = fakeDevice({ limits: LIMITS });
  const cache = createGpuPageCache(
    gpu,
    { read: async () => new Uint8Array(8) },
    { pageBytes: 8, slots: 4 },
  );
  await cache.load('a'); // slot 3
  const evicted = await cache.resize(2);
  assert.deepEqual(evicted, []);
  assert.equal(cache.get('a')!.slot, 0, 'moved into the lowest free slot');
  assert.equal(copies.at(-1)!.toOffset, 0);
  assert.equal(copies.at(-1)!.fromOffset, 24);
  const keys: string[] = [],
    slots: number[] = [];
  cache.drainResidencyChanges(keys, slots);
  assert.deepEqual([keys.at(-1), slots.at(-1)], ['a', 0]);
  // The pool grows again: nothing moves, the new slots are free.
  await cache.resize(4);
  await cache.load('b');
  assert.equal(cache.get('b')!.slot, 3);
});
