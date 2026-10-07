// The runtime reads the world roots and pins their top alone; a placed cell holds the
// bundles past it that its objects' roots depend on, and lets them go when it leaves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { eventually } from '../streaming/eventually.fixture.ts'
import { EngineError, type ClusterManifest } from '../../../sdk-core/src/index.ts'
import {
  worldRootsDag,
  worldRootsFixture,
} from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { openWorldRoots } from './worldRoots.ts'
import { cellSuperRoots } from '../partition/superRoots.ts'
import { heldBy, opened, rangeOf, served } from './worldRoots.fixture.ts'
import { createPageStreamer, createPageStreamerWith } from '../streaming/pageStreamer.ts'
import { createPageCache } from '../streaming/pageCache.ts'

test('the pinned set is the world top alone; a placed cell holds its bundles past it', async (t) => {
  const { table, manifest, ranges } = served(t)
  const { roots } = await opened(t, manifest)
  const top = table.pinnedTopBytes
  assert.deepEqual([roots.pinned.bundles, roots.pinned.bytes, roots.bytes()], [1, top, top])
  assert.deepEqual([...roots.pinned.pages[0].positions], [0, 0, 0, 1, 0, 0, 0, 1, 0])
  assert.deepEqual(ranges, [`bytes=0-${top - 1}`], 'the top alone, in one range')
  assert.deepEqual(heldBy(roots), [], 'no object root and no cell bundle is pinned')
  await Promise.all([roots.hold(0), roots.hold(1), roots.hold(2)])
  assert.deepEqual(heldBy(roots), [1, 2, 3], 'each bundle the placed cells need, read once')
  assert.deepEqual(ranges.slice(1), [rangeOf(table, 1, 4)], 'end to end in the binary: one range')
  roots.release(0)
  assert.deepEqual(heldBy(roots), [2, 3], 'a bundle another placed cell needs stays')
  roots.release(1)
  roots.release(2)
  assert.deepEqual([heldBy(roots), roots.bytes()], [[], top], 'the pinned top alone is left')
})

test('a bundle whose bytes are not those its table names waits its turn, its hold on its way, wanted till released', async (t) => {
  const { bin } = worldRootsFixture()
  bin[bin.byteLength - 12] ^= 1 // the last bundle, a cell's
  const { manifest } = served(t, { bin })
  const { roots, queue } = await opened(t, manifest)
  const leaving = new AbortController()
  const held = roots.hold(0, { signal: leaving.signal })
  await eventually(() => queue.stats().failed === 1)
  assert.deepEqual([heldBy(roots), queue.stats().failed], [[1, 3], 1], 'it may pass: it waits')
  leaving.abort()
  await assert.rejects(held, { name: 'AbortError' })
  roots.release(0)
  assert.deepEqual(heldBy(roots), [], 'released, it holds nothing')
})

test('the top read at open and a bundle read through the queue are refused alike, naming the bundle that differs', async (t) => {
  const { bin } = worldRootsFixture()
  const world = served(t, { bin }),
    at = (bundle: number) => world.table.bundles[bundle].offset
  const expected = (bundle: number) => world.table.bundles[bundle].sha256
  const refusals: string[] = []
  const roots = (await openWorldRoots(world.manifest, 'http://world/'))!
  const queue = createPageStreamer([], 'http://world/', {
    onDiagnostic: ({ phase, context }) =>
      phase === 'page-retry' && refusals.push(String((context as { error: string }).error)),
  })
  t.after(() => queue.dispose())
  roots.bind(queue)
  bin[at(3)] ^= 1
  const leaving = new AbortController()
  roots.hold(0, { signal: leaving.signal }).catch(() => {})
  await eventually(() => refusals.length > 0)
  assert.equal(refusals.length, 1, 'through the queue')
  assert.ok(refusals[0].includes(`${expected(3)} announced`))
  leaving.abort()
  bin[at(3)] ^= 1
  bin[at(0)] ^= 1
  await assert.rejects(openWorldRoots(world.manifest, 'http://world/'), (error: Error) => {
    const refusal = error as EngineError
    return refusal.code === 'INVALID_CACHE' && refusal.details.expectedSha256 === expected(0)
  })
})

test("a server that ignores the Range is read whole once by the cache's one reader: by a world's load and its sessions alike", async (t) => {
  const { manifest, ranges, bin } = served(t, { ignoresRange: true })
  const metered: string[] = []
  const meter = {
    plan() {},
    settle() {},
    read: (response: Response, url: string) => (metered.push(url), response),
  }
  const cache = createPageCache()
  // A world's model loads before any session, through its page cache's reader.
  const roots = (await openWorldRoots(manifest, 'http://world/', undefined, meter, true, {
    cache,
  }))!
  for (const cell of [1, 2]) {
    const session = createPageStreamerWith([], 'http://world/', { cache })
    roots.bind(session)
    await roots.hold(cell)
    assert.ok(session.stats().cpuBytes >= bin.byteLength, 'the kept binary, counted by the cache')
    session.dispose() // the device is lost: the next session reads on
  }
  assert.deepEqual(heldBy(roots), [1, 2, 3])
  assert.equal(ranges.length, 1, `the whole ${bin.byteLength}-byte binary, asked once`)
  assert.deepEqual(
    metered,
    ['http://world/world-roots.table', 'http://world/world-roots.bin'],
    "the load's read of the binary is counted as it arrives, as the table is",
  )
  const bundles = heldBy(roots).reduce((sum, at) => sum + roots.table.bundles[at].bytes, 0)
  assert.equal(roots.bytes(), roots.pinned.bytes + bundles, 'never counted twice')
})

test('the world DAG names its pages through the one source, from what is held', async (t) => {
  const { clusters, groups } = worldRootsDag()
  const { manifest, ranges, whole } = served(t, { dag: { clusters, groups } })
  const { roots } = await opened(t, manifest)
  assert.deepEqual(whole, ['table'], 'a load reads the table, never the DAG')
  const stream = await roots.stream()
  assert.deepEqual(whole, ['table', 'dag'], 'the DAG is read once its stream opens')
  assert.equal(stream, await roots.stream(), 'opened once')
  assert.deepEqual(whole, ['table', 'dag'], 'an opened stream reads its DAG no more')
  assert.equal(stream.dag!.pages.length, clusters.length, 'the cook\u2019s clusters, in rank')
  await roots.hold(0) // cell 0 holds bundles 1 and 3, the top is pinned
  const asked = ranges.length
  const addressed = stream.dag!.pages.filter((page) => page.url)
  const pages = await Promise.all(addressed.map((page) => stream.source.page(page.url)))
  assert.deepEqual(
    pages.map((page) => page.positions[0]),
    [1, 2, 3, 0],
    'each super-root reads the page at its bundle, the world top last',
  )
  assert.equal(ranges.length, asked + 1, 'only bundle 2, neither pinned nor held, is read')
  assert.deepEqual(heldBy(roots), [1, 3], 'a page read is not a cell hold')
  // A page owing its other WebGPU view keeps its bundle, and the CPU budget counts it.
  const before = roots.bytes(),
    far = addressed[1].url // bundle 2's super-root
  await stream.source.read(far)
  assert.equal(roots.bytes(), before + roots.table.bundles[2].bytes, 'the kept bundle is counted')
  await stream.source.attributes(far)
  assert.equal(roots.bytes(), before, 'both views served, it is let go')
})

test('a cache without its DAG file opens a stream with no DAG', async (t) => {
  const { manifest } = served(t)
  const roots = (await openWorldRoots(manifest, 'http://world/'))!
  const stream = await roots.stream()
  assert.deepEqual([stream.dag, stream.superRoots], [undefined, undefined])
})

test("the stream bounds each cell's super-roots, an object root in its object's cell", async (t) => {
  // The table lists one object in cell 0, two in cell 1, one in cell 2: an object root's `origin`
  // is its object's rank there, as the cook writes it.
  const { clusters, groups } = worldRootsDag()
  const cellOf = (origin: number) => Math.floor(origin / 4)
  const ranked = clusters.map((c) =>
    c.origin === null ? c : { ...c, origin: [0, 1, 3][cellOf(c.origin)] },
  )
  const { manifest } = served(t, { dag: { clusters: ranked, groups } })
  const roots = (await openWorldRoots(manifest, 'http://world/'))!
  const { superRoots } = await roots.stream()
  assert.deepEqual(superRoots, cellSuperRoots(clusters, cellOf, 3))
})

test('a scene not partitioned holds its one cell from its open, read with the top', async (t) => {
  const { manifest, ranges, table } = served(t)
  const roots = (await openWorldRoots(manifest, 'http://world/', undefined, undefined, true))!
  assert.deepEqual(heldBy(roots), [1, 3], 'cell 0, before any session binds its queue')
  assert.deepEqual(ranges.slice(1), [rangeOf(table, 1, 2), rangeOf(table, 3, 4)])
})

test('a cache that publishes no world roots pins nothing', async () => {
  assert.equal(await openWorldRoots({} as ClusterManifest, 'http://world/'), undefined)
})
