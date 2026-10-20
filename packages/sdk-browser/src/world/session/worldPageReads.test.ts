// A world page is read as any geometry page, by the session's one reader: under the session's
// signal at least — a read never outlives its session — and at the admission's priority.
import test from 'node:test'
import assert from 'node:assert/strict'
import { probeEngineContext } from './engine.fixture.ts'
import { createPageCache } from '../../streaming/pageCache.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'

test("a world page and a cache page are read under the session's signal, at the asked priority", async () => {
  const metadata = { primitives: [] } as unknown as ClusterManifest
  const session = new AbortController(),
    asked: [string, AbortSignal | undefined, number | undefined][] = []
  const record = async (url: string, signal?: AbortSignal, priority?: number) => (
    asked.push([url, signal, priority]),
    new Uint8Array(0)
  )
  const streamer = {
    signal: session.signal,
    read: async () => undefined,
    readBytes: record,
    reserve: () => {},
  }
  // The hold holds no byte the prepared engine's reserve counts.
  const hold = { metadata, reserved: () => 0 }
  const context = await probeEngineContext(
    metadata,
    {
      indices: new Map(),
      streamer,
      pageCache: createPageCache(),
      preload: 'visible',
    } as never,
    { worldRoots: [hold] as never },
  )
  await context.readGeometryPage!('world-roots.bin#64', undefined, 7)
  await context.readGeometryPage!('objects/page.bin', undefined, 3)
  assert.deepEqual(asked, [
    ['world-roots.bin#64', session.signal, 7],
    ['objects/page.bin', session.signal, 3],
  ])
})
