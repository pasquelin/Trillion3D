import test from 'node:test'
import assert from 'node:assert/strict'
import { object, raycast } from './index.ts'
import { geometry } from '../geometry/index.ts'
import { Ray } from '../math/volumes.ts'
import { Vector3 } from '../math/vector3.ts'
import { heldTree, holdTree, raycastTreeBudget, type ShapeTree } from './raycastTrees.ts'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { RAYCAST_TREE_BUDGET } from './raycastTreeBudget.ts'

const down = new Ray(new Vector3(0, 10, 0), new Vector3(0, -1, 0))

test('dispose drops the raycast tree of its geometry', () => {
  const box = object.mesh(geometry.box(2, 2, 2))
  raycast(box, down)
  const held = raycastTreeBudget.held
  assert.ok(heldTree(box.geometry), 'the tree is kept after a raycast')
  box.geometry.dispose()
  assert.equal(heldTree(box.geometry), null)
  assert.ok(raycastTreeBudget.held < held, 'its bytes leave the cache')
})

test('past the budget, the tree cast at least recently is evicted', () => {
  const [a, b, c] = [1, 2, 3].map((s) => object.mesh(geometry.box(s, s, s)))
  raycastTreeBudget.bytes = 0 // an empty cache, whatever an earlier test held
  raycastTreeBudget.bytes = RAYCAST_TREE_BUDGET
  raycast(a, down)
  const one = raycastTreeBudget.held
  raycastTreeBudget.bytes = one * 2 // room for two box trees
  try {
    raycast(b, down)
    raycast(a, down) // a is now the most recent, b the oldest
    raycast(c, down)
    assert.equal(heldTree(b.geometry), null, 'the oldest tree left')
    assert.ok(heldTree(a.geometry) && heldTree(c.geometry))
    assert.ok(raycastTreeBudget.held <= raycastTreeBudget.bytes)
    assert.equal(raycast(b, down).length, 1, 'an evicted shape is still hit, its tree rebuilt')
    raycastTreeBudget.bytes = one // lowering the budget evicts at once, oldest first
    assert.equal(raycastTreeBudget.held, one)
    assert.ok(heldTree(b.geometry), 'the most recent tree stays')
    assert.equal(heldTree(a.geometry), null)
  } finally {
    raycastTreeBudget.bytes = RAYCAST_TREE_BUDGET
  }
})

test('a shape changed since its tree was built is not answered by the old tree', () => {
  const box = object.mesh(geometry.box(2, 2, 2))
  raycast(box, down)
  box.geometry.translate(0, 5, 0)
  assert.equal(heldTree(box.geometry), null)
  assert.ok(Math.abs(raycast(box, down)[0].point.y - 6) < 1e-9)
})

test('ray trees reuse unchanged geometry and store one original face rank per triangle', () => {
  const shape = geometry.box(2, 2, 2),
    mesh = object.mesh(shape)
  const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1))
  assert.equal(raycast(mesh, ray).length, 1)
  const cached = heldTree(shape)!
  assert.equal(cached.ranks.length, 12)
  assert.equal(new Set(cached.ranks).size, 12)
  assert.equal(raycast(mesh, ray).length, 1)
  assert.equal(heldTree(shape), cached)
  shape.dispose()
  assert.equal(heldTree(shape), null)
})

/** A shape tree of `bytes` node bytes and `ranks` triangles, for the cache alone. */
const shapeOf = (g: { version: number }, bytes: number, ranks: number) =>
  ({ version: g.version, tree: { bytes }, ranks: new Uint32Array(ranks) }) as unknown as ShapeTree

test('a tree costs its nodes and its ranks, replaces the one before, and is held only while it fits', () => {
  raycastTreeBudget.bytes = 0
  raycastTreeBudget.bytes = 1000
  try {
    const shape = geometry.box(1, 1, 1)
    holdTree(shape, shapeOf(shape, 100, 10))
    assert.equal(raycastTreeBudget.held, 140, 'a hundred bytes of nodes and ten four-byte ranks')
    holdTree(shape, shapeOf(shape, 60, 10))
    assert.equal(raycastTreeBudget.held, 100, 'the tree it replaces leaves')
    raycastTreeBudget.bytes = 0
    raycastTreeBudget.bytes = 140
    holdTree(shape, shapeOf(shape, 100, 10))
    assert.ok(heldTree(shape), 'a tree of exactly the budget fits')
    const big = geometry.box(2, 2, 2)
    holdTree(big, shapeOf(big, 101, 10))
    assert.equal(heldTree(big), null, 'one byte past the budget')
    assert.equal(raycastTreeBudget.held, 140)
  } finally {
    raycastTreeBudget.bytes = 0
    raycastTreeBudget.bytes = RAYCAST_TREE_BUDGET
  }
})

test('a geometry collected without dispose takes its tree out of the cache', async () => {
  setFlagsFromString('--expose-gc')
  const gc = runInNewContext('gc') as () => void
  raycastTreeBudget.bytes = 0
  raycastTreeBudget.bytes = RAYCAST_TREE_BUDGET
  ;(() => {
    const shape = geometry.box(1, 1, 1)
    holdTree(shape, shapeOf(shape, 100, 10))
  })()
  assert.equal(raycastTreeBudget.held, 140)
  for (let i = 0; i < 20 && raycastTreeBudget.held; i++) {
    gc()
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(raycastTreeBudget.held, 0)
  // One given back first is not taken out a second time when it is collected.
  ;(() => {
    const shape = geometry.box(1, 1, 1)
    holdTree(shape, shapeOf(shape, 100, 10))
    shape.dispose()
  })()
  for (let i = 0; i < 5; i++) {
    gc()
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(raycastTreeBudget.held, 0)
})
