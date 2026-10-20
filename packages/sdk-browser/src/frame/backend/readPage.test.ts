// A page the pool loads is read under the load's own signal and priority: a load cancelled drops
// its read while it waits (`readPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPageSource } from './readPage.ts'
import type { WebgpuPagesCore } from './runtime.ts'
import { VOXEL_PAGE_MAGIC } from '../../../../sdk-core/src/page/voxelPage.ts'

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

// A voxel page passes its own gate (`checkVoxelPage`): its counts — one brick of one voxel —
// measure its bytes, or the read is refused before the pool uploads a word.
test('a voxel page is read whole, a truncated one refused', async () => {
  // Its head, one brick's record, one voxel's.
  const words = new Uint32Array(6 + 5 + 3)
  words[0] = VOXEL_PAGE_MAGIC
  words[1] = 1 | (1 << 16)
  const served = new Map([
    ['whole', new Uint8Array(words.buffer)],
    ['cut', new Uint8Array(words.buffer, 0, 40)],
  ])
  const rt = {
    context: { readGeometryPage: async (url: string) => served.get(url)! },
    setup: {
      sourceBytes: new Map(),
      geometryUrls: new Map([
        ['a', 'whole'],
        ['b', 'cut'],
      ]),
    },
  } as unknown as WebgpuPagesCore
  const source = createPageSource(rt)
  assert.equal((await source.read('a')).byteLength, 56)
  await assert.rejects(source.read('b'), /voxel page/)
})
