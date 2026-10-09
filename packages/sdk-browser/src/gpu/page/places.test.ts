// A page that fits a quarter of a slot takes a quarter: a pool of slots sized for the largest
// cluster holds four small pages a slot (`places.ts`), each at its own offset, under the same
// eviction and the same pins. A pool full of pinned pages still refuses by name, and a resize keeps
// what it held.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuPageCache } from './pages.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

const LIMITS = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 }

/** A cache of `slots` slots of 64 bytes whose page `small k` is 16 bytes, `big k` 64. */
function pool(slots: number) {
  const { device: gpu, copies } = fakeDevice({ limits: LIMITS })
  const cache = createGpuPageCache(
    gpu,
    { read: async (key: string) => new Uint8Array(key.startsWith('big') ? 64 : 12) },
    { pageBytes: 64, slots },
  )
  return { cache, copies }
}

test('small pages take quarters: four a slot, each at its own offset, pinned as any page', async () => {
  const { cache } = pool(2)
  const keys = Array.from({ length: 8 }, (_, k) => `small ${k}`)
  for (const key of keys) {
    await cache.load(key)
    cache.pin(key, 'held')
  }
  const offsets = keys.map((key) => cache.get(key)!.offset)
  assert.deepEqual(
    [...offsets].sort((a, b) => a - b),
    [0, 16, 32, 48, 64, 80, 96, 112],
  )
  assert.equal(cache.unpinnedSlots(), 0, 'eight pages in two slots, every place pinned')
  await assert.rejects(cache.load('small 8'), /ALL_PAGES_PINNED/)
})

test('a whole page takes the slot of small pages none of which is pinned, never a pinned one', async () => {
  const { cache } = pool(2)
  for (const key of ['small 0', 'small 1', 'small 2', 'small 3']) await cache.load(key)
  await cache.load('big 0')
  cache.pin('big 0')
  cache.pin('small 0')
  // Slot 0 holds four small pages, one pinned; slot 1 the pinned big page: no slot can be freed.
  await assert.rejects(cache.load('big 1'), /ALL_PAGES_PINNED/)
  cache.unpin('small 0')
  await cache.load('big 1')
  assert.ok(cache.get('big 1') && cache.get('big 0'))
  for (const key of ['small 0', 'small 1', 'small 2', 'small 3'])
    assert.equal(cache.get(key), undefined)
})

test('a resize lays the quarters out again: what it keeps keeps its bytes, the rest leaves', async () => {
  const { cache, copies } = pool(3)
  for (const key of ['small 0', 'big 0', 'small 1', 'small 2', 'big 1']) await cache.load(key)
  cache.pin('big 1', 'held')
  cache.pin('small 2', 'held')
  const evicted = await cache.resize(1)
  // One slot: the held big page first; the held small page has no quarter left, nor the rest.
  assert.ok(cache.get('big 1'))
  assert.equal(cache.get('big 1')!.offset, 0)
  assert.deepEqual(evicted.sort(), ['big 0', 'small 0', 'small 1', 'small 2'])
  assert.ok(
    copies.some((copy) => copy.size === 64),
    'the kept page copied whole',
  )
  // Grown again, small pages share one slot.
  await cache.resize(2)
  for (const key of ['small 0', 'small 1']) await cache.load(key)
  assert.equal(
    Math.floor(cache.get('small 0')!.offset / 64),
    Math.floor(cache.get('small 1')!.offset / 64),
  )
})
