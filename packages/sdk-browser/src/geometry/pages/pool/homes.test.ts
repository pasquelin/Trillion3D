import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuPageCache, type GpuPageCache } from './pages.ts'
import { pageHomes } from './homes.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'

const LIMITS = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 }
/** Three pages of their own sizes, the widest 40 bytes: 37 bytes padded to 40. */
const BYTES: Record<string, number> = { a: 10, b: 37, c: 8 }
const WIDTHS = new Map([
  ['a', 12],
  ['b', 40],
  ['c', 8],
])
const source = { read: async (key: string) => new Uint8Array(BYTES[key] ?? 13).fill(7) }
const drained = (cache: GpuPageCache) => {
  const keys: string[] = [],
    slots: number[] = []
  cache.drainResidencyChanges(keys, slots)
  return keys.map((key, i) => [key, slots[i]])
}

test('homes lie one after the other: disjoint, word-aligned, inside the bytes they sum to', () => {
  const homes = pageHomes(WIDTHS)!
  assert.equal(homes.bytes, 60)
  const spans = [...homes.homes.values()].map(({ offset, bytes }) => [offset, offset + bytes])
  assert.deepEqual(spans, [
    [0, 12],
    [12, 52],
    [52, 60],
  ])
  assert.deepEqual(
    [...homes.homes.values()].map((home) => home.rank),
    [0, 1, 2],
  )
  assert.throws(() => pageHomes(new Map([['odd', 6]])), /INVALID_PAGE_HOME/)
  assert.equal(
    pageHomes(new Map()),
    undefined,
    'no bytes, no homes: grains of the widest hold them',
  )
})

test('a pool holding the whole catalogue writes each page at its home and holds their bytes alone', async () => {
  const { device, writes, buffers } = fakeDevice({ limits: LIMITS })
  const homes = pageHomes(WIDTHS)!
  const cache = createGpuPageCache(device, source, { pageBytes: 40, slots: 3, homes })
  assert.equal(buffers.at(-1)!.size, 60, 'the homes, not three of the widest')
  assert.equal(cache.stats().allocatedBytes, 60)
  await cache.load('c')
  await cache.load('b')
  assert.deepEqual(
    [cache.get('c')!.offset, cache.get('b')!.offset],
    [52, 12],
    'each at its own home, whatever the order of arrival',
  )
  assert.deepEqual(
    writes.map((write) => write.offset),
    [52, 12, 12 + 36],
    "b's 36 whole bytes, then its last byte padded to a word inside its home",
  )
  assert.deepEqual(drained(cache), [
    ['c', 13],
    ['b', 3],
  ])
  assert.equal(cache.room(), 1, 'one home still empty: no order gives the others up')
  assert.equal(cache.unload('b'), true)
  await cache.load('b')
  assert.equal(cache.get('b')!.offset, 12, 'a page comes back to its own home')
  await assert.rejects(cache.load('stranger'), /PAGE_HOME_MISSING/)
})

test('a page wider than its home is refused: it would write over its neighbour', async () => {
  const { device } = fakeDevice({ limits: LIMITS })
  const narrow = new Map([...WIDTHS, ['a', 8]])
  const cache = createGpuPageCache(device, source, {
    pageBytes: 40,
    slots: 3,
    homes: pageHomes(narrow),
  })
  await assert.rejects(cache.load('a'), /PAGE_SIZE_MISMATCH/)
})

test('a pool that comes to hold the catalogue moves each page home, and leaves it slot by slot', async () => {
  const { device, copies, buffers } = fakeDevice({ limits: LIMITS })
  // A hundred bytes of homes: more than two of the widest page hold.
  const homes = pageHomes(new Map([...WIDTHS, ['d', 40]]))!
  const cache = createGpuPageCache(device, source, { pageBytes: 40, slots: 2, homes })
  assert.equal(cache.stats().allocatedBytes, 80, 'two of the widest page')
  await cache.load('a') // its home's 12 bytes in a slot, at 0
  await cache.load('b') // a slot, at 40
  drained(cache)
  // Grains to homes: each page's bytes, its tails with them, to its home.
  assert.deepEqual(await cache.resize(3), [])
  assert.equal(buffers.at(-1)!.size, 100)
  assert.deepEqual(
    copies.map(({ fromOffset, toOffset, size }) => [fromOffset, toOffset, size]),
    [
      [0, 0, 12],
      [40, 12, 40],
    ],
    "each page's own span at its home's width; a page already home keeps its place",
  )
  assert.deepEqual(drained(cache), [['b', 3]], 'the page that moved, word offset of its home')
  await cache.load('c')
  assert.deepEqual(drained(cache), [['c', 13]], 'an arrival takes its home')
  // A larger budget still holds the catalogue in the same bytes: nothing moves, no buffer is made.
  const made = buffers.length
  assert.deepEqual(await cache.resize(5), [])
  assert.equal(buffers.length, made)
  // Homes to two of the widest: two slots, a page each, the latest arrivals kept.
  copies.length = 0
  assert.deepEqual(await cache.resize(2), ['a'])
  assert.equal(cache.stats().allocatedBytes, 80)
  assert.deepEqual(
    copies.map(({ fromOffset, toOffset, size }) => [fromOffset, toOffset, size]),
    [
      [12, 40, 40],
      [52, 0, 8],
    ],
    'c and b each to the first free slot, a left out',
  )
  assert.deepEqual(drained(cache), [
    ['a', -1],
    ['b', 10],
    ['c', 0],
  ])
  await cache.load('d', undefined, false, undefined, 'b')
  assert.ok(cache.get('d') && !cache.get('b'), 'a named victim gives its slot')
})

test('pages joining a pool that holds the catalogue take homes behind the others, every page where it was', async () => {
  const { device, copies, buffers } = fakeDevice({ limits: LIMITS })
  const cache = createGpuPageCache(device, source, {
    pageBytes: 40,
    slots: 3,
    homes: pageHomes(WIDTHS),
  })
  await cache.load('c')
  await cache.load('b')
  drained(cache)
  const evicted = await cache.resize(5, {
    pageBytes: 40,
    widths: new Map([
      ['d', 16],
      ['e', 8],
    ]),
  })
  assert.deepEqual(evicted, [])
  assert.equal(buffers.at(-1)!.size, 84, 'the homes of the three, then of the two')
  assert.equal(copies.at(-1)!.size, 48, 'the pages held are copied as they lie, in one run')
  assert.deepEqual(
    [cache.get('c')!.offset, cache.get('b')!.offset],
    [52, 12],
    'no page moved, none told to the log',
  )
  assert.deepEqual(drained(cache), [])
  BYTES.d = 16
  await cache.load('d')
  assert.equal(cache.get('d')!.offset, 60, 'the new page at the end of the homes')
  assert.equal(cache.stats().slots, 5)
})

test('a widest page made wider by the pages that joined takes every page to an aligned grain of it', async () => {
  const { device, copies } = fakeDevice({ limits: LIMITS })
  const cache = createGpuPageCache(device, source, { pageBytes: 12, slots: 2 })
  BYTES.a = 12
  BYTES.c = 8
  await cache.load('a')
  await cache.load('c')
  const was = ['a', 'c'].map((key) => cache.get(key)!.offset)
  drained(cache)
  const evicted = await cache.resize(2, { pageBytes: 40, widths: new Map() })
  assert.deepEqual(evicted, [])
  assert.equal(cache.stats().allocatedBytes, 80)
  for (const key of ['a', 'c'])
    assert.equal(cache.get(key)!.offset % 20, 0, `${key} at a grain of the wider widest page`)
  assert.equal(copies.length, 2, 'one copy a page')
  assert.deepEqual(
    drained(cache).map(([key]) => key),
    ['a', 'c'].filter((key, i) => cache.get(key)!.offset !== was[i]),
    'the log names the pages that moved',
  )
})
