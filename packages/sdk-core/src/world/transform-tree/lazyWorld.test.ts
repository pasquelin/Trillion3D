// A leaf whose world something else composes (`NODE_WORLD_LAZY`): the frame pass does not walk it —
// it visits the parents that moved, not their children —, and its world, read, is the bits an eager
// pass writes, refreshed on the spot, by the same product in the same order.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NODE_WORLD_LAZY,
  addTransformNode,
  createTransformTree,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
} from './transformTree.ts'
import { updateTransformTree } from './pass.ts'
import { removeTransformNode, releaseTransformNode, reparentTransformNode } from './structure.ts'
import { setNodeWorldLazy } from './structure.ts'
import { updateNodeWorldMatrix } from './update.ts'

/** The pose of node `k` of a family, pseudo-random and the same for every tree that asks. */
function pose(k: number): [number, number, number, number, number, number, number, number] {
  const r = (n: number) => Math.sin(k * 12.9898 + n * 78.233) * 0.5
  const q = [r(1), r(2), r(3), 1 + r(4)],
    length = Math.hypot(...q)
  return [
    r(5) * 40,
    r(6) * 40,
    r(7) * 40,
    q[0] / length,
    q[1] / length,
    q[2] / length,
    q[3] / length,
    0.5 + r(8),
  ]
}

/** `parents` parents, each with `children` leaves, the poses written. */
function family(parents: number, children: number, lazy: boolean) {
  const tree = createTransformTree(4)
  const roots: number[] = [],
    leaves: number[] = []
  for (let p = 0; p < parents; p++) {
    const root = addTransformNode(tree)
    roots.push(root)
    for (let c = 0; c < children; c++) {
      const leaf = addTransformNode(tree, root)
      leaves.push(leaf)
    }
  }
  const write = (node: number, k: number) => {
    const [x, y, z, qx, qy, qz, qw, s] = pose(k)
    setNodePosition(tree, node, x, y, z)
    setNodeQuaternion(tree, node, qx, qy, qz, qw)
    setNodeScale(tree, node, s, s * 1.5, s * 0.75)
  }
  roots.forEach((node, k) => write(node, k))
  leaves.forEach((node, k) => write(node, 1000 + k))
  updateTransformTree(tree)
  if (lazy) for (const leaf of leaves) assert.ok(setNodeWorldLazy(tree, leaf, true))
  return { tree, roots, leaves, write }
}

const worldOf = (tree: ReturnType<typeof createTransformTree>, node: number) => {
  updateNodeWorldMatrix(tree, node, true, false)
  return [...tree.worldViews[node]]
}

test('the pass visits the parents that moved, never the lazy leaves under them', () => {
  const { tree, roots, write } = family(4, 1000, true)
  write(roots[1], 7)
  write(roots[3], 9)
  assert.equal(updateTransformTree(tree), 2, 'two parents, four thousand leaves left alone')
  const eager = family(4, 1000, false)
  eager.write(eager.roots[1], 7)
  eager.write(eager.roots[3], 9)
  assert.equal(updateTransformTree(eager.tree), 2002, 'the eager pass walks them all')
})

test('a lazy leaf read is the eager world, to the bit, after parents and leaves moved', () => {
  const lazy = family(3, 50, true),
    eager = family(3, 50, false)
  for (const side of [lazy, eager]) {
    side.write(side.roots[0], 77)
    side.write(side.roots[2], 78)
    // A leaf that moved on its own, its parent still.
    side.write(side.leaves[60], 79)
    updateTransformTree(side.tree)
  }
  lazy.leaves.forEach((leaf, k) =>
    assert.deepEqual(worldOf(lazy.tree, leaf), worldOf(eager.tree, eager.leaves[k]), `leaf ${k}`),
  )
})

test('a leaf made lazy leaves the children no walk steps over; made eager again it is recalculated', () => {
  const { tree, roots, leaves, write } = family(1, 3, true)
  const parent = roots[0]
  assert.equal(tree.firstChild[parent], -1, 'no child among the children')
  assert.ok(tree.flags[leaves[0]] & NODE_WORLD_LAZY)
  write(parent, 5)
  updateTransformTree(tree)
  assert.ok(setNodeWorldLazy(tree, leaves[1], false))
  assert.notEqual(tree.firstChild[parent], -1)
  const visited = updateTransformTree(tree)
  assert.equal(visited, 1, 'the leaf taken back is walked, the parent was not listed')
  const [a] = [...tree.worldViews[leaves[1]]].slice(12, 13)
  assert.equal(a, worldOf(tree, leaves[1])[12], 'its world is the parent’s by its local')
  // A root and a node with children cannot be lazy.
  assert.equal(setNodeWorldLazy(tree, parent, true), false)
  const grandchild = addTransformNode(tree, leaves[1])
  assert.equal(setNodeWorldLazy(tree, leaves[1], true), false, 'it has a child now')
  assert.ok(grandchild >= 0)
})

test('removing a parent frees its lazy leaves, releasing it makes them roots, a move to another parent makes them eager', () => {
  const removed = family(2, 4, true)
  const before = removed.tree.freeCount
  removeTransformNode(removed.tree, removed.roots[0])
  assert.equal(removed.tree.freeCount - before, 5, 'the parent and its four lazy leaves')
  const released = family(1, 4, true)
  releaseTransformNode(released.tree, released.roots[0])
  for (const leaf of released.leaves) {
    assert.equal(released.tree.parent[leaf], -1)
    assert.equal(released.tree.flags[leaf] & NODE_WORLD_LAZY, 0)
  }
  const moved = family(2, 2, true)
  reparentTransformNode(moved.tree, moved.leaves[0], moved.roots[1])
  assert.equal(moved.tree.flags[moved.leaves[0]] & NODE_WORLD_LAZY, 0)
  assert.equal(moved.tree.parent[moved.leaves[0]], moved.roots[1])
  assert.equal(updateTransformTree(moved.tree), 1)
})

test('a lazy mesh reads its world, parent moved or not, as an eager one does (matrixWorld)', async () => {
  const { Group } = await import('../object/object3d.ts')
  const { Mesh } = await import('../object/mesh.ts')
  const build = (lazy: boolean) => {
    const parent = new Group(),
      leaf = new Mesh()
    parent.add(leaf)
    leaf.position.set(1, 2, 3)
    parent.updateMatrixWorld(true)
    if (lazy) assert.ok(leaf._setWorldLazy(true))
    parent.position.set(5, 0, -4)
    parent.scale.set(2, 2, 2)
    parent.updateMatrixWorld()
    return leaf
  }
  const lazy = build(true),
    eager = build(false)
  assert.deepEqual([...lazy.matrixWorld.elements], [...eager.matrixWorld.elements])
  assert.deepEqual([...lazy.worldMatrix], [...eager.worldMatrix])
})
