// The cache on the GPU-cut path gives its slots back in the order the cut published, and in no
// other: before any, none; a page that arrived after the order's cut, or one it leaves out, never;
// a prefetch, only an old page.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createGpuPageCache } from './pages.ts'
import { PRIORITY_PREFETCH } from '../../streaming/priority.ts'
import { orderOf } from './order.fixture.ts'

async function cacheOf(keys: string[]) {
  const { device } = fakeDevice({ limits: { maxBufferSize: 1024 } })
  const bytes = { read: async () => new Uint8Array([1, 2, 3, 4]) }
  const cache = createGpuPageCache(device, bytes, { pageBytes: 4, slots: keys.length })
  for (const key of keys) await cache.load(key)
  return cache
}

test('a published order evicts in its order, and never a page it leaves out', async () => {
  const cache = await cacheOf(['read', 'old', 'older'])
  // `read` was read by a view this frame: the queue leaves it out, though nothing pins it.
  cache.evictInOrder(orderOf(['older', 'old'], cache.arrivals))
  await cache.load('a')
  assert.ok(!cache.get('older') && cache.get('old') && cache.get('read'))
  await cache.load('b')
  assert.ok(!cache.get('old') && cache.get('read'))
  // The order is spent: the burst stops, the page left out stays.
  await assert.rejects(cache.load('c'), /POOL_FULL/)
})

test('before any order, a full pool takes no page: the arrival waits for the GPU', async () => {
  const cache = await cacheOf(['a', 'b'])
  await assert.rejects(cache.load('c'), /POOL_FULL/)
  assert.equal(cache.room(), 0)
  cache.evictInOrder(orderOf(['a'], cache.arrivals))
  assert.equal(cache.room(), 1)
  cache.evictInOrder(undefined)
  await assert.rejects(cache.load('c'), /POOL_FULL/)
  assert.ok(cache.get('a') && cache.get('b'))
})

test('a pinned page the order lists waits for its unpin, and is offered before what follows', async () => {
  const cache = await cacheOf(['a', 'b', 'c'])
  cache.pin('a')
  cache.evictInOrder(orderOf(['a', 'b', 'c'], cache.arrivals))
  await cache.load('d')
  assert.ok(cache.get('a') && !cache.get('b'), 'the pinned page stays')
  cache.unpin('a')
  await cache.load('e')
  assert.ok(!cache.get('a') && cache.get('c'), 'then it goes first')
})

test('a page that arrived after the order was made is never its victim, whatever its key', async () => {
  const cache = await cacheOf(['a', 'b', 'c'])
  cache.evictInOrder(orderOf(['a', 'b', 'c'], cache.arrivals))
  // `a` leaves and comes back before the next order: the order in hand names the page that left.
  cache.unload('a')
  await cache.load('a')
  await cache.load('d')
  assert.ok(cache.get('a') && !cache.get('b'), 'the page come back stays, the next listed goes')
})

test('a prefetch takes the place of an old page alone, never of one used of late', async () => {
  const cache = await cacheOf(['old', 'late'])
  cache.evictInOrder(orderOf(['old', 'late'], cache.arrivals, 1))
  assert.deepEqual([cache.room(true), cache.room()], [1, 2])
  await cache.load('ahead', undefined, false, PRIORITY_PREFETCH)
  assert.ok(!cache.get('old') && cache.get('late'))
  await assert.rejects(cache.load('ahead2', undefined, false, PRIORITY_PREFETCH), /POOL_FULL/)
  // A page the camera asks for takes the rest.
  await cache.load('camera')
  assert.ok(!cache.get('late'))
})

test('while the cut the frames draw is held, no page leaves', async () => {
  const cache = await cacheOf(['a', 'b'])
  let held = true
  cache.evictInOrder(orderOf(['a', 'b'], cache.arrivals, 2, () => !held))
  assert.equal(cache.room(), 0)
  await assert.rejects(cache.load('c'), /POOL_FULL/)
  assert.ok(!cache.holds('missing') && cache.holds('a'), 'the pool keeps what it holds')
  held = false
  assert.ok(!cache.holds('a'), 'open again, the order gives it up')
  await cache.load('c')
  assert.ok(!cache.get('a'))
})

test('each entry of the order is read once, as victims are taken', async () => {
  const keys = Array.from({ length: 64 }, (_, i) => `k${i}`)
  const cache = await cacheOf(keys)
  let reads = 0
  const order = orderOf(keys, cache.arrivals)
  cache.evictInOrder({ ...order, keyAt: (at) => (reads++, keys[at]) })
  for (let i = 0; i < 8; i++) await cache.load(`new${i}`)
  const gone = keys.filter((key) => !cache.get(key))
  assert.deepEqual(gone, keys.slice(0, 8))
  assert.equal(reads, 8)
})
