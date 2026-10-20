// A page of a bundle is a slice of the bundle's one read: never read on its own, served from that
// read, held in the cache with it, and told to whoever installs a bundle's pages as it lands.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { sha256Hex } from './sha256Hex.ts'
import { createPageStreamer } from './pageStreamer.ts'
import { createPageCache } from './pageCache.ts'
import type { StreamPage } from './types.ts'

/** One file holding one bundle of two pages, `low` then `high`, served by Range: the ranges
 *  asked. */
async function served(t: TestContext) {
  const low = Uint8Array.of(1, 2, 3, 4),
    high = Uint8Array.of(5, 6, 7, 8, 9, 10, 11, 12),
    file = new Uint8Array([...low, ...high])
  const asked: string[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string>).Range
    asked.push(range)
    const [from, to] = range.slice('bytes='.length).split('-').map(Number)
    return new Response(file.slice(from, to + 1), { status: 206 })
  })
  const sha256 = await sha256Hex(file.slice().buffer)
  const bundle = 'file.bin#bundle-0'
  const pages: StreamPage[] = [
    { url: bundle, bytes: file.byteLength, sha256, range: { file: 'file.bin', offset: 0 } },
    { url: 'file.bin#0', bytes: low.byteLength, sha256, bundle: { url: bundle, offset: 0 } },
    { url: 'file.bin#4', bytes: high.byteLength, sha256, bundle: { url: bundle, offset: 4 } },
  ]
  const streamer = createPageStreamer(pages, 'http://cache/', { cache: createPageCache() })
  t.after(() => streamer.dispose())
  return { streamer, asked, low, high }
}

test("a bundle's pages are slices of its one read, held with it", async (t) => {
  const { streamer, asked, low, high } = await served(t)
  assert.equal(streamer.has('file.bin#4'), false, 'nothing read yet')
  const [first, second] = await Promise.all([
    streamer.readBytes('file.bin#0', streamer.signal),
    streamer.readBytes('file.bin#4', streamer.signal),
  ])
  assert.deepEqual([[...first], [...second]], [[...low], [...high]])
  assert.deepEqual(asked, ['bytes=0-11'], 'the bundle, once, for both pages')
  assert.ok(streamer.has('file.bin#4'), 'held as its bundle is')
  assert.deepEqual([...streamer.getBytes('file.bin#4')!], [...high], 'its slice of the held read')
  await streamer.readBytes('file.bin#4', streamer.signal)
  assert.deepEqual(asked, ['bytes=0-11'], 'read again from the cache')
})
