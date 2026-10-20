import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { createCellBoxes } from './boxes.ts'
import { openAll, paged } from './paged.fixture.ts'
import { createCellIndex } from './cellIndex.ts'
import { boxDistance, createCellPlan, inCellFrame } from './plan.ts'

const cell = (x: number) => ({ bounds: [x, 0, 0, x + 1, 1, 1] })
/** The plan of cells under the scene root, each one box, found through their index, the grids
 *  loading within `range`. */
function planBoxes(
  cells: { bounds: number[] }[],
  eye: number[],
  range: number,
  held: ReadonlySet<number>,
) {
  const boxes = createCellBoxes([], new Object3D(), [])
  boxes.refresh()
  const records = cells.map(({ bounds }, at) => ({
    ...{ url: `${at}.json`, sha256: '', bytes: 1, meshes: [[0, 1] as const], meshPages: [] },
    parents: [[null, bounds] as const],
  }))
  const { partition, files } = paged(records, 1, undefined, undefined, [range, range, range])
  const index = createCellIndex(partition.pages, 'https://cache.test/', boxes)
  openAll(index, files)
  // Each cell its own HLOD 0 cell (`paged`).
  return createCellPlan(index)(eye, partition.hlod.ranges, new Map([...held].map((c) => [c, c])))
}
test('a sheared root reads every cell the world reach holds, by its least singular value', () => {
  // `(x, y, z) → (x + y, y, z)`: every column is at least 1 long, yet it shrinks the direction
  // `(1, −0.618…, 0)` by 0.618…, the golden ratio's inverse.
  const shear = [1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const local = [1, (1 - Math.sqrt(5)) / 2, 0]
  const world = Math.hypot(local[0] + local[1], local[1], local[2])
  const { eye, reach } = inCellFrame(shear, [0, 0, 0], world)
  assert.ok(Math.hypot(...local) <= reach * (1 + 1e-12), `${Math.hypot(...local)} > ${reach}`)
  assert.deepEqual(eye, [0, 0, 0])
  const flat = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  assert.equal(inCellFrame(flat, [0, 0, 0], 1).reach, Infinity, 'a flattened root reads all')
  // So nearly flat its inverse overflows: it reads all too, rather than throw.
  const nearlyFlat = flat.map((value, at) => (at === 5 ? 1e-310 : value))
  assert.deepEqual(inCellFrame(nearlyFlat, [1, 2, 3], 1), {
    eye: [0, 0, 0],
    reach: Infinity,
    axis: [0, 0, 0],
  })
})

test('the distance to a cell is the distance to its box', () => {
  assert.equal(boxDistance([0, 0, 0, 1, 1, 1], [0.5, 0.5, 0.5]), 0, 'inside')
  // In 2D, glTF's up dropped: a grid's range is a ground distance, a height never unloads a cell.
  assert.equal(boxDistance([0, 0, 0, 1, 1, 1], [4, 50, 5]), 5)
  // A cell under two parents is as near as its nearest box, never the box around both.
  const split = [0, 0, 0, 1, 1, 1, 100, 0, 0, 101, 1, 1]
  assert.equal(boxDistance(split, [50, 0.5, 0.5]), 49)
})

test('cells are read nearest first within their range, and leave further', () => {
  const cells = [cell(40), cell(3), cell(10), cell(200)]
  const range = 20
  const { visible, leave } = planBoxes(cells, [0, 0.5, 0.5], range, new Set())
  assert.deepEqual(visible, [1, 2], 'nearest first; the ones past the range wait')
  assert.deepEqual(leave, [])
  // Held, a cell within the range stays; past it, it leaves.
  const near = planBoxes([cell(range - 1), cell(range + 1)], [0, 0.5, 0.5], range, new Set([0, 1]))
  assert.deepEqual([near.visible, near.leave], [[], [1]])
  // A cell far wider than the range is kept while its box meets the range's sphere.
  const wide = { ...cell(0), bounds: [0, 0, 0, 1000, 1, 1] }
  assert.deepEqual(planBoxes([wide], [1000 + range + 1, 0.5, 0.5], range, new Set([0])).leave, [0])
  assert.deepEqual(planBoxes([wide], [1000 + range - 1, 0.5, 0.5], range, new Set([0])).leave, [])
})
