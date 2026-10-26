import test from 'node:test'
import assert from 'node:assert/strict'
import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { createCellBoxes } from './boxes.ts'

/** A root and a core node under it. */
function world() {
  const root = new Group()
  const core = new Object3D()
  root.add(core)
  return { root, core }
}

test('a page of the index holds its cells wherever the parents moved since the declaration', () => {
  const { root, core } = world()
  const boxes = createCellBoxes([0], root, [core])
  const page = {
    declared: [5000, 0, 0, 5001, 1, 1],
    parents: [0],
    box: new Float64Array(6),
    written: -1,
  }
  boxes.refresh()
  assert.deepEqual([...boxes.around(page)], [5000, 0, 0, 5001, 1, 1], 'as declared')
  core.position.set(-5000, 0, 0)
  boxes.refresh()
  // Its cells may hang under the parent moved, or under the root that did not.
  assert.deepEqual([...boxes.around(page)], [0, 0, 0, 5001, 1, 1])
  core.position.set(0, 0, 0)
  boxes.refresh()
  assert.deepEqual([...boxes.around(page)], [5000, 0, 0, 5001, 1, 1], 'back where declared')
})

test('a page under a parent declared flat is read wherever that parent grows', () => {
  const { root, core } = world()
  core.scale.set(0, 0, 0)
  const boxes = createCellBoxes([0], root, [core])
  // Declared at scale 0, its cells collapse onto the parent's origin: the page's box is that point.
  const page = {
    declared: [0, 0, 0, 0, 0, 0],
    parents: [0],
    box: new Float64Array(6),
    written: -1,
  }
  boxes.refresh()
  assert.deepEqual([...boxes.around(page)], [0, 0, 0, 0, 0, 0], 'as declared')
  core.scale.set(1, 1, 1)
  boxes.refresh()
  // Nothing carries the flat frame to where the cells stand now: the page may hold any of space.
  assert.deepEqual(
    [...boxes.around(page)],
    [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity],
  )
})

test('a page moves only with the parents its cells hang under', () => {
  // Two core nodes; the page's cells hang under the second alone: the first moving leaves it as
  // declared, and so boxed where it was, not across the 5 km that node moved.
  const root = new Group()
  const [first, second] = [new Object3D(), new Object3D()]
  root.add(first, second)
  const boxes = createCellBoxes([0, 1], root, [first, second])
  const page = {
    declared: [0, 0, 0, 1, 1, 1],
    parents: [1],
    box: new Float64Array(6),
    written: -1,
  }
  boxes.refresh()
  boxes.around(page)
  first.position.set(5000, 0, 0)
  boxes.refresh()
  assert.deepEqual([...boxes.around(page)], [0, 0, 0, 1, 1, 1], 'another parent moved')
  second.position.set(10, 0, 0)
  boxes.refresh()
  assert.deepEqual([...boxes.around(page)], [0, 0, 0, 11, 1, 1], 'its own parent moved')
})

test('the moves count the refreshes that found a parent frame moved, a still frame none', () => {
  const { root, core } = world()
  const boxes = createCellBoxes([0], root, [core])
  boxes.refresh()
  assert.equal(boxes.moves, 0, 'nothing moved since the declaration')
  boxes.refresh()
  assert.equal(boxes.moves, 0, 'a still parent')
  core.position.set(5, 0, 0)
  boxes.refresh()
  assert.equal(boxes.moves, 1, 'the parent moved')
  boxes.refresh()
  assert.equal(boxes.moves, 1, 'and stands')
  core.scale.set(2, 2, 2)
  boxes.refresh()
  assert.equal(boxes.moves, 2, 'it grew')
})
