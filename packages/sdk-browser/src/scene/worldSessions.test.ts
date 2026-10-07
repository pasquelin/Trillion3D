// A world's roots outlive its sessions: a session closed before it binds is never read through, a
// load let go stops its download, and a page asked by a closed session's engine is let go with it.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import type { ClusterManifest } from '../../../sdk-core/src/index.ts'
import {
  worldRootsDag,
  worldRootsFixture,
} from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { createPageCache } from '../streaming/pageCache.ts'
import { createPageStreamer } from '../streaming/pageStreamer.ts'
import { heldBy, opened, served, sha } from './worldRoots.fixture.ts'
import { openWorldRoots } from './worldRoots.ts'

const turns = async (count = 4) => {
  for (let i = 0; i < count; i++) await new Promise(setImmediate)
}

test('a session closed before it binds is refused: a hold waits for the next one, never spins', async (t) => {
  const { manifest } = served(t)
  const { roots, queue } = await opened(t, manifest)
  queue.dispose() // the device is lost
  const dead = createPageStreamer([], 'http://world/')
  dead.dispose() // the next session's signal aborts during its capability probe
  roots.bind(dead)
  let landed = false
  const held = roots.hold(1).then(() => (landed = true))
  await turns()
  assert.equal(landed, false, 'it waits, bound to nothing')
  const next = createPageStreamer([], 'http://world/')
  t.after(() => next.dispose())
  roots.bind(next)
  await held
  assert.deepEqual(heldBy(roots), [2, 3])
})

/** A world served by a server that ignores the Range, its binary answered whole once `release`
 *  runs: its manifest, the binary's length, and the requests of the binary sent. */
function wholeOnRelease(t: TestContext) {
  const world = worldRootsFixture(sha)
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  t.after(release)
  const asked: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    if (input.endsWith('.table')) return new Response(world.bytes.slice())
    asked.push(input)
    // As a browser's fetch: its signal aborts it.
    const signal = init!.signal!
    const aborted = new Promise((_, no) =>
      signal.addEventListener('abort', () => no(signal.reason)),
    )
    await Promise.race([gate, aborted])
    return new Response(world.bin.slice())
  })
  const table = { bytes: world.bytes.byteLength, sha256: sha(world.bytes) }
  const manifest = { files: { 'world-roots.table': table } } as unknown as ClusterManifest
  return { manifest, asked, release, bytes: world.bin.byteLength }
}

test('a load let go while the whole binary downloads stops it: the page cache keeps nothing', async (t) => {
  const { manifest, asked, release } = wholeOnRelease(t)
  const cache = createPageCache(),
    load = new AbortController()
  const loading = openWorldRoots(manifest, 'http://world/', load.signal, undefined, true, { cache })
  for (let i = 0; i < 20 && !asked.length; i++) await turns(1)
  load.abort()
  await assert.rejects(loading, { name: 'AbortError' })
  release()
  await turns()
  assert.equal(cache.besideBytes, 0, 'no binary kept, no reader held')
})

test("a page a closed session's engine asked is let go with its signal: it never waits on a bind", async (t) => {
  const { clusters, groups } = worldRootsDag()
  const { manifest } = served(t, { dag: { clusters, groups } })
  const roots = (await openWorldRoots(manifest, 'http://world/'))! // a world's model: no session yet
  const stream = await roots.stream()
  const [, far] = stream.dag!.pages.filter((page) => page.url) // bundle 2's super-root
  const engine = new AbortController()
  const page = stream.source.page(far.url, engine.signal)
  await turns()
  engine.abort() // its session closed
  await assert.rejects(page, { name: 'AbortError' })
  assert.deepEqual(heldBy(roots), [], 'its bundle let go')
})
