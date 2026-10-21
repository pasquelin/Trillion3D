import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { createCellBoxes } from './boxes.ts'
import { openAll, paged } from './paged.fixture.ts'
import { createCellIndex } from './cellIndex.ts'
import { createCellPlan } from './plan.ts'
import { boxDistance } from './reach.ts'
import { inCellFrame } from './reach.ts'
import { createLoadSlots, loadsBefore, type LoadingCell } from './loadSlots.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'
import { createStreamingSource } from './source.ts'
import { resolveWorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'

const cell = (x: number) => ({ bounds: [x, 0, 0, x + 1, 1, 1] })
/** The plan of cells under the scene root, each one box, found through their index, the grids
 *  loading within `range`, seen from `eye` with no heading, `loading` cells loading at once (one
 *  by default): the cells that leave, and the files read this frame. */
function planBoxes(
  cells: { bounds: number[] }[],
  eye: number[],
  range: number,
  held: ReadonlySet<number>,
  loading = 1,
  extra: LoadingCell[] = [],
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
  const streaming = resolveWorldStreaming({ worldStreamingMaxLoadingCells: loading })
  const source = createStreamingSource(streaming, partition)
  source.set(eye, [0, 0, 0])
  const placed = new Map([...held].map((c) => [c, c]))
  // Each cell its own HLOD 0 cell (`paged`).
  const plan = createCellPlan(index, source)
  const { leave, waiting } = plan.plan(eye, partition.hlod.grids, placed)
  const slots = createLoadSlots(streaming, partition.scheme)
  waiting.push(...extra)
  slots.admit(waiting, false)
  return { leave: [...leave], visible: [...plan.files(slots, placed)], plan, slots }
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
  assert.deepEqual(visible, [1], 'nearest first; the ones past the range wait')
  assert.deepEqual(leave, [])
  assert.deepEqual(planBoxes(cells, [0, 0.5, 0.5], range, new Set([1])).visible, [2], 'then next')
  // Held, a cell within the range stays; past it, it leaves.
  const near = planBoxes([cell(range - 1), cell(range + 1)], [0, 0.5, 0.5], range, new Set([0, 1]))
  assert.deepEqual([near.visible, near.leave], [[], [1]])
  // A cell far wider than the range is kept while its box meets the range's sphere.
  const wide = { ...cell(0), bounds: [0, 0, 0, 1000, 1, 1] }
  assert.deepEqual(planBoxes([wide], [1000 + range + 1, 0.5, 0.5], range, new Set([0])).leave, [0])
  assert.deepEqual(planBoxes([wide], [1000 + range - 1, 0.5, 0.5], range, new Set([0])).leave, [])
})

test('the cells load coarse first, then by priority, then nearest, a tie by the lower key', () => {
  const at = (
    key: number,
    level: number,
    priority: number,
    distance: number,
    extent = 2 ** level,
  ): LoadingCell => ({ key, extent, level, priority, distance, raw: distance })
  const cells = [
    at(5, 0, 0, 0.1),
    at(4, 1, 0, 0.9),
    at(3, 0, 1, 0),
    at(2, 0, 0, 0.1),
    at(1, 0, 0, 0.05),
    at(6, 0, 0, 0.5, 8),
  ]
  const order = (scheme: 'hashSet' | 'spatialHash', list: LoadingCell[]) =>
    list.toSorted(loadsBefore(resolveWorldStreaming({}), scheme)).map(({ key }) => key)
  // Loose grids rank by level, square ones by the width of the cell; a lower priority comes
  // before a nearer cell, and two cells as near as each other load by their key.
  assert.deepEqual(order('hashSet', cells), [4, 1, 2, 5, 6, 3])
  assert.deepEqual(order('spatialHash', cells), [6, 4, 1, 2, 5, 3])
  for (const scheme of ['hashSet', 'spatialHash'] as const)
    assert.deepEqual(order(scheme, cells.toReversed()), order(scheme, cells), 'listed in any order')
})

test('the files are read in the order the cells loading started: the nearest first, whatever the order they were met in', () => {
  const cells = [cell(15), cell(3), cell(10), cell(40)]
  const { visible } = planBoxes(cells, [0, 0.5, 0.5], 20, new Set(), 3)
  assert.deepEqual(visible, [1, 2, 0], 'three slots: the three within the range, nearest first')
})

test('the files and the holds of the cells loading read in one order, by the turn of their units', () => {
  const cells = [cell(15), cell(3), cell(10), cell(40)]
  // An HLOD cell above them is wished too, the coarser: its unit ranks before the files' — it
  // holds actors, not files —, though it was met after them, and starts with them.
  const hold = { key: 100, extent: 1000, level: 1, priority: 0, distance: 0, raw: 0 }
  const { visible, plan, slots } = planBoxes(cells, [0, 0.5, 0.5], 20, new Set(), 4, [hold])
  assert.deepEqual(visible, [1, 2, 0], 'the files keep the order of their units')
  const priorities = visible.map((file) => plan.priority(file)!)
  assert.deepEqual(
    priorities,
    priorities.toSorted((a, b) => a - b),
    'each after the one before',
  )
  assert.ok(slots.priorityOf(hold.key) < priorities[0], 'the coarser unit reads before its files')
  assert.ok(
    priorities.every((priority) => priority < PRIORITY_VISIBLE),
    'ahead of the pages',
  )
  assert.equal(plan.priority(999), undefined, 'a file no unit loading names has none')
  assert.ok(slots.priorityOf() > priorities.at(-1)!, 'a read of no unit comes after them')
})
