import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuPageCache } from './pages.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuDeviceLedger } from '../../../gpu/core/deviceLedger.ts'
import { destroyRetired } from '../../../gpu/core/frameRetire.ts'

const LIMITS = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 }

test('the page pool shrinks while keeping its pages: a page keeps its place, the others move, the last ones leave', async () => {
  const { device: gpu, copies, destroyed } = fakeDevice({ limits: LIMITS })
  const cache = createGpuPageCache(
    gpu,
    { read: async () => new Uint8Array(8) },
    { pageBytes: 8, slots: 6 },
  )
  // Six pages, one grain each, from the pool's first byte: a..f at 0, 8, …, 40.
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) await cache.load(key)
  cache.pin('a') // a keeps a place before any unpinned page
  const keys: string[] = [],
    slots: number[] = []
  cache.drainResidencyChanges(keys, slots)
  keys.length = slots.length = 0
  const before = cache.buffer
  const evicted = await cache.resize(3)
  // Three places for six pages: a (pinned) first, then the most recent — f, e. a keeps 0, f takes
  // the first free grain (8), e the next (16); b, c and d are evicted.
  assert.equal(cache.stats().slots, 3)
  assert.equal(cache.stats().allocatedBytes, 24)
  assert.notEqual(cache.buffer, before)
  assert.equal(destroyed.length, 0, 'the old buffer lives until the frame is submitted')
  destroyRetired(gpu)
  assert.equal(destroyed.length, 1, 'the old buffer is destroyed after it')
  assert.deepEqual(
    copies.map(({ fromOffset, toOffset, size }) => [fromOffset, toOffset, size]),
    [
      [0, 0, 8],
      [32, 16, 8],
      [40, 8, 8],
    ],
    'each kept page copied once, in the order of its old place',
  )
  assert.deepEqual(evicted.sort(), ['b', 'c', 'd'])
  assert.equal(cache.get('a')!.offset, 0, 'the pinned page keeps its place')
  assert.deepEqual([cache.get('f')!.offset, cache.get('e')!.offset], [8, 16])
  assert.equal(cache.get('d'), undefined)
  cache.drainResidencyChanges(keys, slots)
  assert.deepEqual(keys, ['b', 'c', 'd', 'e', 'f'], 'evictions, then the moves')
  assert.deepEqual(slots, [-1, -1, -1, 4, 2], 'word offsets of the new places')
})

test('the root cover keeps its place before every pinned page, and no covering page is evicted', async () => {
  const { device: gpu } = fakeDevice({ limits: LIMITS })
  const cache = createGpuPageCache(
    gpu,
    { read: async () => new Uint8Array(8) },
    { pageBytes: 8, slots: 4, cover: new Set(['root']) },
  )
  for (const key of ['root', 'a', 'b', 'c']) await cache.load(key)
  // Everything the image draws is pinned; the root cover is the oldest of all.
  for (const key of ['root', 'a', 'b', 'c']) cache.pin(key)
  const evicted = await cache.resize(2)
  assert.deepEqual(evicted.sort(), ['a', 'b'], 'pinned pages go before the root cover')
  assert.ok(cache.get('root'), 'the cover survives')
  assert.ok(cache.get('c'), 'and the most recent pinned page with it')
})

test('a page past the smaller pool is moved into a free grain rather than evicted, and the log says so', async () => {
  const { device: gpu, copies } = fakeDevice({ limits: LIMITS })
  const cache = createGpuPageCache(
    gpu,
    { read: async () => new Uint8Array(8) },
    { pageBytes: 8, slots: 4 },
  )
  for (const key of ['a', 'b', 'c', 'd']) await cache.load(key) // d at 24
  for (const key of ['a', 'b', 'c']) cache.unload(key)
  const evicted = await cache.resize(2)
  assert.deepEqual(evicted, [])
  assert.equal(cache.get('d')!.offset, 0, 'moved into the first free grain')
  assert.equal(copies.at(-1)!.toOffset, 0)
  assert.equal(copies.at(-1)!.fromOffset, 24)
  const keys: string[] = [],
    slots: number[] = []
  cache.drainResidencyChanges(keys, slots)
  assert.deepEqual([keys.at(-1), slots.at(-1)], ['d', 0])
  // The pool grows again: nothing moves, the new grains are free.
  await cache.resize(4)
  await cache.load('b')
  assert.equal(cache.get('b')!.offset, 8)
})

test('a covering page is kept through pins and unpins, and a pinned one counts once', async () => {
  const { device } = fakeDevice({ limits: LIMITS })
  const cache = createGpuPageCache(
    device,
    { read: async () => new Uint8Array(8) },
    { pageBytes: 8, slots: 3, cover: new Set(['root']) },
  )
  for (const key of ['root', 'a', 'b']) await cache.load(key)
  cache.pin('root')
  cache.pin('root')
  cache.pin('a')
  cache.pin('b')
  assert.equal(cache.stats().pinned, 3, 'a page pinned twice counts once')
  assert.equal(cache.unload('root'), false)
  await cache.resize(2)
  assert.ok(cache.get('root'), 'the cover is kept before the pinned page')
  cache.unpin('root')
  assert.equal(cache.stats().pinned, 1)
  cache.unpin('b')
  await cache.resize(1)
  assert.ok(cache.get('root'), 'unpinned, the cover still ranks first')
})

test('a pinned page a resize evicts is told once to whoever keeps pins', async () => {
  const { device } = fakeDevice({ limits: LIMITS })
  const cache = createGpuPageCache(
    device,
    { read: async () => new Uint8Array(8) },
    { pageBytes: 8, slots: 3 },
  )
  for (const key of ['a', 'b', 'c']) await cache.load(key)
  cache.pin('a')
  cache.pin('b')
  const evicted = await cache.resize(1)
  assert.deepEqual(evicted.sort(), ['a', 'c'], 'the newer pinned page keeps the one place')
  const told: string[] = []
  cache.takeUnpinned((key) => told.push(key))
  cache.takeUnpinned((key) => told.push(key))
  assert.deepEqual(told, ['a'], 'the pinned page that left, once; the unpinned one is no pin lost')
})

test('a page loaded pinned is pinned on arrival: a resize queued behind its load keeps it', async () => {
  const { device } = fakeDevice({ limits: LIMITS })
  const cache = createGpuPageCache(
    device,
    { read: async () => new Uint8Array(8) },
    { pageBytes: 8, slots: 4 },
  )
  // Nothing is awaited: the resize runs behind the four loads, before any caller could pin.
  const loads = [
    cache.load('root', undefined, true),
    cache.load('cover', undefined, true),
    cache.load('a'),
    cache.load('b'),
  ]
  const evicted = await cache.resize(2)
  await Promise.all(loads)
  assert.deepEqual(evicted.sort(), ['a', 'b'], 'the newer unpinned pages go, not the cover')
  assert.ok(cache.get('root') && cache.get('cover'))
  assert.equal(cache.stats().pinned, 2, 'both cover pages arrived pinned')
})

// A pool drawn again under a budget holds both buffers a moment, while its pages are copied: the
// budget admits the new one as the state the replacement leaves — the old one gone —, so a pool
// shrunk to make room for the frame is never refused for the copy itself.
test('a pool shrunk under a budget at its limit is admitted as the replacement it is', async () => {
  const { device: gpu, destroyed } = fakeDevice({ limits: LIMITS })
  let limit = 1 << 20
  const ledger = installGpuDeviceLedger(gpu, { limit: () => limit })
  const cache = createGpuPageCache(
    gpu,
    { read: async () => new Uint8Array(8) },
    { pageBytes: 8, slots: 6 },
  )
  for (const key of ['a', 'b', 'c']) await cache.load(key)
  // The limit holds what is in place and no byte more: the shrunk pool fits once the old is gone.
  limit = ledger.bytes
  const evicted = await cache.resize(3)
  assert.deepEqual(evicted, [])
  assert.equal(cache.stats().allocatedBytes, 24)
  destroyRetired(gpu)
  assert.equal(destroyed.length, 1, 'the old pool is freed')
  assert.equal(ledger.refusal, undefined, 'no refusal of the session')
})
