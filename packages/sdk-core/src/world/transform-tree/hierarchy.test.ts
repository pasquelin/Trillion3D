// Parent/child rules of the hierarchy, each stated and checked on its own (the replay against the
// witness library lives in the bench, `bench/perf/browser/hierarchy.perf.ts`; the camera's
// projection rules in `projection.test.ts`).
// Rules: a world matrix is the parent's world matrix times the local one; a mirrored or
// zero-scale ancestor stays finite; a reparent moves the world pose with the new parent; `lookAt`
// puts the node's axis on the line of sight and has a defined answer when the eye is on the
// target or the up is collinear.
import test from 'node:test'
import assert from 'node:assert/strict'
import { determinantMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import {
  addTransformNode,
  createTransformTree,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
} from './transformTree.ts'
import { updateNodeMatrixWorld } from './update.ts'
import { lookAtNode } from './lookAt.ts'
import { nodeWorldDirection } from './read.ts'
import { reparentTransformNode } from './structure.ts'
import { assertPoint, near, transformPoint } from './points.fixture.ts'

const QUARTER_Z = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const // 90 degrees about z

test('a depth-4 chain with a two-child branch: a point of a leaf goes through scale, turn and shift of every ancestor, innermost first', () => {
  const tree = createTransformTree(8)
  const a = addTransformNode(tree)
  const b = addTransformNode(tree, a)
  const c = addTransformNode(tree, b)
  const d = addTransformNode(tree, c)
  const sibling = addTransformNode(tree, c)
  setNodePosition(tree, a, 1, 0, 0)
  setNodeScale(tree, b, 2, 3, 4)
  setNodeQuaternion(tree, b, ...QUARTER_Z)
  setNodePosition(tree, c, 0, 1, 0)
  setNodePosition(tree, d, 5, 0, 0)
  setNodePosition(tree, sibling, 0, 0, 7)
  updateNodeMatrixWorld(tree, a, true)
  // d: local (1,1,1) -> shift (6,1,1); c shift (6,2,1); b scale (12,6,4) then a quarter turn about z
  // (x,y) -> (-y,x): (-6,12,4); a shift: (-5,12,4).
  assertPoint(transformPoint(tree.worldViews[d], [1, 1, 1]), [-5, 12, 4], 'leaf d')
  // the sibling shares the chain but not d's shift: (1,1,1) -> (1,1,8) -> (1,2,8) -> (2,6,32) -> (-6,2,32) -> (-5,2,32).
  assertPoint(transformPoint(tree.worldViews[sibling], [1, 1, 1]), [-5, 2, 32], 'leaf sibling')
})

test('a negative scale on one axis mirrors the face winding; two negative axes do not; a zero scale keeps every value finite', () => {
  const tree = createTransformTree(4)
  const root = addTransformNode(tree)
  const child = addTransformNode(tree, root)
  setNodeScale(tree, root, -1, 1, 1)
  updateNodeMatrixWorld(tree, root, true)
  assert.ok(determinantMatrix4(tree.worldViews[child]) < 0)
  setNodeScale(tree, child, -1, 1, 1)
  updateNodeMatrixWorld(tree, root, true)
  assert.ok(determinantMatrix4(tree.worldViews[child]) > 0)
  setNodeScale(tree, root, 0, 1, 1)
  setNodePosition(tree, child, 2, 3, 4)
  updateNodeMatrixWorld(tree, root, true)
  assert.equal(determinantMatrix4(tree.worldViews[child]), 0)
  assert.ok([...tree.worldViews[child]].every(Number.isFinite))
  assertPoint(transformPoint(tree.worldViews[child], [1, 1, 1]), [0, 4, 5], 'collapsed axis')
})

test('reparenting: the world pose follows the new parent at the next update, and the old parent no longer moves it', () => {
  const tree = createTransformTree(4)
  const left = addTransformNode(tree)
  const right = addTransformNode(tree)
  const node = addTransformNode(tree, left)
  setNodePosition(tree, left, -10, 0, 0)
  setNodePosition(tree, right, 20, 0, 0)
  setNodePosition(tree, node, 1, 1, 1)
  updateNodeMatrixWorld(tree, left, true)
  assertPoint(tree.worldViews[node].subarray(12, 15), [-9, 1, 1], 'under left')
  reparentTransformNode(tree, node, right)
  setNodePosition(tree, left, 99, 0, 0)
  updateNodeMatrixWorld(tree, right, true)
  assertPoint(tree.worldViews[node].subarray(12, 15), [21, 1, 1], 'under right')
})

test('lookAt: an object presents +z toward the target, a camera looks down -z toward it, under a rotated parent too', () => {
  const tree = createTransformTree(4)
  const parent = addTransformNode(tree)
  setNodeQuaternion(tree, parent, ...QUARTER_Z)
  setNodePosition(tree, parent, 3, -2, 1)
  const object = addTransformNode(tree, parent)
  const camera = addTransformNode(tree, parent)
  const out = new Float64Array(3)
  const up = [0, 1, 0]
  const target = [4, 9, -6]
  for (const [node, viewer] of [
    [object, false],
    [camera, true],
  ] as const) {
    lookAtNode(tree, node, target[0], target[1], target[2], up, viewer)
    const eye = [...tree.worldViews[node].subarray(12, 15)]
    const toTarget = target.map((t, i) => t - eye[i])
    const length = Math.hypot(...toTarget)
    nodeWorldDirection(out, tree, node, viewer)
    assertPoint(
      out,
      toTarget.map((v) => v / length),
      viewer ? 'camera' : 'object',
    )
  }
})

test('lookAt: with the eye on the target, or the up collinear with the line of sight, the direction is still a finite unit vector', () => {
  const tree = createTransformTree(4)
  const node = addTransformNode(tree)
  const out = new Float64Array(3)
  setNodePosition(tree, node, 1, 2, 3)
  lookAtNode(tree, node, 1, 2, 3, [0, 1, 0], false)
  nodeWorldDirection(out, tree, node, false)
  assert.ok(near(Math.hypot(...out), 1))
  assert.ok([...out].every(Number.isFinite))
  setNodePosition(tree, node, 0, 0, 0)
  lookAtNode(tree, node, 0, 5, 0, [0, 1, 0], false)
  nodeWorldDirection(out, tree, node, false)
  assert.ok(near(Math.hypot(...out), 1))
  assert.ok(out[1] > 0.999, `still aims up: ${out[1]}`)
})
