// A generated world of 100 × 100 cells, every one within reach of its first camera: the world
// bundles its cells hold are read through the session's one queue, a few at a time, each hold by
// the priority of its unit's turn, in the cells' lane ahead of the view's pages (`hlodHolds.ts`),
// those end to end in the binary merged; a reader that refuses them is asked again ever more
// seldom, never once a frame, the holds waiting meanwhile. The holds of the actors that come loaded
// together are asked each by the priority of the unit it belongs to.
import test from 'node:test'
import assert from 'node:assert/strict'
import { flatChain, worldPage } from '../hlod/worldRootsPages.fixture.ts'
import { noBudget, opened, settled } from './cells.fixture.ts'
import { cellAt, gridWorld } from './cellReads.fixture.ts'
import { heldBy } from '../hlod/worldRoots.fixture.ts'
import { createHoldOrder } from '../hlod/hlodHolds.ts'
import { createCellHolds } from './cellHolds.ts'
import { cellPriority, PRIORITY_VISIBLE } from '../streaming/priority.ts'
import { paged } from './paged.fixture.ts'
import { createStreamingSource } from './source.ts'
import { resolveWorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'

const SIDE = 100,
  CELLS = SIDE * SIDE,
  /** The queue's transfers. */ K = 6,
  PAGE = worldPage(0).bytes.byteLength
/** A turn of the event loop: what a read takes, and every promise it settles. */
const turn = () => new Promise(setImmediate)

/** A frame of `world` from the corner, after every read it queued is answered or waits. */
async function frame(world: Awaited<ReturnType<typeof gridWorld>>) {
  world.cells.frame([0, 0, 0], world.port, noBudget)
  await turn()
  const busy = () => world.streamer.stats().loading + world.streamer.stats().queued > 0
  while (busy()) await turn()
}

/** The cells whose bundles the range `[from, to]` reads. */
const cellsIn = (from: number, to: number) =>
  Array.from({ length: (to + 1 - from) / (2 * PAGE) }, (_, i) => cellAt(from, PAGE) + i)

test('a world of 100 × 100 cells in reach reads K at a time, each bundle once, the runs merged', async (t) => {
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
  await opened(world.cells, world.bytes, false)
  await frame(world)
  // Every HLOD 0 cell a top cell here, its actor always loaded (`flatChain`): all are held at the
  // open, their runs merged up to the transfer budget.
  assert.ok(most >= 1 && most <= K, "never more reads in flight than the queue's transfers")
  assert.equal(heldBy(world.roots).length, 2 * CELLS, 'every cell held')
  assert.equal(bytes, 2 * CELLS * PAGE, 'each bundle read once')
  // The actors always loaded of one level are one unit, so every hold asks by one priority and the
  // queue serves them in the order they were asked (`../streaming/queueOrder.ts`): the order they
  // came loaded in — along x, a cell wide each (`flatChain`) —, the first read the nearest cell's,
  // none reversed.
  const runs = started.filter((cell) => cell >= 0)
  assert.equal(runs[0], 0, 'the nearest cell is read first')
  assert.deepEqual(
    runs,
    runs.toSorted((a, b) => a - b),
    'the nearer, the sooner',
  )
  assert.ok(runs.length < CELLS / 10, `the bundles end to end merged: ${runs.length} requests`)
})

test('the actors that come loaded together are held by the priority of the unit each belongs to', () => {
  // Cell 0 is a top, always loaded, over cells 1 and 2; cells 3 and 4 lie in cell 1, cell 5 in
  // cell 2. A hold asks by the turn of the cell its actor lies in — cell 0's own by that of the
  // unit of the actors always loaded, key 6 —, whatever the order the actors came loaded in.
  const chain = {
    ...flatChain(6),
    parent: Int32Array.of(-1, 0, 0, 1, 1, 2),
    rung: Uint8Array.of(2, 1, 1, 0, 0, 0),
  }
  const records = [
    {
      ...{ url: 'a.json', sha256: '', bytes: 1, meshes: [[0, 1] as const], meshPages: [] },
      parents: [[null, [0, 0, 0, 1, 1, 1]] as const],
    },
  ]
  const { partition } = paged(records, 1)
  const source = createStreamingSource(resolveWorldStreaming({}), partition)
  source.set([0, 0, 0], [0, 0, 0])
  const asked = new Map<number, number | undefined>()
  const holds = createCellHolds({
    hold: async (cell: number, { priority }: { priority?: number }) =>
      void asked.set(cell, priority),
    release() {},
  } as never)
  // The units took their turns in this order: cell 2, cell 1, the actors always loaded, cell 0.
  const turns = new Map([
    [2, 0],
    [1, 1],
    [6, 2],
    [0, 3],
  ])
  const slots = { priorityOf: (key?: number) => cellPriority(turns.get(key!) ?? turns.size) }
  const order = createHoldOrder(chain, partition.hlod.grids, source, slots, { key: () => 6 }, holds)
  for (const cell of [3, 4, 5, 2, 1, 0]) order.open(cell)
  order.flush(() => true)
  const [first, second, third, fourth] = [0, 1, 2, 3].map(cellPriority)
  assert.deepEqual(
    asked,
    new Map([
      [3, second],
      [4, second],
      [5, first],
      [2, fourth],
      [1, fourth],
      [0, third],
    ]),
  )
  assert.ok(first < second && second < third && third < fourth && fourth < PRIORITY_VISIBLE)
})

test('the actors always loaded count among the cells loading while their reads wait', async (t) => {
  // Four cells, every one a top whose actor is always loaded (`flatChain`), one cell loading at a
  // time. The unit of the actors starts with the initial load, before any cell is reached; its
  // reads wait, so it is in flight and no cell file is asked, till they land.
  let open!: () => void
  const gate = new Promise<void>((resolve) => (open = resolve))
  const world = await gridWorld(t, 2, K, async (_from, _to, respond) => (await gate, respond()))
  await opened(world.cells, world.bytes, false, [1e9, 0, 0])
  assert.equal(heldBy(world.roots).length, 8, 'the actors are held: the two bundles of each')
  const streaming = resolveWorldStreaming({ worldStreamingMaxLoadingCells: 1 })
  const port = { ...world.port, streaming }
  const files = () => world.asked.filter((url) => /\/c\d+\.json$/.test(url))
  await settled(world.cells, [0, 0, 0], port, noBudget)
  assert.equal(world.cells.stats().cells, 4, 'the four cells are reached')
  assert.deepEqual(files(), [], 'in flight, they leave no room: no cell file is asked')
  // Landed, they free it: the cells load one at a time, a file asked once the one before is placed.
  open()
  await turn()
  while (world.streamer.stats().loading + world.streamer.stats().queued > 0) await turn()
  for (let step = 0; step < 16 && world.cells.stats().held < 4; step++) {
    await settled(world.cells, [0, 0, 0], port, noBudget)
    assert.ok(files().length - world.cells.stats().held <= 1, 'one cell loads at a time')
    for (const url of files()) world.held.add(url)
  }
  assert.equal(world.cells.stats().held, 4, 'every cell placed')
})

test('the actors always loaded open at the first frame of the initial load, whatever the cells wished', async (t) => {
  const world = await gridWorld(t, 2, K, async (_from, _to, respond) => respond())
  const port = {
    ...world.port,
    initialLoad: true,
    streaming: resolveWorldStreaming({ worldStreamingMaxLoadingCells: 1 }),
  }
  world.cells.frame([0, 0, 0], port, noBudget)
  assert.equal(heldBy(world.roots).length, 8, 'held at once, none placed yet')
  assert.equal(world.cells.stats().held, 0)
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
    ({ key }) => void said.push(key),
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
  await opened(world.cells, world.bytes, false)
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
