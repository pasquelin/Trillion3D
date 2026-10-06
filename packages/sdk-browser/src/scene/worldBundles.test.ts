// A placed cell's world bundles are read in runs, pages of the session's one read queue: a run is
// one ranged request, a bundle on its way is shared, a run no hold waits on is dropped unread, and
// one the server refuses for good is never asked again.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import {
  worldRootsDag,
  worldRootsFixture,
} from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { encodeWorldRoots } from '../../../sdk-core/src/manifest/worldRootsRecords.fixture.ts'
import { readWorldRoots } from '../../../sdk-core/src/manifest/worldRootsTable.ts'
import { opened, rangeOf, served, sha } from './worldRoots.fixture.ts'

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
  const { roots } = await opened(t, world.manifest, { transfers })
  t.after(land)
  return { roots, ranges: world.ranges, table: world.table, land }
}

test("a cell's bundles contiguous in the binary are one ranged read", async (t) => {
  const { manifest, ranges, table } = served(t)
  const { roots } = await opened(t, manifest)
  await roots.hold(1) // bundles 2 and 3, side by side in the binary
  assert.deepEqual(ranges.slice(1), [rangeOf(table, 2, 4)])
  assert.deepEqual(roots.held(), [2, 3])
})

test('a cell let go while its run waits in the queue is never fetched; a shared bundle is read once', async (t) => {
  // The first run past the top holds the queue's one transfer until `land`.
  const { roots, ranges, table, land } = await heldAt(t, 1, 1)
  const placed = roots.hold(0) // bundles 1 and 3: two runs
  const leaving = new AbortController()
  const left = roots.hold(1, { signal: leaving.signal }) // bundle 3 on its way, bundle 2 queued
  await new Promise(setImmediate)
  assert.deepEqual(ranges.slice(1), [rangeOf(table, 1, 2)], 'one transfer, the rest wait')
  leaving.abort()
  await assert.rejects(left, { name: 'AbortError' })
  roots.release(1)
  land()
  await placed
  assert.deepEqual(ranges.slice(1), [rangeOf(table, 1, 2), rangeOf(table, 3, 4)])
  assert.deepEqual(roots.held(), [1, 3], 'bundle 2, let go while it waited, was never read')
})

test('a run the server refuses for good (404) is never asked again', async (t) => {
  const world = served(t, {
    answer: async (from, _to, respond) =>
      from === world.table.bundles[2].offset ? new Response('', { status: 404 }) : respond(),
  })
  const { roots, queue } = await opened(t, world.manifest)
  await assert.rejects(roots.hold(1), /PAGE_STREAM_FAILED.*after one attempt/)
  await assert.rejects(roots.hold(1), /PAGE_STREAM_FAILED/)
  assert.deepEqual(world.ranges.slice(1), [rangeOf(world.table, 2, 4)], 'asked once')
  assert.equal(queue.failed(`http://world/world-roots.bin#2-4`), true)
  roots.release(1)
  roots.release(1)
  assert.deepEqual([roots.held(), queue.stats().failed], [[], 1], 'let go, its refusal stays')
})

test('a run no hold wants any more leaves the catalogue, failed or not, its wait still in force', async (t) => {
  const world = served(t, {
    answer: async (from, _to, respond) =>
      from === world.table.bundles[1].offset ? new Response('', { status: 503 }) : respond(),
  })
  const { roots, queue } = await opened(t, world.manifest)
  const run = 'http://world/world-roots.bin#1-2'
  await assert.rejects(roots.hold(0), /PAGE_STREAM_FAILED/)
  assert.equal(queue.failed(run), true, 'its failure waits its turn while the cell wants it')
  roots.release(0)
  await assert.rejects(queue.readBytes(run), /Unknown page/)
  assert.deepEqual([roots.held(), queue.failed(run)], [[], true])
})

test('a bundle read for one page request alone leaves the catalogue; asked again, its wait holds', async (t) => {
  const { clusters, groups } = worldRootsDag()
  const world = served(t, {
    dag: { clusters, groups },
    answer: async (from, _to, respond) =>
      from === world.table.bundles[2].offset ? new Response('', { status: 503 }) : respond(),
  })
  const { roots, queue } = await opened(t, world.manifest)
  const stream = await roots.stream()
  const [, far] = stream.dag!.pages.filter((page) => page.url) // bundle 2's super-root
  await assert.rejects(stream.source.page(far.url), /PAGE_STREAM_FAILED/)
  await assert.rejects(queue.readBytes('http://world/world-roots.bin#2-3'), /Unknown page/)
  const asked = world.ranges.length
  await assert.rejects(stream.source.page(far.url), /PAGE_STREAM_FAILED/)
  assert.equal(world.ranges.length, asked, 'refused at once, never asked every frame')
})

test('a cell let go while its run transfers and held again joins that read: read once', async (t) => {
  const { roots, ranges, table, land } = await heldAt(t, 2)
  const leaving = new AbortController()
  const left = roots.hold(1, { signal: leaving.signal }) // bundles 2 and 3, one run
  await new Promise(setImmediate)
  leaving.abort()
  await assert.rejects(left, { name: 'AbortError' })
  roots.release(1)
  const back = roots.hold(1)
  land()
  await back
  assert.deepEqual(ranges.slice(1), [rangeOf(table, 2, 4)], 'read once')
  assert.deepEqual(roots.held(), [2, 3])
})

test('a run every hold let go while it transfers lands into the bundles still held on it: never read twice', async (t) => {
  const { roots, ranges, table, land } = await heldAt(t, 2)
  const leaving = new AbortController()
  const left = roots.hold(1, { signal: leaving.signal }) // bundles 2 and 3, one run
  await new Promise(setImmediate)
  leaving.abort() // the cell leaves; its hold is released once it settles
  await assert.rejects(left, { name: 'AbortError' })
  land()
  await new Promise(setImmediate)
  await roots.hold(1) // back before its first hold was released
  assert.deepEqual(ranges.slice(1), [rangeOf(table, 2, 4)], 'read once')
})

test('a landed run one of whose bundles is unreadable fails whole: its bundles read again, never stuck', async (t) => {
  const fixture = worldRootsFixture(sha)
  const spec = { ...fixture.spec, bundles: fixture.spec.bundles.map((b) => ({ ...b })) }
  spec.bundles[3].count = 0 // its bytes hold a page its table does not name
  const bytes = encodeWorldRoots(spec)
  const world = served(t, { world: { bytes, bin: fixture.bin, table: readWorldRoots(bytes) } })
  const { roots } = await opened(t, world.manifest)
  await assert.rejects(roots.hold(1), /bundle 3/)
  await assert.rejects(roots.hold(1), /bundle 3/)
  const run = rangeOf(world.table, 2, 4)
  assert.deepEqual(world.ranges.slice(1), [run, run], 'read again, its bundles never left unread')
  assert.deepEqual(roots.held(), [2, 3])
})

test("a page asked while its bundle's run transfers holds the bundle: its cell leaving stops nothing", async (t) => {
  const { roots, ranges, land } = await heldAt(t, 2, undefined, worldRootsDag())
  const stream = await roots.stream()
  const [, far] = stream.dag!.pages.filter((page) => page.url) // bundle 2's super-root
  const leaving = new AbortController()
  const left = roots.hold(1, { signal: leaving.signal }) // bundles 2 and 3, one run
  await new Promise(setImmediate)
  const page = stream.source.page(far.url)
  leaving.abort()
  await assert.rejects(left, { name: 'AbortError' })
  roots.release(1) // the cell left
  land()
  assert.ok((await page).positions.length > 0, 'the page lands')
  assert.deepEqual([ranges.length, roots.held()], [2, []], 'its run read once, then let go')
})
