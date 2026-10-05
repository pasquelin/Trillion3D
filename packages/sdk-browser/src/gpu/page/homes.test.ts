import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuPageCache } from './pages.ts';
import { pageHomes } from './homes.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

const LIMITS = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 };
/** Three pages of their own sizes, the widest slot 40 bytes: 37 bytes padded to 40. */
const BYTES: Record<string, number> = { a: 10, b: 37, c: 8 };
const WIDTHS = new Map([
  ['a', 12],
  ['b', 40],
  ['c', 8],
]);
const source = { read: async (key: string) => new Uint8Array(BYTES[key] ?? 13).fill(7) };
const drained = (cache: ReturnType<typeof createGpuPageCache>) => {
  const keys: string[] = [],
    slots: number[] = [];
  cache.drainResidencyChanges(keys, slots);
  return keys.map((key, i) => [key, slots[i]]);
};

test('homes lie one after the other: disjoint, word-aligned, inside the bytes they sum to', () => {
  const homes = pageHomes(WIDTHS)!;
  assert.equal(homes.bytes, 60);
  const spans = [...homes.homes.values()].map(({ offset, bytes }) => [offset, offset + bytes]);
  assert.deepEqual(spans, [
    [0, 12],
    [12, 52],
    [52, 60],
  ]);
  assert.deepEqual(
    [...homes.homes.values()].map((home) => home.rank),
    [0, 1, 2],
  );
  assert.throws(() => pageHomes(new Map([['odd', 6]])), /INVALID_PAGE_HOME/);
  assert.equal(pageHomes(new Map()), undefined, 'no bytes, no homes: a fixed slot holds them');
});

test('a pool holding the whole catalogue writes each page at its home and holds their bytes alone', async () => {
  const { device, writes, buffers } = fakeDevice({ limits: LIMITS });
  const homes = pageHomes(WIDTHS)!;
  const cache = createGpuPageCache(device, source, { pageBytes: 40, slots: 3, homes });
  assert.equal(buffers.at(-1)!.size, 60, 'the homes, not three slots of 40');
  assert.equal(cache.stats().allocatedBytes, 60);
  await cache.load('c');
  await cache.load('b');
  assert.deepEqual(
    [cache.get('c')!.offset, cache.get('b')!.offset],
    [52, 12],
    'each at its own home, whatever the order of arrival',
  );
  assert.deepEqual(
    writes.map((write) => write.offset),
    [52, 12, 12 + 36],
    "b's 36 whole bytes, then its last byte padded to a word inside its home",
  );
  assert.deepEqual(drained(cache), [
    ['c', 13],
    ['b', 3],
  ]);
  assert.equal(cache.unpinnedSlots(), 3, 'one home still empty, two pages unpinned');
  assert.equal(cache.unload('b'), true);
  await cache.load('b');
  assert.equal(cache.get('b')!.offset, 12, 'a page comes back to its own home');
  await assert.rejects(cache.load('stranger'), /PAGE_HOME_MISSING/);
});

test('a page wider than its home is refused: it would write over its neighbour', async () => {
  const { device } = fakeDevice({ limits: LIMITS });
  const narrow = new Map([...WIDTHS, ['a', 8]]);
  const cache = createGpuPageCache(device, source, {
    pageBytes: 40,
    slots: 3,
    homes: pageHomes(narrow),
  });
  await assert.rejects(cache.load('a'), /PAGE_SIZE_MISMATCH/);
});

test('a pool that comes to hold the catalogue moves each page home, and leaves it slot by slot', async () => {
  const { device, copies, buffers } = fakeDevice({ limits: LIMITS });
  const homes = pageHomes(WIDTHS)!;
  const cache = createGpuPageCache(device, source, { pageBytes: 40, slots: 2, homes });
  assert.equal(cache.stats().allocatedBytes, 80, 'two slots of the widest page');
  await cache.load('a'); // slot 1
  await cache.load('b'); // slot 0
  drained(cache);
  // Fixed slots to homes: each page with all its slot, which holds its tails, to its home.
  assert.deepEqual(await cache.resize(3), []);
  assert.equal(buffers.at(-1)!.size, 60);
  assert.deepEqual(
    copies.map(({ fromOffset, toOffset, size }) => [fromOffset, toOffset, size]),
    [
      [40, 0, 12],
      [0, 12, 40],
    ],
    "no common prefix: each page's own span, its home's width",
  );
  assert.deepEqual(
    drained(cache),
    [
      ['a', 0],
      ['b', 3],
    ],
    'both arrive at their home, word offsets',
  );
  await cache.load('c');
  assert.deepEqual(drained(cache), [['c', 13]], 'an arrival takes its home');
  // A larger pool still holds the catalogue: nothing moves, no buffer is made.
  const made = buffers.length;
  assert.deepEqual(await cache.resize(5), []);
  assert.equal(buffers.length, made);
  // Homes to two fixed slots: every page is displaced, the least recent leaves.
  copies.length = 0;
  assert.deepEqual(await cache.resize(2), ['a']);
  assert.equal(cache.stats().allocatedBytes, 80);
  assert.deepEqual(
    copies.map(({ fromOffset, toOffset, size }) => [fromOffset, toOffset, size]),
    [
      [52, 0, 8],
      [12, 40, 40],
    ],
    'the most recent first, each from its home into the lowest free slot',
  );
  assert.deepEqual(drained(cache), [
    ['a', -1],
    ['c', 0],
    ['b', 10],
  ]);
  await cache.load('a');
  assert.ok(cache.get('a') && !cache.get('b'), 'fixed slots evict the least recent again');
});
