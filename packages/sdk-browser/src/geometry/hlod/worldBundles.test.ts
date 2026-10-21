// A placed cell's world bundles are pages of the session's one read queue: those queued end to end
// in the binary are one ranged request, a bundle on its way is shared, one no hold waits on is
// dropped unread, one that may pass waits its turn, and one refused for good is never asked again.
// The bundles the held cells need are told to who follows them — each once when its first cell
// holds it and once when its last lets it go, those held already first.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { eventually } from '../streaming/eventually.fixture.ts'
import { worldRootsDag, worldRootsFixture } from './worldRootsPages.fixture.ts'
import { encodeWorldRoots } from '../../../../sdk-core/src/manifest/worldRootsRecords.fixture.ts'
import { readWorldRoots } from '../../../../sdk-core/src/manifest/worldRootsTable.ts'
import {
  bundleOf,
  heldBy,
  modelOpened,
  opened,
  rangeOf,
  served,
  sha,
} from './worldRoots.fixture.ts'
import { createPageStreamer } from '../streaming/pageStreamer.ts'
import { createPageCache } from '../streaming/pageCache.ts'
import { createWorldBundles } from './worldBundles.ts'
import type { PageQueue } from '../streaming/types.ts'

type Dag = ReturnType<typeof worldRootsDag>

/** A world, its DAG `dag`, whose run from bundle `first` is answered once `land` runs, opened on
 *  a queue of `transfers`: its roots, the ranges asked, its table, and `land`. */
async function heldAt(t: TestContext, first: number, transfers?: number, dag?: Dag) {
  let land = () => {}
  const landing = new Promise<void>((resolve) => (land = resolve))
  const world = served(t, {
    dag,
    answer: async (from, _to, respond) => {
      if (from === world.table.bundles[first].offset) await landing
      return respond()
    },
  })
  const { roots, queue } = await opened(t, world.manifest, { transfers })
  t.after(land)
  return { roots, queue, ranges: world.ranges, table: world.table, land }
}

test("a cell's bundles contiguous in the binary are one ranged read", async (t) => {
  const { manifest, ranges, table } = served(t)
  const { roots } = await opened(t, manifest)
  await roots.hold(1) // bundles 2 and 3, side by side in the binary
  assert.deepEqual(ranges, [rangeOf(table, 2, 4)])
  assert.deepEqual(heldBy(roots), [2, 3])
})

test('a hold let go while its bundle waits in the queue drops it, its cell still placed; a shared one is read once', async (t) => {
  // Bundle 1 holds the queue's one transfer until `land`.
  const { roots, queue, ranges, table, land } = await heldAt(t, 1, 1)
  const placed = roots.hold(0) // bundles 1 and 3: two ranges apart
  await eventually(() => ranges.length === 1) // bundle 1 transfers
  const leaving = new AbortController()
  const left = roots.hold(1, { signal: leaving.signal }) // bundle 3 on its way, bundle 2 queued
  await eventually(() => queue.loading(bundleOf(table, 2)))
  assert.deepEqual(ranges, [rangeOf(table, 1, 2)], 'one transfer, the rest wait')
  leaving.abort() // the hold lets go: its cell is not released yet
  await assert.rejects(left, { name: 'AbortError' })
  land()
  await placed
  assert.deepEqual(ranges, [rangeOf(table, 1, 2), rangeOf(table, 3, 4)], 'bundle 2 unread')
  roots.release(1)
  assert.deepEqual(heldBy(roots), [1, 3])
})

test('a bundle the server refuses for good (404) is never asked again', async (t) => {
  const world = served(t, {
    answer: async (from, _to, respond) =>
      from === world.table.bundles[2].offset ? new Response('', { status: 404 }) : respond(),
  })
  const { roots, queue } = await opened(t, world.manifest)
  await assert.rejects(roots.hold(1), /PAGE_STREAM_FAILED.*after one attempt/)
  await assert.rejects(roots.hold(1), /PAGE_STREAM_FAILED/)
  assert.deepEqual(world.ranges, [rangeOf(world.table, 2, 4)], 'asked once')
  assert.equal(queue.failed(bundleOf(world.table, 2)), true)
  roots.release(1)
  roots.release(1)
  assert.deepEqual(heldBy(roots), [], 'let go: refused at once while the session reads')
})

test('a bundle whose read may pass keeps its hold waiting; let go, it is dropped', async (t) => {
  const world = served(t, {
    answer: async (from, _to, respond) =>
      from === world.table.bundles[1].offset ? new Response('', { status: 503 }) : respond(),
  })
  const { roots, queue } = await opened(t, world.manifest)
  const bundle = bundleOf(world.table, 1)
  const leaving = new AbortController()
  let settled = false
  const held = roots.hold(0, { signal: leaving.signal }).finally(() => (settled = true))
  await eventually(() => queue.stats().failed === 1)
  assert.deepEqual([settled, queue.loading(bundle), queue.failed(bundle)], [false, true, false])
  leaving.abort()
  await assert.rejects(held, { name: 'AbortError' })
  roots.release(0)
  assert.deepEqual([heldBy(roots), queue.loading(bundle)], [[], false], 'dropped while it waited')
})

test('a bundle read for one page request alone, refused for good, is refused at once again', async (t) => {
  const { clusters, groups, culling } = worldRootsDag()
  const world = served(t, {
    dag: { clusters, groups, culling },
    answer: async (from, _to, respond) =>
      from === world.table.bundles[2].offset ? new Response('', { status: 404 }) : respond(),
  })
  const { roots, queue } = await opened(t, world.manifest)
  const far = roots.dag!.pages.find((page) => page.holder === 2)! // cell 1's HLOD 1 root
  await assert.rejects(queue.readBytes(far.url, queue.signal), /PAGE_STREAM_FAILED/)
  const asked = world.ranges.length
  await assert.rejects(queue.readBytes(far.url, queue.signal), /PAGE_STREAM_FAILED/)
  assert.equal(world.ranges.length, asked, 'refused at once, never asked every frame')
  assert.deepEqual(heldBy(roots), [], 'let go')
})

test('a cell let go while its bundles transfer and held again joins that read: read once', async (t) => {
  const { roots, ranges, table, land } = await heldAt(t, 2)
  const leaving = new AbortController()
  const left = roots.hold(1, { signal: leaving.signal }) // bundles 2 and 3, one read
  await eventually(() => ranges.length === 1) // under way
  leaving.abort()
  await assert.rejects(left, { name: 'AbortError' })
  roots.release(1)
  const back = roots.hold(1)
  land()
  await back
  assert.deepEqual(ranges, [rangeOf(table, 2, 4)], 'read once')
  assert.deepEqual(heldBy(roots), [2, 3])
})

test('a table whose bundle holds pages it does not name is refused at open, naming the bundle', async (t) => {
  const fixture = worldRootsFixture(sha)
  const spec = { ...fixture.spec, bundles: fixture.spec.bundles.map((b) => ({ ...b })) }
  // Its bytes hold a page its table does not name: a bundle of no page holds an actor's rows
  // (`bundlePageRanges`), so it names fewer, not none.
  spec.bundles[3].count = 2
  const bytes = encodeWorldRoots(spec)
  const world = served(t, { world: { bytes, bin: fixture.bin, table: readWorldRoots(bytes) } })
  await assert.rejects(opened(t, world.manifest), /bundle 3/)
  assert.deepEqual(world.ranges, [], 'no bundle read from a table that misnames one')
})

test('a page asked while its bundle transfers holds the bundle: its cell leaving stops nothing', async (t) => {
  const { roots, queue, ranges, land } = await heldAt(t, 2, undefined, worldRootsDag())
  const far = roots.dag!.pages.find((page) => page.holder === 2)! // cell 1's HLOD 1 root
  const leaving = new AbortController()
  const left = roots.hold(1, { signal: leaving.signal }) // bundles 2 and 3, one read
  await eventually(() => ranges.length === 1) // under way
  const page = queue.readBytes(far.url, queue.signal)
  leaving.abort()
  await assert.rejects(left, { name: 'AbortError' })
  roots.release(1) // the cell left
  land()
  assert.ok((await page).byteLength > 0, 'the page lands')
  assert.deepEqual([ranges.length, heldBy(roots)], [1, []], 'its bundle read once, then let go')
})

test('a cell held before its world is bound waits for the bind, then reads', async (t) => {
  const { manifest, ranges, table } = served(t)
  const roots = (await modelOpened(manifest))!
  const queue = createPageStreamer([], 'http://world/', { cache: createPageCache() })
  t.after(() => queue.dispose())
  const held = roots.hold(1)
  await new Promise(setImmediate)
  roots.bind(queue)
  await held
  assert.deepEqual(ranges, [rangeOf(table, 2, 4)])
})

test("a hold under way as its session's queue closes reads in the next session's queue: never lost", async (t) => {
  const { roots, queue, ranges, table, land } = await heldAt(t, 2)
  const held = roots.hold(1) // bundles 2 and 3, one read, under way
  await eventually(() => ranges.length === 1)
  const next = createPageStreamer([], 'http://world/', { cache: createPageCache() })
  queue.dispose() // the device is lost: its session closes
  land()
  roots.bind(next) // the next session
  t.after(() => next.dispose())
  await held
  const run = rangeOf(table, 2, 4)
  assert.deepEqual(ranges, [run, run], 'read again there')
})

/** The fixture's bundles, no session bound: a hold counts its bundles at once and waits for a
 *  queue, let go with the test. */
function bundlesOf() {
  const bundles = createWorldBundles(worldRootsFixture().table, 'world-roots.bin')
  const stop = new AbortController()
  const hold = (cell: number) => void bundles.hold(cell, { signal: stop.signal }).catch(() => {})
  return { bundles, hold, stop }
}

test('a watcher is told each bundle as the cells start or stop holding it', () => {
  // Cell 0 holds bundles 1 and 3, cell 1 bundles 2 and 3 (`worldRootsFixture`).
  const { bundles, hold, stop } = bundlesOf()
  hold(0)
  const told: [number, boolean][] = []
  const unwatch = bundles.watch((bundle, held) => void told.push([bundle, held]))
  assert.deepEqual(
    told,
    [
      [1, true],
      [3, true],
    ],
    'what is held already, first',
  )
  hold(1)
  bundles.release(0)
  bundles.release(1)
  assert.deepEqual(told.slice(2), [
    [2, true],
    [1, false],
    [2, false],
    [3, false],
  ])
  unwatch()
  hold(0)
  assert.equal(told.length, 6, 'a watcher that stopped is told nothing')
  stop.abort()
})

test("a hold refused for good takes its bundles' roots out at once, its cell still held", async () => {
  const { bundles } = bundlesOf()
  const refusing = {
    signal: new AbortController().signal,
    admit: () => {},
    pin: () => {},
    readBytes: async () => {
      throw new Error('PAGE_STREAM_FAILED: refused for good')
    },
  } as unknown as PageQueue
  bundles.bind(refusing)
  const told: [number, boolean][] = []
  bundles.watch((bundle, held) => void told.push([bundle, held]))
  await assert.rejects(bundles.hold(0), /PAGE_STREAM_FAILED/)
  assert.deepEqual(
    told
      .filter(([, held]) => !held)
      .map(([bundle]) => bundle)
      .sort(),
    [1, 3],
  )
  assert.deepEqual(bundles.held(), [], 'no root that can never load stays followed')
  bundles.release(0)
  assert.equal(told.length, 4, 'its leave tells nothing more')
})
