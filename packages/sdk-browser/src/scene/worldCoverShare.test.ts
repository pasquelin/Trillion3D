// The bundles the held cells need, told to who follows them — each once when its first cell holds
// it and once when its last lets it go, those held already first —, and the room the cut's cache
// leaves the roots they add, which a cell is held far within.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldRootsFixture } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { createWorldBundles } from './worldBundles.ts'
import type { PageQueue } from '../streaming/types.ts'

/** The fixture's bundles, `rootsIn` counting each one's roots, no session bound: a hold counts its
 *  bundles at once and waits for a queue, let go with the test. */
function bundlesOf(rootsIn?: (bundle: number) => number) {
  const bundles = createWorldBundles(worldRootsFixture().table, 'world-roots.bin', [[]], rootsIn)
  const stop = new AbortController()
  const hold = (cell: number) => void bundles.hold(cell, { signal: stop.signal }).catch(() => {})
  return { bundles, hold, stop }
}

test('a watcher is told each bundle as the cells start or stop holding it', () => {
  // Cell 0 needs bundles 1 and 3 past the top, cell 1 bundles 2 and 3 (`worldRootsFixture`).
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

test('a cell is held far while the roots its unheld bundles add fit the room', () => {
  const { bundles, hold, stop } = bundlesOf((b) => b * 10)
  const { cover } = bundles
  assert.ok(cover.admits(0), 'no room set: any cell')
  let room = 39
  cover.room = () => room
  assert.ok(!cover.admits(0), 'bundles 1 and 3 add 40')
  room = 40
  assert.ok(cover.admits(0), 'asked again once the room grew')
  hold(0)
  room = 20
  assert.ok(cover.admits(1), 'bundle 3 held already: bundle 2 alone')
  room = 19
  assert.ok(!cover.admits(1))
  // Cell 0 lets bundle 3 go: cell 1 would add 50, still refused, the room no larger.
  bundles.release(0)
  assert.ok(!cover.admits(1))
  stop.abort()
})

test("a hold refused for good takes its bundles' roots out at once, its cell still held", async () => {
  const { bundles } = bundlesOf()
  const refusing = {
    signal: new AbortController().signal,
    admit: () => {},
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
