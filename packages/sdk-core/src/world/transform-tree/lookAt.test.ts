// lookAtNode under a parent: its world z lies on the line of sight and its y follows up, whether the
// parent mirrors (negative determinant) or not.
import test from 'node:test'
import assert from 'node:assert/strict'
import { determinantMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { normalizeQuaternion } from '../../../../math/src/quaternion/quaternion.ts'
import { subtract, unit } from '../../../../math/src/vector/vectorTuple.ts'
import {
  addTransformNode,
  createTransformTree,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
} from './transformTree.ts'
import { updateNodeMatrixWorld } from './update.ts'
import { lookAtNode } from './lookAt.ts'

/** A parent placed by `(position, unit quaternion, scale)` with two children at `local`. */
function scene(position: number[], turn: ArrayLike<number>, scale: number[], local: number[]) {
  const tree = createTransformTree(4)
  const parent = addTransformNode(tree)
  const a = addTransformNode(tree, parent)
  const b = addTransformNode(tree, parent)
  setNodePosition(tree, parent, position[0], position[1], position[2])
  setNodeQuaternion(tree, parent, turn[0], turn[1], turn[2], turn[3])
  setNodeScale(tree, parent, scale[0], scale[1], scale[2])
  for (const node of [a, b]) setNodePosition(tree, node, local[0], local[1], local[2])
  updateNodeMatrixWorld(tree, parent, true)
  return { tree, parent, a, b }
}

const TURN = normalizeQuaternion(Float64Array.of(0.3, -0.5, 0.2, 0.8))

test('lookAt under a mirrored or proper parent: world z on the line of sight, y toward up, both modes', () => {
  const up = [0, 1, 0]
  const target = [4, 9, -6]
  for (const scale of [
    [-1.5, 1.5, 1.5],
    [1.5, -1.5, 1.5],
    [1.5, 1.5, -1.5],
    [1.5, 1.5, 1.5],
    [-1.5, -1.5, 1.5],
  ]) {
    for (const viewer of [false, true]) {
      const { tree, parent, a } = scene([3, -2, 1], TURN, scale, [0.5, -1, 2])
      const mirrored = determinantMatrix4(tree.worldViews[parent]) < 0
      assert.equal(mirrored, scale[0] * scale[1] * scale[2] < 0)
      lookAtNode(tree, a, target[0], target[1], target[2], up, viewer)
      updateNodeMatrixWorld(tree, parent, true)
      const w = tree.worldViews[a]
      const eye = [w[12], w[13], w[14]]
      const sight = unit(viewer ? subtract(eye, target) : subtract(target, eye))
      const z = unit([w[8], w[9], w[10]])
      const label = `scale ${scale}, viewer ${viewer}`
      for (let i = 0; i < 3; i++)
        assert.ok(Math.abs(z[i] - sight[i]) <= 1e-12, `${label}: z[${i}] ${z[i]} vs ${sight[i]}`)
      assert.ok(w[4] * up[0] + w[5] * up[1] + w[6] * up[2] > 0, `${label}: y toward up`)
    }
  }
})
