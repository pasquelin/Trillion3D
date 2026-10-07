// The scene a session draws is read through the queue the session opened first: what it streams is
// catalogued and bound there.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { PageQueue, StreamPage } from '../../streaming/types.ts'
import { openExplorerPageSources, sceneThrough } from './pageSources.ts'
import { streamFailed } from '../scene/streaming.ts'
import { createDiagnosticChannel } from '../../diagnostic/channel.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts'
import type { Engine, MeasuredWorldOptions } from '../../engine/types.ts'

/** A queue that records what it is told. */
function queue() {
  const told = { admitted: [] as string[], bound: 0 }
  const port: PageQueue = {
    admit: (pages: readonly StreamPage[]) => void told.admitted.push(...pages.map((p) => p.url)),
    forget() {},
    readBytes: async () => new Uint8Array(),
    signal: new AbortController().signal,
  }
  return { port, told }
}

test("a scene read catalogues its partitions' pages and binds its world roots to the queue", async () => {
  const { port, told } = queue()
  const page = { url: 'scene-page.json', bytes: 1, sha256: '' }
  const roots = { bind: (bound: PageQueue) => void (told.bound += bound === port ? 1 : 0) }
  const scene = { partitions: [{ pages: [page] }], worldRoots: [roots, roots] }
  assert.equal(await sceneThrough(port, undefined, async () => scene as never), scene)
  assert.deepEqual([told.admitted, told.bound], [['scene-page.json'], 2])
})

test('a page read that keeps failing reaches the host once, as it first waits the longest', async (t) => {
  const clock = { now: 0 }
  t.mock.method(performance, 'now', () => clock.now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }))
  const page = { url: 'a.bin', id: 0, bytes: 4, sha256: '' }
  const metadata = { primitives: [{ pages: [page] }] } as unknown as ClusterManifest
  const told: [string, number][] = []
  const opening = openExplorerPageSources(
    metadata,
    {} as MeasuredWorldOptions,
    'http://cache/',
    undefined,
    () => undefined,
    createDiagnosticChannel(undefined),
    () => {},
    (detail, failedPages) => void told.push([detail, failedPages]),
  )
  const { streamer } = await opening.sources
  t.after(() => streamer.dispose())
  void streamer.request(['a.bin'], { signal: streamer.signal }).catch(() => {})
  for (; clock.now <= 16_000; clock.now += 250) {
    t.mock.timers.tick(250)
    for (let i = 0; i < 4; i++) await new Promise(setImmediate)
  }
  assert.equal(told.length, 1, 'said once, never once a wait')
  assert.match(told[0][0], /a\.bin: .*HTTP 503/)
  assert.equal(told[0][1], 1)
})

test('a page read that fails is fatal while no cover is resident, degraded while one is', () => {
  const events: { type: string; code?: string }[] = []
  const session = { scope: 'slice', emit: (event: never) => void events.push(event), diagnose() {} }
  streamFailed(session as never, undefined, 1, 'a.bin: HTTP 503')
  const covered = { metrics: () => ({ coverageReady: true }) } as unknown as Engine
  streamFailed(session as never, covered, 1, 'a.bin: HTTP 503')
  assert.deepEqual(
    events.map(({ type, code }) => [type, code]),
    [
      ['fatal', 'PAGE_STREAM_FAILED'],
      ['degraded', 'PAGE_STREAM_FAILED'],
    ],
  )
})
