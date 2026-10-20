// lookAt.ts: `lookAt` for an object and for a camera, edge case of
// the aim collinear with up, removal of the parent rotation, and zero-scale parent (no
// division by zero that would throw).
//
// `writeAimBasis` keeps the squared length instead of recomputing it, and the local turn removes
// the parent's world rotation read from its own matrix: the deep-parent test confronts it with the
// host library's aiming, the last bit of a component aside (the local turn is one quaternion
// product, `c ⊗ q`, where the host premultiplies). Looking along `up` is the engine's own rule,
// not the host's `0.0001` nudge: the side is `frameAcross`, the first row of the frame around the
// line of sight, and the two degenerate tests check the world axes it gives.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  addTransformNode,
  createTransformTree,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
} from '../../../../../../../packages/sdk-core/src/world/transform-tree/transformTree.ts'
import { lookAtNode } from '../../../../../../../packages/sdk-core/src/world/transform-tree/lookAt.ts'
import { nodeWorldDirection } from '../../../../../../../packages/sdk-core/src/world/transform-tree/read.ts'
import { updateNodeMatrixWorld } from '../../../../../../../packages/sdk-core/src/world/transform-tree/update.ts'
import { frameAcross } from '../../../../../../../packages/math/src/vector/frame.ts'
import { ulpBetween } from '../../../../../../../packages/math/src/float/ulp.fixture.ts'

const UP = [0, 1, 0]
const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol
const direction = (tree: ReturnType<typeof createTransformTree>, node: number, viewer: boolean) => {
  updateNodeMatrixWorld(tree, node, true)
  const out = new Float64Array(3)
  nodeWorldDirection(out, tree, node, viewer)
  return [...out]
}

test('camera lookAt: the view direction (-z) points toward the target', () => {
  const tree = createTransformTree(4)
  const camera = addTransformNode(tree)
  updateNodeMatrixWorld(tree, camera, true) // pose the camera at the origin first
  lookAtNode(tree, camera, 0, 0, -10, UP, true)
  const d = direction(tree, camera, true)
  assert.ok(close(d[0], 0) && close(d[1], 0) && close(d[2], -1))
})

test('object lookAt: the presented direction (+z) points toward the target, opposite the camera for the same aim', () => {
  const tree = createTransformTree(4)
  const target = addTransformNode(tree)
  lookAtNode(tree, target, 0, 0, -10, UP, false)
  const d = direction(tree, target, false)
  assert.ok(close(d[0], 0) && close(d[1], 0) && close(d[2], -1))
})

test('lookAt: the eye already on the target does not throw, the z axis falls back to (0,0,1)', () => {
  const tree = createTransformTree(4)
  const node = addTransformNode(tree)
  assert.doesNotThrow(() => lookAtNode(tree, node, 0, 0, 0, UP, true))
})

test('lookAt: aim collinear with up does not throw and yields a non-zero view axis', () => {
  const tree = createTransformTree(4)
  const node = addTransformNode(tree)
  updateNodeMatrixWorld(tree, node, true)
  lookAtNode(tree, node, 0, -10, 0, UP, true) // target straight under up (0,1,0)
  const d = direction(tree, node, true)
  const norm = Math.hypot(d[0], d[1], d[2])
  assert.ok(close(norm, 1), `direction not normalised: ${d}`)
})

test("lookAt under a rotated parent: the local rotation removes the parent's", () => {
  const tree = createTransformTree(4)
  const parent = addTransformNode(tree)
  setNodeQuaternion(tree, parent, 0, 1, 0, 0) // parent half-turn around y
  const child = addTransformNode(tree, parent)
  lookAtNode(tree, child, 0, 0, -10, UP, true)
  const d = direction(tree, child, true)
  // Despite the parent's half-turn, the camera world direction still aims at -z.
  assert.ok(close(d[0], 0) && close(d[1], 0) && close(d[2], -1), `direction: ${d}`)
})

test('lookAt under a zero-scale parent: does not throw (writeColumnRotation divides by a column length, not by scale)', () => {
  const tree = createTransformTree(4)
  const parent = addTransformNode(tree)
  setNodeScale(tree, parent, 0, 1, 1)
  const child = addTransformNode(tree, parent)
  updateNodeMatrixWorld(tree, parent, true)
  assert.doesNotThrow(() => lookAtNode(tree, child, 1, 1, 1, UP, false))
})

/** The local quaternion `(x, y, z, w)` that `lookAtNode` set on `node`. */
const quat = (tree: ReturnType<typeof createTransformTree>, node: number) => [
  tree.quaternion[node * 4],
  tree.quaternion[node * 4 + 1],
  tree.quaternion[node * 4 + 2],
  tree.quaternion[node * 4 + 3],
]

test('lookAt of a camera under a deep (3) rotated and scaled parent: local quaternion within a last bit of Camera.lookAt (squared length kept, parent read at an offset)', () => {
  const tree = createTransformTree(8)
  const grandParent = addTransformNode(tree)
  setNodePosition(tree, grandParent, 2, 0, 0)
  setNodeQuaternion(tree, grandParent, 0, 0.38268343236509, 0, 0.9238795325112867)
  const parent = addTransformNode(tree, grandParent)
  setNodePosition(tree, parent, 0, 3, 0)
  setNodeQuaternion(tree, parent, 0.2705980500730985, 0, 0, 0.9629160522751163)
  setNodeScale(tree, parent, 2, 2, 2)
  const camera = addTransformNode(tree, parent)
  setNodePosition(tree, camera, 1, -1, 2)
  // Initial local rotation, distinct from the parent's: if the aim read the camera's own world
  // matrix instead of the parent's, this value would leak into the result instead of being fully
  // overwritten, as the engine's rule does.
  setNodeQuaternion(tree, camera, 0.7071067811865476, 0, 0, 0.7071067811865476)
  updateNodeMatrixWorld(tree, camera, true)
  lookAtNode(tree, camera, 5, 5, -5, UP, true)

  const gp = new THREE.Object3D()
  gp.position.set(2, 0, 0)
  gp.quaternion.set(0, 0.38268343236509, 0, 0.9238795325112867)
  const p = new THREE.Object3D()
  p.position.set(0, 3, 0)
  p.quaternion.set(0.2705980500730985, 0, 0, 0.9629160522751163)
  p.scale.set(2, 2, 2)
  gp.add(p)
  const cam = new THREE.PerspectiveCamera()
  cam.position.set(1, -1, 2)
  p.add(cam)
  gp.updateMatrixWorld(true)
  cam.lookAt(5, 5, -5)

  const expected = [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w]
  const actual = quat(tree, camera)
  for (let i = 0; i < 4; i++)
    assert.ok(
      ulpBetween(actual[i], expected[i]) <= 1,
      `component ${i} : ${actual[i]} !== ${expected[i]}`,
    )
})

/** Checks that the world axes of `node` are the frame looking along `up`: `z` on the line of sight
 *  `forward`, `x = frameAcross(z)`, `y = z × x`. */
function assertFrameAlongUp(
  tree: ReturnType<typeof createTransformTree>,
  node: number,
  forward: number[],
) {
  updateNodeMatrixWorld(tree, node, true)
  const world = tree.worldViews[node]
  const x = frameAcross([0, 0, 0], forward[0], forward[1], forward[2])
  const y = [
    forward[1] * x[2] - forward[2] * x[1],
    forward[2] * x[0] - forward[0] * x[2],
    forward[0] * x[1] - forward[1] * x[0],
  ]
  for (const [column, axis] of [x, y, forward].entries())
    for (let i = 0; i < 3; i++)
      assert.ok(
        close(world[column * 4 + i], axis[i], 1e-15),
        `column ${column}[${i}] : ${world[column * 4 + i]} !== ${axis[i]}`,
      )
}

test('lookAt: degenerate branch (aim collinear with up) takes the frame across the line of sight, camera and object', () => {
  for (const viewer of [true, false]) {
    const tree = createTransformTree(4)
    const node = addTransformNode(tree)
    updateNodeMatrixWorld(tree, node, true)
    lookAtNode(tree, node, 0, -10, 0, UP, viewer) // target straight under up (0, 1, 0)
    // A camera's `z` runs from the target to the eye, an object's from the eye to the target.
    assertFrameAlongUp(tree, node, viewer ? [0, 1, 0] : [0, -1, 0])
  }
})

test('lookAt: degenerate branch with a vertical up (0,0,1) takes the frame across the line of sight (the other hemisphere of frameAcross)', () => {
  const UP_Z = [0, 0, 1]
  const tree = createTransformTree(4)
  const node = addTransformNode(tree)
  updateNodeMatrixWorld(tree, node, true)
  lookAtNode(tree, node, 0, 0, -10, UP_Z, true) // target collinear with this up
  assertFrameAlongUp(tree, node, [0, 0, 1])
  const object = addTransformNode(tree)
  updateNodeMatrixWorld(tree, object, true)
  lookAtNode(tree, object, 0, 0, -10, UP_Z, false)
  assertFrameAlongUp(tree, object, [0, 0, -1])
})
