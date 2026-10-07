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

// #1237: a cell that leaves while its read is in flight, the read then failing, lets nothing go.
test('a cell that leaves mid-read releases nothing when its read fails', async () => {
  const bundles = world(new Set([0])),
    held = createCellHolds(bundles)
  held.hold(0)
  held.hold(1)
  held.release(0)
  bundles.land()
  await Promise.all(held.reads())
  assert.deepEqual([bundles.landed, bundles.released, held.held()], [[1], [], 1])
})

test('a cell that leaves and comes back mid-read releases each hold once', async () => {
  const bundles = world(new Set()),
    held = createCellHolds(bundles)
  held.hold(0)
  held.release(0)
  held.hold(0)
  bundles.land()
  await Promise.all(held.reads())
  assert.deepEqual([bundles.landed, bundles.released, held.held()], [[0, 0], [0], 1])
  held.release(0)
  assert.deepEqual([bundles.released, held.held()], [[0, 0], 0])
})

test('a hold that failed holds nothing, and is asked again at the next frame', async () => {
  const bundles = world(new Set([0])),
    held = createCellHolds(bundles)
  held.hold(0)
  bundles.land()
  await Promise.all(held.reads())
  assert.deepEqual([bundles.landed, held.held()], [[], 0], 'nothing held')
  await Promise.all(held.reads())
  assert.deepEqual([bundles.landed, held.held()], [[0], 1], 'asked again: held')
  held.release(0)
  assert.deepEqual(bundles.released, [0])
})

test('without a world, a placed cell holds nothing and asks nothing', () => {
  const held = createCellHolds()
  held.hold(0)
  assert.deepEqual([held.held(), held.reads()], [0, []])
})
