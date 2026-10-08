// A node's position, quaternion and scale are views of its slot of the transform tree: one copy of
// a pose. They follow the tree when it grows, leave it when the node is destroyed (its slot then
// serves another node), and stay an owner's when shared (`_share`, the physics placer).
import assert from 'node:assert/strict'
import test from 'node:test'
import { Object3D } from './object3d.ts'
import { updateTransformTree } from '../transform-tree/pass.ts'

const treeOf = (node: Object3D) => Object3D._treeOf(node)

test('a pose write lands in the tree slot, and the views follow the tree as it grows', () => {
  const node = new Object3D()
  node.position.set(1, -0, 3)
  node.quaternion.set(0, 0, Math.SQRT1_2, Math.SQRT1_2)
  node.scale.set(2, 2, 2)
  const shared = new Object3D(),
    own = new Float64Array(3)
  shared.position._share(own)
  shared.position.set(7, 8, 9)
  const before = treeOf(node).position
  const many = Array.from({ length: treeOf(node).capacity + 8 }, () => new Object3D())
  const tree = treeOf(node)
  assert.notEqual(tree.position, before, 'the tree grew')
  assert.equal(node.position.elements.buffer, tree.position.buffer)
  assert.equal(node.quaternion.elements.buffer, tree.quaternion.buffer)
  assert.equal(node.scale.elements.buffer, tree.scale.buffer)
  assert.deepEqual([...node.position.elements], [1, -0, 3])
  node.position.x = 5
  assert.equal(tree.position[node.index * 3], 5, 'a write after the growth lands in the new store')
  assert.equal(shared.position.elements, own, "an owner's numbers stay its")
  assert.equal(tree.position[shared.index * 3], 7, 'and the listener still writes the slot')
  assert.ok(many.length > 0)
})

test('a destroyed node keeps its numbers, and the node given its slot keeps its own', () => {
  const gone = new Object3D()
  gone.position.set(4, 5, 6)
  const slot = gone.index
  gone.destroy()
  assert.deepEqual([...gone.position.elements], [4, 5, 6])
  assert.notEqual(gone.position.elements.buffer, treeOf(gone).position.buffer)
  let next = new Object3D()
  while (next.index !== slot) next = new Object3D()
  assert.deepEqual([...next.position.elements], [0, 0, 0], 'the reused slot starts at rest')
  assert.throws(() => gone.position.set(1, 1, 1))
  assert.deepEqual(
    [...next.position.elements],
    [0, 0, 0],
    'a write to the destroyed node lands elsewhere',
  )
})

test('every write a node takes lists it for the frame pass, which carries it to the world', () => {
  const parent = new Object3D(),
    child = new Object3D()
  parent.add(child)
  const tree = treeOf(parent)
  child.matrixAutoUpdate = false
  updateTransformTree(tree)
  child.matrix.elements[12] = 5
  assert.equal(updateTransformTree(tree), 1, 'a matrix written in place')
  assert.equal(child.matrixWorld.elements[12], 5)
  parent.position.y = 2
  assert.equal(updateTransformTree(tree), 2, 'the parent and its child, once each')
  assert.deepEqual([...child.matrixWorld.elements.slice(12, 15)], [5, 2, 0])
  child.matrixWorldNeedsUpdate = true
  assert.equal(updateTransformTree(tree), 1)
  assert.equal(updateTransformTree(tree), 0, 'nothing written since: nothing walked')
})
