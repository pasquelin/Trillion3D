// A page the pool loads is read under the load's own signal and priority: a load cancelled drops
// its read while it waits (`readPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPageSource } from './readPage.ts'
import type { WebgpuPagesCore } from './runtime.ts'

test('the read of a geometry page carries the signal and the priority of its load', async () => {
  const asked: { url: string; signal?: AbortSignal; priority?: number }[] = []
  const rt = {
    context: {
      readGeometryPage: async (url: string, signal?: AbortSignal, priority?: number) => {
        asked.push({ url, signal, priority })
        return new Uint8Array(0)
      },
    },
    setup: { sourceBytes: new Map(), geometryUrls: new Map([['page', 'geometry/page.bin']]) },
  } as unknown as WebgpuPagesCore
  const stop = new AbortController()
  // The page's header is the format's gate: an empty read is refused after the read was asked.
  await assert.rejects(createPageSource(rt).read('page', stop.signal, 3))
  assert.equal(asked.length, 1)
  assert.deepEqual(asked[0], {
    url: 'geometry/page.bin',
    signal: stop.signal,
    priority: 3,
  })
})
