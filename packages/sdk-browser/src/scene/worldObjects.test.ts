// A placed row draws the world object of its cell's node for its primitive: the cook writes each
// node's first object, its run a primitive of its mesh each; a node whose mesh it continued nothing
// of has none, nor does a node it left outside the table — never shifting the nodes after it onto
// objects not theirs —, and the ranks run on across cells, an empty one included. On a generated
// table of four cells.
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
 *  one of mesh 0; cell 3: a node of mesh 0 the cook left outside the table, then another of mesh 0.
 *  Published node ids 10 to 15. */
function table() {
  const { spec } = worldRootsFixture()
  const object = (node: number, primitive: number) => ({
    node,
    primitive,
    roots: [0],
    dependencies: [0],
  })
  spec.cells = [
    { objects: [object(10, 0), object(10, 1), object(11, 2)], nodes: [0, 2] },
    { objects: [], nodes: [] },
    { objects: [object(13, 0), object(13, 1)], nodes: [-1, 0] },
    { objects: [object(15, 0), object(15, 1)], nodes: [-1, 0] },
  ]
  return readWorldRoots(encodeWorldRoots(spec))
}

test('a row draws the object of its node and primitive, ranked across the cells', () => {
  const objects = createWorldObjects(table(), primitives)
  assert.equal(objects.objectOf(0, 0, 0, 0), 0)
  assert.equal(objects.objectOf(0, 0, 0, 1), 1)
  assert.equal(objects.objectOf(0, 1, 1, 0), 2)
  assert.equal(objects.objectOf(2, 0, 2, 0), -1, 'its mesh was continued into nothing')
  assert.equal(objects.objectOf(2, 1, 0, 0), 3, 'past an empty cell')
  assert.equal(objects.objectOf(2, 1, 0, 1), 4)
  assert.equal(objects.objectOf(0, 1, 0, 0), -1, 'a primitive its node does not wear')
  assert.equal(objects.objectOf(7, 0, 0, 0), -1, 'a cell the table does not hold')
})

test('a node the cook left outside the table shifts no node after it', () => {
  const objects = createWorldObjects(table(), primitives)
  // Both nodes of cell 3 place mesh 0: the first, outside the table, draws its own pages.
  assert.equal(objects.objectOf(3, 0, 0, 0), -1, 'its own, no object of another node')
  assert.equal(objects.objectOf(3, 1, 0, 0), 5, 'the second node draws its own objects')
  assert.equal(objects.objectOf(3, 1, 0, 1), 6)
})

test('a lookup reads its node’s run in place, never the cell’s objects', () => {
  // One cell of 2000 nodes, a primitive each: a lookup costs its node's run, not the cell.
  const { spec } = worldRootsFixture()
  const objects = Array.from({ length: 2000 }, (_, node) => ({
    node,
    primitive: node % 3,
    roots: [0],
    dependencies: [0],
  }))
  spec.cells = [{ objects, nodes: objects.map((_, node) => node) }]
  const read = readWorldRoots(encodeWorldRoots(spec))
  // Every object word the lookups read, counted: a node's run alone, never the cell's.
  let words = 0
  const { objectNode } = read.cells
  read.cells.objectNode = (object) => (words++, objectNode(object))
  const lookup = createWorldObjects(read, primitives)
  for (let node = 0; node < 2000; node++)
    assert.equal(
      lookup.objectOf(0, node, primitives[node % 3].mesh, primitives[node % 3].primitive),
      node,
    )
  assert.ok(words <= 2 * 2000 + 2000, `${words} words for 2000 lookups`)
})
