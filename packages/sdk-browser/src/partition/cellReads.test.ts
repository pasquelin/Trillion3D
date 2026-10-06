// A generated world of 100 × 100 cells, every one within reach of its first camera: the world
// bundles its cells hold are read through the session's one queue, a few at a time, nearest first,
// and a reader that refuses them is asked again ever more seldom, never once a frame.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldPage } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { cellHoldings } from './cellPages.ts'
import { opened } from './cells.fixture.ts'
import { cellOfRange, gridWorld } from './cellReads.fixture.ts'

const SIDE = 100,
  CELLS = SIDE * SIDE,
  /** The queue's transfers. */ K = 6,
  PAGE = worldPage(0).byteLength
/** A turn of the event loop: what a read takes, and every promise it settles. */
const turn = () => new Promise(setImmediate)

/** A frame of `world`: its cells' holds whose wait is over asked again, then every read it queued
 *  answered. */
async function frame(world: Awaited<ReturnType<typeof gridWorld>>) {
  cellHoldings(world.cells).manifest.reads()
  const busy = () => world.streamer.stats().loading + world.streamer.stats().queued > 0
  while (busy()) await turn()
  await turn()
}

test('a world of 100 × 100 cells in reach reads its runs K at a time, nearest first, every cell held', async (t) => {
  let flying = 0,
    most = 0
  const started: number[] = []
  const world = await gridWorld(t, SIDE, K, async (range, respond) => {
    started.push(cellOfRange(range, PAGE))
    most = Math.max(most, ++flying)
    await turn()
    flying--
    return respond()
  })
  try {
    await opened(world.cells, world.bytes, 1e6, false)
    await frame(world)
    assert.equal(most, K, "never more reads in flight than the queue's transfers")
    assert.equal(world.roots.held().length, 2 * CELLS, 'every cell held')
    const runs = started.slice(1) // the pinned top first, read as the world opened
    assert.equal(runs.length, CELLS, 'one ranged read a cell, its two bundles side by side')
    // From the eye at the corner, in cells; two cells as far round apart in the last bit.
    const distance = (cell: number) => Math.hypot(cell % SIDE, Math.floor(cell / SIDE))
    const nearer = (at: number) => distance(runs[at]) < distance(runs[at - 1]) - 1e-9
    assert.equal(
      runs.findIndex((_, at) => at && nearer(at)),
      -1,
      'nearest first',
    )
  } finally {
    world.streamer.dispose()
  }
})

test('a reader refusing past N pending is asked again after 0.5 s · 2^k up to 8 s, never in the frame it refused', async (t) => {
  let clock = 0,
    flying = 0,
    refused = 0
  /** The reads the reader answers at once, past which it refuses: none at first, then K. */
  let pending = 0
  t.mock.method(performance, 'now', () => clock)
  const asked = new Map<number, number[]>(),
    said: number[] = []
  const world = await gridWorld(
    t,
    SIDE,
    K,
    async (range, respond) => {
      const cell = cellOfRange(range, PAGE)
      if (cell < 0) return respond() // the pinned top, read as the world opens
      asked.set(cell, [...(asked.get(cell) ?? []), clock])
      if (flying >= pending) {
        refused++
        throw new TypeError('Failed to fetch') // as a browser past its pending requests
      }
      flying++
      await turn()
      flying--
      return respond()
    },
    ({ cell }) => void said.push(cell),
  )
  const gaps = (times: number[]) => times.slice(1).map((at, i) => at - times[i])
  try {
    await opened(world.cells, world.bytes, 1e6, false)
    // A frame every 250 ms: 16 s of refusals.
    for (; clock < 16_000; clock += 250) await frame(world)
    const waits = [...asked.values()].map((times) => gaps(times).join())
    assert.deepEqual(new Set(waits), new Set(['500,1000,2000,4000,8000']), 'each cell, doubling')
    assert.deepEqual([said.length, new Set(said).size], [CELLS, CELLS], 'each said once, at 8 s')
    ;[pending, refused] = [K, 0]
    for (; world.roots.held().length < 2 * CELLS && clock < 32_000; clock += 250) await frame(world)
    assert.equal(world.roots.held().length, 2 * CELLS, 'every cell held once the reader accepts')
    assert.equal(refused, 0, 'the queue never passes the pending reads the reader accepts')
  } finally {
    world.streamer.dispose()
  }
})
