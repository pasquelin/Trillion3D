import test from 'node:test'
import assert from 'node:assert/strict'
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { packDagSelection } from '../pack/pack.ts'
import { createPlacementBoxes } from './placementBoxes.ts'
import { placementField } from './placementTree.fixture.ts'

/** Eighty-one placements of a unit box, three metres apart on x and z. */
function field() {
  const roots = placementField(9, 3)
  roots.forEach((root) => (root.localBox = new Float64Array([0, 0, 0, 1, 1, 1])))
  const packed = packDagSelection(roots)
  const boxes = createPlacementBoxes(packed, packed.worldCount, () => packed.worldSources.length)
  return { roots, packed, boxes }
}

test('the placements’ boxes are their local box through their world, their extent the union of them', () => {
  const { boxes } = field()
  const first = boxes.boxes()
  assert.equal(first.placements, 81)
  assert.equal(first.moved.count > 0, true, 'every box is new at the first call')
  // The strip lies along x from 0 and along -z from 0, three metres a placement, eight steps each way.
  assert.deepEqual(first.extent, [0, 0, -24, 25, 1, 1])
  assert.equal(boxes.boxes().moved.count, 0, 'nothing marked, nothing moved')
})

test('a placement that moves moves its box and its run, and the extent grows with it; one that stays in its box moves none', () => {
  const { roots, boxes } = field()
  boxes.boxes()
  ;(roots[80].world.elements as number[])[12] += 10
  boxes.mark(80)
  const moved = boxes.boxes()
  assert.deepEqual(Array.from(moved.moved.pairs).slice(0, 2 * moved.moved.count), [80, 80])
  assert.equal(moved.extent[3], 35)
  boxes.mark(80)
  assert.equal(boxes.boxes().moved.count, 0, 'the world did not change the box')
})

test('a parked placement holds no box, and none is counted for a root with no local box', () => {
  const { roots, packed, boxes } = field()
  boxes.boxes()
  packed.rootNodes[0] = NO_INDEX
  boxes.mark(0)
  assert.equal(boxes.boxes().placements, 80)
  roots[1].localBox = undefined
  boxes.mark(1)
  const after = boxes.boxes()
  assert.equal(after.placements, 79)
  assert.deepEqual(
    after.extent.slice(0, 3),
    [0, 0, -24],
    'the extent is found again over the boxes that are left',
  )
})
