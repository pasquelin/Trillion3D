// A bundle stored as raw DEFLATE is proven by its stored bytes, then inflated: the cache holds what
// its pages are sliced from, and a bundle that inflates to another size than announced is refused.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { sha256Hex } from './sha256Hex.ts'
import { createPageStreamer } from './pageStreamer.ts'
import { createPageCache } from './pageCache.ts'
import type { StreamPage } from './types.ts'

/** A bundle of 64 bytes stored as raw DEFLATE in a file of its own, served whole by Range; its
 *  catalogue entry announcing `announced` decoded bytes. */
async function served(t: TestContext, announced = 64) {
  const decoded = Uint8Array.from({ length: 64 }, (_, i) => i % 4)
  const stored = new Uint8Array(deflateRawSync(decoded, { level: 9 }))
  assert.ok(stored.byteLength < decoded.byteLength, 'the bundle is smaller stored')
  const fetched: string[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    fetched.push((init?.headers as Record<string, string>).Range)
    return new Response(stored.slice(), { status: 206 })
  })
  const page: StreamPage = {
    url: 'packed.bin#bundle-0',
    bytes: stored.byteLength,
    decodedBytes: announced,
    sha256: await sha256Hex(stored.slice().buffer),
    range: { file: 'packed.bin', offset: 0 },
  }
  return { decoded, stored, fetched, page }
}

test('a compressed bundle is inflated after its check and the cache holds the decoded bytes', async (t) => {
  const { decoded, stored, fetched, page } = await served(t)
  const cache = createPageCache()
  const streamer = createPageStreamer([page], 'http://cache/', { cache, workerCount: 1 })
  t.after(() => streamer.dispose())
  const read = await streamer.readBytes(page.url, streamer.signal)
  assert.deepEqual([...read], [...decoded])
  assert.deepEqual([...cache.page(page.url)!], [...decoded], 'the cache holds the inflated bundle')
  assert.deepEqual(fetched, [`bytes=0-${stored.byteLength - 1}`], 'the stored bytes came over')
  assert.equal(streamer.stats().bytesRead, stored.byteLength, 'the wire length is counted')
})

test('a bundle that inflates to another size than announced is refused and kept out of the cache', async (t) => {
  const { page } = await served(t, 65)
  const cache = createPageCache()
  const streamer = createPageStreamer([page], 'http://cache/', {
    cache,
    workerCount: 1,
    numRetries: () => 0,
  })
  t.after(() => streamer.dispose())
  await assert.rejects(
    streamer.readBytes(page.url, streamer.signal),
    (error: Error) => (error.cause as { code?: string }).code === 'INVALID_CACHE',
    'refused as a check that fails is',
  )
  assert.equal(cache.page(page.url), undefined)
})

test('a cached decoded bundle is not foreign to its compressed entry', async (t) => {
  const { decoded, page } = await served(t)
  const cache = createPageCache()
  cache.put(page.url, decoded, page.sha256)
  assert.equal(cache.foreign(page), false, 'held at its decoded size')
  assert.equal(cache.foreign({ ...page, decodedBytes: 63 }), true, 'another decoded size')
  const streamer = createPageStreamer([page], 'http://cache/', { cache, workerCount: 1 })
  t.after(() => streamer.dispose())
  assert.deepEqual([...cache.page(page.url)!], [...decoded], 'the catalogue did not drop it')
  assert.equal((await streamer.readBytes(page.url, streamer.signal)).byteLength, 64)
  assert.equal(streamer.stats().loaded, 0, 'served from the cache, nothing read')
})
