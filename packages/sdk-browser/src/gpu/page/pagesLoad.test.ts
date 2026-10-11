// A load's life in the GPU page cache: aborted by its caller or by dispose, failed by its read,
// or answered by a page already resident — the source is asked only for what a load needs.
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuPageCache } from './pages.ts'

const LIMITS = { maxBufferSize: 1024 }
test('dispose aborts an in-flight load and does not write after destroy', async () => {
  const { device, writes, destroyed } = fakeDevice({ limits: LIMITS })
  let resume!: () => void
  const source = {
    read: async (_key: string, signal?: AbortSignal) =>
      new Promise<Uint8Array>((resolve, reject) => {
        const fail = () => reject(signal?.reason ?? new Error('aborted'))
        signal?.addEventListener('abort', fail, { once: true })
        if (signal?.aborted) {
          fail()
          return
        }
        resume = () => resolve(new Uint8Array([1, 2, 3, 4]))
      }),
  }
  const cache = createGpuPageCache(device, source, { pageBytes: 8, slots: 1 })
  const pending = cache.load('a')
  const closed = cache.dispose()
  resume?.()
  await assert.rejects(pending)
  await closed
  assert.equal(writes.length, 0)
  assert.equal(destroyed.length, 1)
})
test('an aborted concurrent load does not prevent a separate non-aborted load for the same key', async () => {
  const { device, writes } = fakeDevice({ limits: LIMITS })
  const controller = new AbortController()
  const source = {
    read: async (_key: string, signal?: AbortSignal) => {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted')
      return new Promise<Uint8Array>((resolve, reject) => {
        const fail = () => reject(signal?.reason ?? new Error('aborted'))
        signal?.addEventListener('abort', fail, { once: true })
        setTimeout(() => resolve(new Uint8Array([1, 2, 3, 4])), 10)
      })
    },
  }
  const cache = createGpuPageCache(device, source, { pageBytes: 8, slots: 1 })
  const load1 = cache.load('a', controller.signal)
  const load2 = cache.load('a')
  controller.abort(new Error('abort load1'))
  await assert.rejects(load1, /abort load1/)
  const page = await load2
  assert.equal(page.key, 'a')
  assert.equal(writes.length, 1)
})
test('a failed read fails its load at once: the cache asks its source once a load, never again on its own', async () => {
  const { device } = fakeDevice({ limits: LIMITS })
  let reads = 0
  const read = async () => {
    if (++reads === 1) throw new Error('offline')
    return new Uint8Array([1, 2, 3, 4])
  }
  const cache = createGpuPageCache(device, { read }, { pageBytes: 8, slots: 1 })
  await assert.rejects(cache.load('page'), /offline/)
  assert.equal(reads, 1)
  assert.equal((await cache.load('page')).bytes, 4, 'the next load reads it again')
  assert.equal(reads, 2)
  await cache.dispose()
})
test('a load of a resident page reads nothing; one that left by its turn reads it then', async () => {
  const { device } = fakeDevice({ limits: LIMITS })
  const reads: string[] = []
  const read = async (key: string) => (reads.push(key), new Uint8Array([1, 2, 3, 4]))
  const cache = createGpuPageCache(device, { read }, { pageBytes: 8, slots: 1 })
  await cache.load('a')
  await cache.load('a', undefined, true)
  cache.unpin('a')
  assert.deepEqual(reads, ['a'], 'a repin of a resident page asks the source nothing')
  // `b` takes the only slot before the second load of `a` comes to its turn.
  const [, again] = await Promise.all([cache.load('b'), cache.load('a')])
  assert.equal(again.key, 'a')
  assert.deepEqual(reads, ['a', 'b', 'a'])
  await cache.dispose()
})
