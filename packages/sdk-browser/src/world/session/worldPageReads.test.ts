// A world page the pool admits is read as any geometry page: under the session's signal at least —
// a read never outlives its session — and at the admission's priority. Read with none, it waited
// on a closed session's queue for good, its bundle counted.
import test from 'node:test'
import assert from 'node:assert/strict'
import { probeEngineContext } from './engine.fixture.ts'
import { createPageCache } from '../../streaming/pageCache.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts'

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
    textureLevels: createPageCache().levels,
  }
  const hold = { metadata, drawn: { source: { read: record } } }
  const context = await probeEngineContext(
    metadata,
    { indices: new Map(), streamer, cacheCap: 1, preload: 'visible' } as never,
    { worldRoots: [hold] as never },
  )
  await context.readGeometryPage!('world-roots.bin#1:0', undefined, 7)
  await context.readGeometryPage!('objects/page.bin', undefined, 3)
  assert.deepEqual(asked, [
    ['world-roots.bin#1:0', session.signal, 7],
    ['objects/page.bin', session.signal, 3],
  ])
})
