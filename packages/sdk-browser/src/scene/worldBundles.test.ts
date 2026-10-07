// A placed cell's world bundles are pages of the session's one read queue: those queued end to end
// in the binary are one ranged request, a bundle on its way is shared, one no hold waits on is
// dropped unread, one that may pass waits its turn, and one refused for good is never asked again.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { eventually } from '../streaming/eventually.fixture.ts'
import {
  worldRootsDag,
  worldRootsFixture,
} from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { encodeWorldRoots } from '../../../sdk-core/src/manifest/worldRootsRecords.fixture.ts'
import { readWorldRoots } from '../../../sdk-core/src/manifest/worldRootsTable.ts'
import { heldBy, opened, rangeOf, served, sha } from './worldRoots.fixture.ts'
import { openWorldRoots } from './worldRoots.ts'
import { createPageStreamer } from '../streaming/pageStreamer.ts'

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
  assert.deepEqual(ranges.slice(1), [rangeOf(table, 2, 4)])
  assert.deepEqual(heldBy(roots), [2, 3])
})

test('a hold let go while its bundle waits in the queue drops it, its cell still placed; a shared one is read once', async (t) => {
  // The first bundle past the top holds the queue's one transfer until `land`.
  const { roots, queue, ranges, table, land } = await heldAt(t, 1, 1)
  const placed = roots.hold(0) // bundles 1 and 3: two ranges apart
  await eventually(() => ranges.length === 2) // bundle 1 transfers
  const leaving = new AbortController()
  const left = roots.hold(1, { signal: leaving.signal }) // bundle 3 on its way, bundle 2 queued
  await eventually(() => queue.loading('http://world/world-roots.bin#2'))
  assert.deepEqual(ranges.slice(1), [rangeOf(table, 1, 2)], 'one transfer, the rest wait')
  leaving.abort() // the hold lets go: its cell is not released yet
  await assert.rejects(left, { name: 'AbortError' })
  land()
  await placed
  assert.deepEqual(ranges.slice(1), [rangeOf(table, 1, 2), rangeOf(table, 3, 4)], 'bundle 2 unread')
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
  assert.deepEqual(world.ranges.slice(1), [rangeOf(world.table, 2, 4)], 'asked once')
  assert.equal(queue.failed('http://world/world-roots.bin#2'), true)
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
  const bundle = 'http://world/world-roots.bin#1'
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
  const { clusters, groups } = worldRootsDag()
  const world = served(t, {
    dag: { clusters, groups },
    answer: async (from, _to, respond) =>
      from === world.table.bundles[2].offset ? new Response('', { status: 404 }) : respond(),
  })
  const { roots } = await opened(t, world.manifest)
  const stream = await roots.stream()
  const [, far] = stream.dag!.pages.filter((page) => page.url) // bundle 2's super-root
  await assert.rejects(stream.source.page(far.url), /PAGE_STREAM_FAILED/)
  const asked = world.ranges.length
  await assert.rejects(stream.source.page(far.url), /PAGE_STREAM_FAILED/)
  assert.equal(world.ranges.length, asked, 'refused at once, never asked every frame')
  assert.deepEqual(heldBy(roots), [], 'let go')
})

test('a cell let go while its bundles transfer and held again joins that read: read once', async (t) => {
  const { roots, ranges, table, land } = await heldAt(t, 2)
  const leaving = new AbortController()
  const left = roots.hold(1, { signal: leaving.signal }) // bundles 2 and 3, one read
  await eventually(() => ranges.length === 2) // under way
  leaving.abort()
  await assert.rejects(left, { name: 'AbortError' })
  roots.release(1)
  const back = roots.hold(1)
  land()
  await back
  assert.deepEqual(ranges.slice(1), [rangeOf(table, 2, 4)], 'read once')
  assert.deepEqual(heldBy(roots), [2, 3])
})

test('a bundle that lands unreadable fails its hold: the next hold reads it again, never stuck', async (t) => {
  const fixture = worldRootsFixture(sha)
  const spec = { ...fixture.spec, bundles: fixture.spec.bundles.map((b) => ({ ...b })) }
  spec.bundles[3].count = 0 // its bytes hold a page its table does not name
  const bytes = encodeWorldRoots(spec)
  const world = served(t, { world: { bytes, bin: fixture.bin, table: readWorldRoots(bytes) } })
  const { roots } = await opened(t, world.manifest)
  await assert.rejects(roots.hold(1), /bundle 3/)
  await assert.rejects(roots.hold(1), /bundle 3/)
  assert.deepEqual(
    world.ranges.slice(1),
    [rangeOf(world.table, 2, 4), rangeOf(world.table, 3, 4)],
    'the unreadable one read again, the other kept',
  )
  assert.deepEqual(heldBy(roots), [2, 3])
})

test('a page asked while its bundle transfers holds the bundle: its cell leaving stops nothing', async (t) => {
  const { roots, ranges, land } = await heldAt(t, 2, undefined, worldRootsDag())
  const stream = await roots.stream()
  const [, far] = stream.dag!.pages.filter((page) => page.url) // bundle 2's super-root
  const leaving = new AbortController()
  const left = roots.hold(1, { signal: leaving.signal }) // bundles 2 and 3, one read
  await eventually(() => ranges.length === 2) // under way
  const page = stream.source.page(far.url)
  leaving.abort()
  await assert.rejects(left, { name: 'AbortError' })
  roots.release(1) // the cell left
  land()
  assert.ok((await page).positions.length > 0, 'the page lands')
  assert.deepEqual([ranges.length, heldBy(roots)], [2, []], 'its bundle read once, then let go')
})

test('a cell held before its world is bound waits for the bind, then reads', async (t) => {
  const { manifest, ranges, table } = served(t)
  const roots = (await openWorldRoots(manifest, 'http://world/'))!
  const queue = createPageStreamer([], 'http://world/')
  t.after(() => queue.dispose())
  const held = roots.hold(1)
  await new Promise(setImmediate)
  roots.bind(queue)
  await held
  assert.deepEqual(ranges.slice(1), [rangeOf(table, 2, 4)])
})

test("a hold under way as its session's queue closes reads in the next session's queue: never lost", async (t) => {
  const { roots, queue, ranges, table, land } = await heldAt(t, 2)
  const held = roots.hold(1) // bundles 2 and 3, one read, under way
  await eventually(() => ranges.length === 2)
  const next = createPageStreamer([], 'http://world/')
  queue.dispose() // the device is lost: its session closes
  land()
  roots.bind(next) // the next session
  t.after(() => next.dispose())
  await held
  const run = rangeOf(table, 2, 4)
  assert.deepEqual(ranges.slice(1), [run, run], 'read again there')
})
