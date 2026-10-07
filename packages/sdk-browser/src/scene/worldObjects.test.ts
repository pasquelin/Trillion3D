// A placed row draws the world object of its cell's node for its primitive: the objects
// of a cell are its nodes' runs, in node order, one object per primitive the cook continued; a
// node whose mesh it continued nothing of has no run, and the ranks run on across cells, an empty
// one included. On a generated table of three cells.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldRootsFixture } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { encodeWorldRoots } from '../../../sdk-core/src/manifest/worldRootsRecords.fixture.ts'
import { readWorldRoots } from '../../../sdk-core/src/manifest/worldRootsTable.ts'
import type { Primitive } from '../../../sdk-core/src/index.ts'
import { createWorldObjects } from './worldObjects.ts'

/** Mesh 0 has two primitives, mesh 1 one, mesh 2 one the cook continued nothing of. */
const primitives = [
  { mesh: 0, primitive: 0 },
  { mesh: 0, primitive: 1 },
  { mesh: 1, primitive: 0 },
  { mesh: 2, primitive: 0 },
] as Primitive[]

/** Cell 0: a node of mesh 0, then one of mesh 1; cell 1: empty; cell 2: a node of mesh 2, then
 *  one of mesh 0. Published node ids 10, 11, 12, 13. */
function table() {
  const { spec } = worldRootsFixture()
  const object = (node: number, primitive: number) => ({
    node,
    primitive,
    roots: [0],
    dependencies: [0],
  })
  spec.cells = [
    { objects: [object(10, 0), object(10, 1), object(11, 2)] },
    { objects: [] },
    { objects: [object(13, 0), object(13, 1)] },
  ]
  return readWorldRoots(encodeWorldRoots(spec))
}

test('a row draws the object of its node and primitive, ranked across the cells', () => {
  const objects = createWorldObjects(table(), primitives)
  const first = Int32Array.of(0, 1),
    third = Int32Array.of(2, 0)
  assert.equal(objects.objectOf(0, 0, first, 0, 0), 0)
  assert.equal(objects.objectOf(0, 0, first, 0, 1), 1)
  assert.equal(objects.objectOf(0, 1, first, 1, 0), 2)
  assert.equal(objects.objectOf(2, 0, third, 2, 0), -1, 'its mesh was continued into nothing')
  assert.equal(objects.objectOf(2, 1, third, 0, 0), 3, 'past an empty cell')
  assert.equal(objects.objectOf(2, 1, third, 0, 1), 4)
  assert.equal(objects.objectOf(0, 1, first, 0, 0), -1, 'a primitive its node does not wear')
  assert.equal(objects.objectOf(7, 0, first, 0, 0), -1, 'a cell the table does not hold')
})

test('a cell placed again with other nodes is read again', () => {
  const objects = createWorldObjects(table(), primitives)
  assert.equal(objects.objectOf(2, 1, Int32Array.of(2, 0), 0, 0), 3)
  // The same cell read against nodes that place mesh 0 first: its first run is theirs.
  assert.equal(objects.objectOf(2, 0, Int32Array.of(0, 2), 0, 1), 4)
  objects.release(2)
  assert.equal(objects.objectOf(2, 1, Int32Array.of(2, 0), 0, 1), 4)
})
