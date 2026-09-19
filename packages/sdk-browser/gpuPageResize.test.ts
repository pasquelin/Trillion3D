import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuPageCache } from './gpuPages.ts';
import { mockDevice } from '../../test/fixtures/gpuPages.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';

installGpuGlobals();
const LIMITS = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 };

test('the page pool shrinks while keeping its pages: copy, move, eviction of the last ones', async () => {
  const { device: gpu, copies, destroyed } = mockDevice(LIMITS);
  const cache = createGpuPageCache(
    gpu,
    { read: async () => new Uint8Array(8) },
    { pageBytes: 8, slots: 6 },
  );
  // Six pages, one per slot: a..f. Slots are taken from the top (5, 4, …).
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) await cache.load(key);
  cache.pin('a'); // slot 5, the highest: moved before any eviction
  const before = cache.buffer;
  const evicted = await cache.resize(3);
  // Slots 0..2 kept as they are (d, e, f); a (pinned), b, c outside the pool: nothing free,
  // so the oldest unpinned leave first — b and c — and a is evicted too.
  assert.equal(cache.stats().slots, 3);
  assert.equal(cache.stats().allocatedBytes, 24);
  assert.notEqual(cache.buffer, before);
  assert.equal(destroyed(), 1, 'the old buffer is destroyed');
  assert.equal(copies[0].size, 24, 'the common prefix is copied in one go');
  assert.deepEqual(evicted.sort(), ['a', 'b', 'c']);
  assert.ok(cache.get('d') && cache.get('e') && cache.get('f'));
  assert.equal(cache.get('a'), undefined);
  const keys: string[] = [],
    slots: number[] = [];
  cache.drainResidencyChanges(keys, slots);
  assert.deepEqual(keys.slice(-3).sort(), ['a', 'b', 'c']);
  assert.deepEqual(slots.slice(-3), [-1, -1, -1]);
});

test('a page outside the pool is moved into a free slot rather than evicted, and the log says so', async () => {
  const { device: gpu, copies } = mockDevice(LIMITS);
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
