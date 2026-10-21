// The runtime reads the world's HLOD and holds nothing at open; an HLOD 0 cell holds — pins — the
// bundles of its HLOD 1 roots while its HLOD 1 actor is loaded, and lets them go when it leaves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { eventually } from '../streaming/eventually.fixture.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { worldRootsDag, worldRootsFixture } from './worldRootsPages.fixture.ts'
import { openWorldRoots } from './worldRoots.ts'
import { decodeGeometryPage } from '../codec/geometryPage.ts'
import { heldBy, modelOpened, opened, pageOf, served } from './worldRoots.fixture.ts'
import { createPageStreamer } from '../streaming/pageStreamer.ts'
import { createPageCache } from '../streaming/pageCache.ts'

/** The bytes the Range headers `ranges` ask, in all. */
const asked = (ranges: readonly string[]) =>
  ranges.reduce((sum, range) => {
    const [from, to] = range.slice('bytes='.length).split('-').map(Number)
    return sum + to - from + 1
  }, 0)

test('nothing is held at open; a held HLOD 0 cell holds the bundles of its HLOD 1 roots', async (t) => {
  const { table, manifest, ranges, bin } = served(t)
  const { roots, queue } = await opened(t, manifest)
  assert.deepEqual([ranges, heldBy(roots)], [[], []], 'nothing read at open')
  await Promise.all([roots.hold(0), roots.hold(1), roots.hold(2)])
  assert.deepEqual(heldBy(roots), [0, 1, 2, 3], 'each bundle the held cells need')
  assert.equal(asked(ranges), bin.byteLength, 'each read once')
  const read = await queue.readBytes(pageOf(table, 0), queue.signal)
  assert.deepEqual([...decodeGeometryPage(read).attributes.position], [0, 0, 0, 1, 0, 0, 0, 1, 0])
  roots.release(0)
  assert.deepEqual(heldBy(roots), [0, 2, 3], 'a bundle another held cell needs stays')
  roots.release(1)
  roots.release(2)
  assert.deepEqual(heldBy(roots), [], 'nothing left')
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

test('a bundle a cell holds whose bytes differ is refused, naming it', async (t) => {
  const { bin } = worldRootsFixture()
  const world = served(t, { bin }),
    at = (bundle: number) => world.table.bundles[bundle].offset
  const expected = (bundle: number) => world.table.bundles[bundle].sha256
  const refusals: string[] = []
  const queue = createPageStreamer([], 'http://world/', {
    cache: createPageCache(),
    onDiagnostic: ({ phase, context }) =>
      phase === 'page-retry' && refusals.push(String((context as { error: string }).error)),
  })
  t.after(() => queue.dispose())
  const roots = (await openWorldRoots(world.manifest, 'http://world/', queue))!
  bin[at(0)] ^= 1
  const leaving = new AbortController()
  roots.hold(2, { signal: leaving.signal }).catch(() => {})
  await eventually(() => refusals.length > 0)
  assert.ok(refusals[0].includes(`${expected(0)} announced`), 'a cell bundle, through the queue')
  leaving.abort()
})

test("a server that ignores the Range is read whole once through the page cache: by a world's load and its sessions alike", async (t) => {
  const { manifest, ranges, bin, table } = served(t, { ignoresRange: true })
  const cache = createPageCache()
  // A world's model loads before any session, through a queue of its own over its page cache.
  const roots = (await modelOpened(manifest, {}, cache))!
  // The binary answered whole is one entry, and each bundle read from it one more: the table,
  // read for its decode, is never one.
  const kept = (held: number[]) =>
    bin.byteLength + held.reduce((sum, at) => sum + table.bundles[at].bytes, 0)
  for (const cell of [0, 1, 2]) {
    const session = createPageStreamer([], 'http://world/', { cache })
    roots.bind(session)
    await roots.hold(cell)
    session.dispose() // the device is lost: the next session reads on
  }
  assert.deepEqual(heldBy(roots), [0, 1, 2, 3])
  assert.equal(cache.bytes, kept([0, 1, 2, 3]), 'each counted once, till the budget evicts it')
  assert.equal(ranges.length, 1, `the whole ${bin.byteLength}-byte binary, asked once`)
  // The bundles held are the cache's entries alone: nothing is reserved beside them, never
  // counted twice.
  assert.equal(roots.reserved(), 0, 'never counted twice')
})

test('the world DAG names its pages through the one source, from what is held', async (t) => {
  const { clusters, groups, culling } = worldRootsDag()
  const { manifest, ranges, whole } = served(t, { dag: { clusters, groups, culling } })
  const { roots, queue } = await opened(t, manifest)
  assert.deepEqual(whole, ['table', 'dag'], 'the DAG is read once, at load')
  const files = ['table', 'dag'].map((file) => `http://world/world-roots.${file}`)
  assert.deepEqual(
    files.flatMap((url) => [queue.catalogued(url), queue.has(url)]),
    [false, false, false, false],
    'decoded, neither is kept in the page cache nor stays catalogued',
  )
  const dag = roots.dag!
  assert.equal(dag.pages.length, clusters.length, 'the cook\u2019s clusters, in rank')
  await roots.hold(0) // cell 0 holds bundles 1 and 3
  const before = ranges.length
  const pages = await Promise.all(dag.pages.map((page) => queue.readBytes(page.url, queue.signal)))
  assert.deepEqual(
    pages.map((page) => decodeGeometryPage(page).attributes.position[0]),
    clusters.map(({ level, hlod }) => (level ? (hlod + 1) % 3 : 3 + hlod)),
    'each cluster reads the page at its bundle and offset',
  )
  assert.ok(ranges.length > before, 'bundles 0 and 2, not held, are read')
  assert.deepEqual(roots.held(), [1, 3], 'a page read is not a cell hold')
})

test('a cache without its DAG file opens with no DAG', async (t) => {
  const { manifest } = served(t)
  const roots = (await modelOpened(manifest))!
  assert.equal(roots.dag, undefined)
})

test('a cache that publishes no world roots pins nothing', async () => {
  const none = await modelOpened({} as ClusterManifest)
  assert.equal(none, undefined)
})
