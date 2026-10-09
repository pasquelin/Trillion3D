// A generated world of 100 × 100 cells, every one within reach of its first camera: the world
// bundles its cells hold are read through the session's one queue, a few at a time, nearest first,
// those end to end in the binary merged; a reader that refuses them is asked again ever more
// seldom, never once a frame, the holds waiting meanwhile.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldPage } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { noBudget, opened } from './cells.fixture.ts'
import { cellAt, gridWorld } from './cellReads.fixture.ts'
import { heldBy } from '../scene/worldRoots.fixture.ts'

const SIDE = 100,
  CELLS = SIDE * SIDE,
  /** The queue's transfers. */ K = 6,
  PAGE = worldPage(0).bytes.byteLength
/** A turn of the event loop: what a read takes, and every promise it settles. */
const turn = () => new Promise(setImmediate)

/** A frame of `world` from the corner, after every read it queued is answered or waits. */
async function frame(world: Awaited<ReturnType<typeof gridWorld>>) {
  world.cells.frame([0, 0, 0], 1e6, world.port, noBudget)
  await turn()
  const busy = () => world.streamer.stats().loading + world.streamer.stats().queued > 0
  while (busy()) await turn()
}

/** The cells whose bundles the range `[from, to]` reads. */
const cellsIn = (from: number, to: number) =>
  Array.from({ length: (to + 1 - from) / (2 * PAGE) }, (_, i) => cellAt(from, PAGE) + i)

test('a world of 100 × 100 cells in reach reads K at a time, nearest first, each bundle once', async (t) => {
  let flying = 0,
    most = 0,
    bytes = 0
  const started: number[] = []
  const world = await gridWorld(
    t,
    SIDE,
    K,
    async (from, to, respond) => {
      started.push(cellAt(from, PAGE))
      if (cellAt(from, PAGE) >= 0) bytes += to + 1 - from
      most = Math.max(most, ++flying)
      await turn()
      flying--
      return respond()
    },
    undefined,
    64 * 2 * PAGE,
  ) // a transfer of 64 cells at most
  await opened(world.cells, world.bytes, 1e6, false)
  await frame(world)
  assert.equal(most, K, "never more reads in flight than the queue's transfers")
  assert.equal(heldBy(world.roots).length, 2 * CELLS, 'every cell held')
  assert.equal(bytes, 2 * CELLS * PAGE, 'each bundle read once')
  const runs = started.slice(1) // the pinned top first, read as the world opened
  assert.equal(runs[0], 0, 'the nearest cell first')
  assert.ok(runs.length < CELLS / 10, `the bundles end to end merged: ${runs.length} requests`)
})

test('a reader refusing past N pending is asked again after 0.5 s · 2^k up to 8 s, never in the frame it refused', async (t) => {
  let clock = 0,
    flying = 0,
    refused = 0
  /** The reads the reader answers at once, past which it refuses: none at first, then K. */
  let pending = 0
  t.mock.method(performance, 'now', () => clock)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const asked = new Map<number, number[]>(),
    said: string[] = []
  const world = await gridWorld(
    t,
    SIDE,
    K,
    async (from, to, respond) => {
      if (cellAt(from, PAGE) < 0) return respond() // the pinned top, read as the world opens
      for (const cell of cellsIn(from, to)) asked.set(cell, [...(asked.get(cell) ?? []), clock])
      if (flying >= pending) {
        refused++
        throw new TypeError('Failed to fetch') // as a browser past its pending requests
      }
      flying++
      await turn()
      flying--
      return respond()
    },
    ({ url }) => void said.push(url),
  )
  /** Frames every 250 ms until `end`, each after the waits over by then told their turn. */
  const frames = async (end: number, until = () => false) => {
    for (; clock < end && !until(); clock += 250, t.mock.timers.tick(250)) {
      await turn()
      await frame(world)
    }
  }
  /** The waits between a cell's reads, one request a wait. */
  const gaps = (times: number[]) => times.slice(1).map((at, i) => at - times[i])
  await opened(world.cells, world.bytes, 1e6, false)
  await frames(16_000)
  const waits = [...asked.values()].map((times) => gaps(times).join())
  assert.deepEqual(new Set(waits), new Set(['500,1000,2000,4000,8000']), 'each cell, doubling')
  assert.deepEqual(
    [said.length, new Set(said).size],
    [2 * CELLS, 2 * CELLS],
    'each said once, at 8 s',
  )
  ;[pending, refused] = [K, 0]
  await frames(32_000, () => heldBy(world.roots).length === 2 * CELLS)
  assert.equal(heldBy(world.roots).length, 2 * CELLS, 'every cell held once the reader accepts')
  assert.equal(refused, 0, 'the queue never passes the pending reads the reader accepts')
})
