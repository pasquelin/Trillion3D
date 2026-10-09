import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuPageCache } from './pages.ts'

const LIMITS = { maxBufferSize: 1024 }
// A slot is the size of the largest cluster: a small page that reuses it writes only its bytes,
// and the slot's tail keeps those of the previous page without anyone reading them — a row names
// its page offset and index count, and visibility as well as shading refuse any triangle beyond
// (`../../visibility/shader/visWgsl.ts:50`, `../../visibility/shader/shadeWgsl.ts:83`). Only the padding to the multiple
// of four that `writeBuffer` requires goes extra, as zeros: the whole words straight from the
// page's bytes, the last 1-3 through a zero-padded word. The three pages reuse the same
// slot, and the sample counts only what is actually transferred.
test('a reused GPU slot receives only the bytes of its page, padded to what the queue needs', async () => {
  const { device, writes } = fakeDevice({ limits: LIMITS })
  const octets: Record<string, number[]> = {
    large: [1, 2, 3, 4, 5, 6, 7, 8],
    small: [9, 10, 11, 12],
    odd: [13, 14, 15, 16, 17],
  }
  const source = { read: async (key: string) => new Uint8Array(octets[key]) }
  const cache = createGpuPageCache(device, source, { pageBytes: 8, slots: 1 })
  const pages = [await cache.load('large'), await cache.load('small'), await cache.load('odd')]
  const envois = writes.map((write) => [...written(write)]),
    slot = pages[0].slot
  assert.deepEqual(envois, [octets.large, octets.small, octets.odd.slice(0, 4), [17, 0, 0, 0]])
  assert.deepEqual([pages[1].slot, pages[2].slot], [slot, slot])
  assert.deepEqual(
    writes.map((write) => write.offset),
    [slot * 8, slot * 8, slot * 8, slot * 8 + 4],
  )
  assert.deepEqual([pages[0].bytes, pages[1].bytes, pages[2].bytes], [8, 4, 5])
  assert.equal(cache.stats().uploadedBytes, 8 + 4 + 8)
})
test('a cache hit does not fence the whole GPU device', async () => {
  const { device, writes, fences } = fakeDevice({ limits: LIMITS })
  const cache = createGpuPageCache(
    device,
    { read: async () => new Uint8Array([1, 2, 3, 4]) },
    { pageBytes: 8, slots: 1 },
  )
  await cache.load('a')
  const afterLoad = fences()
  await cache.load('a')
  assert.equal(fences(), afterLoad)
  assert.equal(writes.length, 1)
})
test('page fetches overlap while GPU uploads stay ordered', async () => {
  const { device, writes } = fakeDevice({ limits: LIMITS })
  let current = 0,
    peak = 0
  const source = {
    read: async () => {
      current++
      peak = Math.max(peak, current)
      await Promise.resolve()
      current--
      return new Uint8Array([1, 2, 3, 4])
    },
  }
  const cache = createGpuPageCache(device, source, { pageBytes: 8, slots: 2 })
  await Promise.all([cache.load('a'), cache.load('b')])
  assert.equal(peak, 2)
  assert.equal(writes.length, 2)
  assert.notEqual(writes[0].offset, writes[1].offset)
})
test('storage binding size is rejected before buffer creation', () => {
  assert.throws(
    () =>
      createGpuPageCache(
        fakeDevice({
          limits: { maxBufferSize: 1024, maxStorageBufferBindingSize: 8 },
          refuse: () => 'throw',
        }).device,
        { read: async () => new Uint8Array(4) },
        { pageBytes: 8, slots: 2 },
      ),
    /INVALID_PAGE_BUDGET/,
  )
})
test('unload releases an unpinned slot so later loads can reuse it', async () => {
  const { device, writes } = fakeDevice({ limits: LIMITS })
  const cache = createGpuPageCache(
    device,
    { read: async () => new Uint8Array([1, 2, 3, 4]) },
    { pageBytes: 8, slots: 1 },
  )
  await cache.load('a')
  assert.equal(cache.unload('a'), true)
  assert.equal(cache.get('a'), undefined)
  await cache.load('b')
  assert.equal(writes.length, 2)
})
test('GPU diagnostics expose queue, read, upload, pins and eviction while observer errors stay isolated', async () => {
  const { device } = fakeDevice({ limits: LIMITS })
  const events: string[] = []
  const cache = createGpuPageCache(
    device,
    { read: async () => new Uint8Array([1, 2, 3, 4]) },
    {
      pageBytes: 8,
      slots: 1,
      onDiagnostic: (event) => {
        events.push(event.phase)
        throw new Error('observer failure')
      },
    },
  )
  const first = await cache.load('a')
  await cache.load('a')
  cache.pin('a')
  assert.equal(cache.unload('a'), false)
  cache.unpin('a')
  assert.equal(cache.unload('a'), true)
  assert.ok(events.includes('gpu-page-catalogue'))
  assert.ok(events.includes('gpu-page-queue-wait'))
  assert.ok(events.includes('gpu-page-read-end'))
  assert.ok(events.includes('gpu-page-upload'))
  assert.ok(events.includes('gpu-page-cache-hit'))
  assert.ok(events.includes('gpu-page-pin'))
  assert.ok(events.includes('gpu-page-unload-refused'))
  assert.equal(first.generation, 1)
  await cache.dispose()
})
test('the residency log keeps one entry a key, and nothing of a page the host never saw', async () => {
  const { device } = fakeDevice({ limits: LIMITS })
  const cache = createGpuPageCache(
    device,
    { read: async () => new Uint8Array([1, 2, 3, 4]) },
    { pageBytes: 8, slots: 1 },
  )
  const drained = () => {
    const keys: string[] = [],
      slots: number[] = []
    cache.drainResidencyChanges(keys, slots)
    return keys.map((key, i) => [key, slots[i]])
  }
  await cache.load('a')
  assert.deepEqual(drained(), [['a', 0]])
  // Undrained, a thousand pages pass through the slot: `a`'s departure and the last arrival stay.
  for (let i = 0; i < 1000; i++) await cache.load(`p${i}`)
  assert.deepEqual(drained(), [
    ['a', -1],
    ['p999', 0],
  ])
  // A known page that leaves and comes back is told once, at its last place.
  await cache.load('a')
  await cache.load('p999')
  await cache.load('a')
  assert.deepEqual(drained(), [
    ['p999', -1],
    ['a', 0],
  ])
  await cache.dispose()
})
