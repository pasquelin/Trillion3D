// The cache on the GPU-cut path gives its slots back in the order the cut published (#872).
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createGpuPageCache } from './pages.ts'

const orderOf = (keys: string[]) => ({ count: keys.length, keyAt: (at: number) => keys[at] })
async function cacheOf(keys: string[]) {
  const { device } = fakeDevice({ limits: { maxBufferSize: 1024 } })
  const bytes = { read: async () => new Uint8Array([1, 2, 3, 4]) }
  const cache = createGpuPageCache(device, bytes, { pageBytes: 4, slots: keys.length })
  for (const key of keys) await cache.load(key)
  return cache
}

test('a published order evicts in its order, and never a page it leaves out', async () => {
  const cache = await cacheOf(['read', 'old', 'older'])
  // `read` was read by the cut this frame: the queue leaves it out, though nothing pins it.
  cache.evictInOrder(orderOf(['older', 'old']))
  await cache.load('a')
  assert.ok(!cache.get('older') && cache.get('old') && cache.get('read'))
  await cache.load('b')
  assert.ok(!cache.get('old') && cache.get('read'))
  // The order is spent: the burst stops, the page left out stays.
  await assert.rejects(cache.load('c'), /ALL_PAGES_PINNED/)
  // Without a GPU cut, the least recent page goes first again.
  cache.evictInOrder(undefined)
  await cache.load('c')
  assert.ok(!cache.get('read'))
})

test('each entry of the order is read once, however many a lower tier holds', async () => {
  const keys = Array.from({ length: 64 }, (_, i) => `k${i}`)
  const cache = await cacheOf(keys)
  let reads = 0
  cache.evictInOrder({ count: keys.length, keyAt: (at) => (reads++, keys[at]) })
  for (const key of keys.slice(0, 60)) cache.touch(key, true)
  for (let i = 0; i < 8; i++) await cache.load(`new${i}`)
  // A page only a light cut reads is touched by the lower tier: the four camera pages go first,
  // then the lower tier's in order — never pinned, a camera page still takes them; no entry is
  // read twice.
  const gone = keys.filter((key) => !cache.get(key))
  assert.deepEqual(gone, [...keys.slice(0, 4), ...keys.slice(60)])
  assert.equal(reads, keys.length)
})
