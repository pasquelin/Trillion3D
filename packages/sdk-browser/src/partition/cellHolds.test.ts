import test from 'node:test'
import assert from 'node:assert/strict'
import { createCellHolds } from './cellHolds.ts'

/** A world whose holds land when the test says (`land`), those of the cells in `fail` refused
 *  once; it counts each cell's holds landed and released. */
function world(fail: Set<number>) {
  const landed: number[] = [],
    released: number[] = []
  let land = () => {}
  const landing = new Promise<void>((resolve) => (land = resolve))
  return {
    landed,
    released,
    land,
    async hold(cell: number) {
      await landing
      if (fail.delete(cell)) throw new Error('world read failed')
      landed.push(cell)
    },
    release: (cell: number) => void released.push(cell),
  }
}

/** Every hold of `held` on its way, settled. */
async function settled(held: ReturnType<typeof createCellHolds>) {
  for (let reads = held.reads(); reads.length; reads = held.reads()) await Promise.all(reads)
}

// A cell that leaves while its read is in flight lets it go at once, and releases its hold once it
// settles, landed or failed: the world counts each hold once, whatever its outcome.
test('a cell that leaves mid-read releases its hold once it settles, its read failing or not', async () => {
  const bundles = world(new Set([0])),
    held = createCellHolds(bundles)
  held.hold(0)
  held.hold(1)
  held.release(0)
  bundles.land()
  await settled(held)
  assert.deepEqual([bundles.landed, bundles.released, held.held()], [[1], [0], 1])
})

test('a cell that leaves and comes back mid-read releases each hold once', async () => {
  const bundles = world(new Set()),
    held = createCellHolds(bundles)
  held.hold(0)
  held.release(0)
  held.hold(0)
  bundles.land()
  await settled(held)
  assert.deepEqual([bundles.landed, bundles.released, held.held()], [[0, 0], [0], 1])
  held.release(0)
  assert.deepEqual([bundles.released, held.held()], [[0, 0], 0])
})

test('a hold that failed for good stays failed while its cell is placed: never asked again', async () => {
  const bundles = world(new Set([0]))
  let asked = 0
  const held = createCellHolds({ ...bundles, hold: (cell) => (asked++, bundles.hold(cell)) })
  held.hold(0)
  bundles.land()
  await settled(held)
  held.hold(0) // a later frame places it again
  await settled(held)
  assert.deepEqual([asked, bundles.landed, held.held()], [1, [], 1], 'held, asked once')
  held.release(0)
  assert.deepEqual(bundles.released, [0], 'released once')
})

test('a cell that leaves while its hold reads lets its world reads go at once, at its priority', () => {
  const asked: { signal?: AbortSignal; priority?: number }[] = []
  const held = createCellHolds({
    hold: (_, options) => (asked.push(options!), new Promise<void>(() => {})),
    release() {},
  })
  held.hold(3, 1.25)
  held.release(3)
  assert.deepEqual([asked[0].priority, asked[0].signal!.aborted], [1.25, true])
})

test('without a world, a placed cell holds nothing and asks nothing', () => {
  const held = createCellHolds()
  held.hold(0)
  assert.deepEqual([held.held(), held.reads()], [0, []])
})
