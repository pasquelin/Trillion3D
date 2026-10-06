// A placed cell's world bundles are read in runs, pages of the session's one read queue: a run is
// one ranged request, a bundle on its way is shared, a run no hold waits on is dropped unread, and
// one the server refuses for good is never asked again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldRootsDag } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { opened, rangeOf, served } from './worldRoots.fixture.ts'

test("a cell's bundles contiguous in the binary are one ranged read", async (t) => {
  const { manifest, ranges, table } = served(t)
  const { roots } = await opened(t, manifest)
  await roots.hold(1) // bundles 2 and 3, side by side in the binary
  assert.deepEqual(ranges.slice(1), [rangeOf(table, 2, 4)])
  assert.deepEqual(roots.held(), [2, 3])
})

test('a cell let go while its run waits in the queue is never fetched; a shared bundle is read once', async (t) => {
  let land = () => {}
  const landing = new Promise<void>((resolve) => (land = resolve))
  const world = served(t, {
    // The first run past the top holds the queue's one transfer until `land`.
    answer: async (from, _to, respond) => {
      if (from === world.table.bundles[1].offset) await landing
      return respond()
    },
  })
  const { manifest, ranges, table } = world
  const { roots } = await opened(t, manifest, { transfers: 1 })
  t.after(land)
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
  assert.deepEqual([roots.held(), queue.stats().failed], [[], 0], 'let go, it leaves')
})

test('a run no hold wants any more leaves the catalogue, failed or not', async (t) => {
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
  assert.deepEqual([roots.held(), queue.stats().failed], [[], 0])
})

test('a bundle read for one page request alone leaves the catalogue, failed or not', async (t) => {
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
  assert.equal(queue.stats().failed, 0, 'its failure left with it')
})
