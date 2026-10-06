// A placed cell's world bundles are read in runs, through the session's one read queue: a run is
// one ranged request, a bundle on its way is shared, and a run no cell wants is dropped unread.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPageStreamer } from '../streaming/pageStreamer.ts'
import { openWorldRoots } from './worldRoots.ts'
import { rangeOf, served } from './worldRoots.fixture.ts'

test("a cell's bundles contiguous in the binary are one ranged read", async (t) => {
  const { manifest, ranges, table } = served(t)
  const roots = (await openWorldRoots(manifest, 'http://world/'))!
  await roots.hold(1) // bundles 2 and 3, side by side in the binary
  assert.deepEqual(ranges.slice(1), [rangeOf(table, 2, 4)])
  assert.deepEqual(roots.held(), [2, 3])
})

test('a cell let go while its run waits in the queue is never fetched; a shared bundle is read once', async (t) => {
  let land = () => {}
  const landing = new Promise<void>((resolve) => (land = resolve))
  const world = served(t, {
    // The first run past the top holds the queue's one transfer until `land`.
    answer: async (range, respond) => {
      if (range === rangeOf(world.table, 1, 2)) await landing
      return respond()
    },
  })
  const { manifest, ranges, table } = world
  const roots = (await openWorldRoots(manifest, 'http://world/'))!
  const streamer = createPageStreamer([], 'http://world/', { workerCount: 1 })
  roots.readThrough(streamer.ranged)
  try {
    const placed = roots.hold(0) // bundles 1 and 3: two runs
    const leaving = new AbortController()
    const left = roots.hold(1, { signal: leaving.signal }) // bundle 3 on its way, bundle 2 queued
    await new Promise(setImmediate)
    assert.deepEqual(ranges.slice(1), [rangeOf(table, 1, 2)], 'one transfer, the rest wait')
    leaving.abort()
    await assert.rejects(left, { name: 'AbortError' })
    land()
    await placed
    assert.deepEqual(ranges.slice(1), [rangeOf(table, 1, 2), rangeOf(table, 3, 4)])
    assert.deepEqual(roots.held(), [1, 3], 'bundle 2, let go while it waited, was never read')
  } finally {
    land()
    streamer.dispose()
  }
})
