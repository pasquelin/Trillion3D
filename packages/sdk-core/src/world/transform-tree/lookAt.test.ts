// lookAtNode under a parent: the node's world z lies on the line of sight and its y follows up,
// whether the parent mirrors (negative determinant) or not; and for proper parents, eyes, targets
// and ups the world matrix it composes rounds to the same f32 terms as the former inline formulas:
// the aim basis (normalise, `up × z`, `z × x`), the parent's normalised columns (one reciprocal of
// the root, three products) and the product with the conjugate (`multiplyQuaternion`, its sums in
// the order written below) are the same operations in the same order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { determinantMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { writeRotationQuaternion } from '../../../../math/src/matrix/matrix4Trs.ts'
import { halton } from '../../../../math/src/sequence/halton.ts'
import {
  addTransformNode,
  createTransformTree,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
} from './transformTree.ts'
import { updateNodeMatrixWorld } from './update.ts'
import { lookAtNode } from './lookAt.ts'

/** The former `aimQuaternion` of lookAt.ts, its expressions as they were: the sweep's oracle. */
function formerAim(
  out: Float64Array,
  world: ArrayLike<number>,
  tx: number,
  ty: number,
  tz: number,
  up: ArrayLike<number>,
  viewer: boolean,
  parentWorld: ArrayLike<number>,
) {
  const basis = new Float64Array(9)
  const [ux, uy, uz] = [up[0], up[1], up[2]]
  const [ex, ey, ez] = [world[12], world[13], world[14]]
  let fx = viewer ? ex - tx : tx - ex,
    fy = viewer ? ey - ty : ty - ey,
    fz = viewer ? ez - tz : tz - ez
  let lengthSq = fx * fx + fy * fy + fz * fz
  let k: number
  if (lengthSq === 0) fz = 1
  else {
    k = 1 / (Math.sqrt(lengthSq) || 1)
    fx *= k
    fy *= k
    fz *= k
  }
  let rx = uy * fz - uz * fy,
    ry = uz * fx - ux * fz,
    rz = ux * fy - uy * fx
  lengthSq = rx * rx + ry * ry + rz * rz
  if (lengthSq === 0) {
    if (Math.abs(uz) === 1) fx += 0.0001
    else fz += 0.0001
    k = 1 / (Math.sqrt(fx * fx + fy * fy + fz * fz) || 1)
    fx *= k
    fy *= k
    fz *= k
    rx = uy * fz - uz * fy
    ry = uz * fx - ux * fz
    rz = ux * fy - uy * fx
    lengthSq = rx * rx + ry * ry + rz * rz
  }
  k = 1 / (Math.sqrt(lengthSq) || 1)
  rx *= k
  ry *= k
  rz *= k
  basis.set([rx, fy * rz - fz * ry, fx, ry, fz * rx - fx * rz, fy, rz, fx * ry - fy * rx, fz])
  writeRotationQuaternion(out, basis)
  for (let column = 0; column < 3; column++) {
    const at = column * 4
    const [cx, cy, cz] = [parentWorld[at], parentWorld[at + 1], parentWorld[at + 2]]
    const c = 1 / Math.sqrt(cx * cx + cy * cy + cz * cz)
    basis[column] = cx * c
    basis[3 + column] = cy * c
    basis[6 + column] = cz * c
  }
  const p = new Float64Array(4)
  writeRotationQuaternion(p, basis)
  const [cx, cy, cz, cw] = [-p[0], -p[1], -p[2], p[3]]
  const [qx, qy, qz, qw] = out
  out[0] = cx * qw + cw * qx + cy * qz - cz * qy
  out[1] = cy * qw + cw * qy + cz * qx - cx * qz
  out[2] = cz * qw + cw * qz + cx * qy - cy * qx
  out[3] = cw * qw - cx * qx - cy * qy - cz * qz
  return out
}

/** A parent placed by `(position, unit quaternion, scale)` with two children at `local`. */
function scene(position: number[], turn: number[], scale: number[], local: number[]) {
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

const unit = (v: number[]) => v.map((x) => x / Math.hypot(...v))
const TURN = unit([0.3, -0.5, 0.2, 0.8])

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
      const sight = unit(target.map((t, i) => (viewer ? eye[i] - t : t - eye[i])))
      const z = unit([w[8], w[9], w[10]])
      const label = `scale ${scale}, viewer ${viewer}`
      for (let i = 0; i < 3; i++)
        assert.ok(Math.abs(z[i] - sight[i]) <= 1e-12, `${label}: z[${i}] ${z[i]} vs ${sight[i]}`)
      assert.ok(w[4] * up[0] + w[5] * up[1] + w[6] * up[2] > 0, `${label}: y toward up`)
    }
  }
})

test('lookAt under proper parents: the composed world matrix rounds to the same f32 terms as the former formulas (4096 Halton points and edges)', () => {
  const N = 4096
  const at = (i: number, base: number, shift: number, lo: number, hi: number) =>
    lo + (hi - lo) * halton(i + shift * N, base)
  type Case = { position: number[]; turn: number[]; scale: number[]; local: number[] }
  type Aim = { target: number[]; up: number[]; viewer: boolean }
  const cases: [Case, Aim][] = []
  for (let i = 1; i <= N; i++) {
    const turn = unit([2, 3, 5, 7].map((base) => at(i, base, 0, -1, 1)))
    const position = [2, 3, 5].map((base) => at(i, base, 1, -10, 10))
    const scale = [3, 5, 7].map((base) => at(i, base, 2, 0.25, 4))
    if (i % 3 === 0) scale.fill(scale[0])
    const local = [5, 7, 2].map((base) => at(i, base, 3, -5, 5))
    const target = [7, 2, 3].map((base) => at(i, base, 4, -10, 10))
    const up = i % 2 ? [0, 1, 0] : unit([2, 3, 5].map((base) => at(i, base, 5, -1, 1)))
    cases.push([
      { position, turn, scale, local },
      { target, up, viewer: i % 4 < 2 },
    ])
  }
  // Edges: identity and zero-scale parents, ±0, the eye on the target, the line of sight along up
  // (both nudges: up on z and elsewhere).
  const identity: Case = {
    position: [0, 0, 0],
    turn: [0, 0, 0, 1],
    scale: [1, 1, 1],
    local: [-0, 0, -0],
  }
  const flat: Case = { ...identity, scale: [0, 1, 1], local: [1, 2, 3] }
  const turned: Case = { position: [1, -2, 3], turn: TURN, scale: [2, 2, 2], local: [0, 0, 0] }
  for (const base of [identity, flat, turned])
    for (const viewer of [false, true]) {
      cases.push([base, { target: [0, 0, 0], up: [0, 1, 0], viewer }])
      cases.push([base, { target: [1, 2, 3], up: [0, 1, 0], viewer }])
      cases.push([base, { target: [1, 7, 3], up: [0, 1, 0], viewer }])
      cases.push([base, { target: [0, -5, 0], up: [0, 1, 0], viewer }])
      cases.push([base, { target: [0, 0, 5], up: [0, 0, 1], viewer }])
      cases.push([base, { target: [0, 0, -5], up: [0, 0, -1], viewer }])
      cases.push([base, { target: [-0, 4, -0], up: [-0, 1, 0], viewer }])
    }
  const former = new Float64Array(4)
  for (const [{ position, turn, scale, local }, { target, up, viewer }] of cases) {
    const { tree, parent, a, b } = scene(position, turn, scale, local)
    assert.ok(!(determinantMatrix4(tree.worldViews[parent]) < 0))
    formerAim(
      former,
      tree.worldViews[b],
      target[0],
      target[1],
      target[2],
      up,
      viewer,
      tree.worldViews[parent],
    )
    setNodeQuaternion(tree, b, former[0], former[1], former[2], former[3])
    lookAtNode(tree, a, target[0], target[1], target[2], up, viewer)
    updateNodeMatrixWorld(tree, parent, true)
    const now = tree.worldViews[a],
      then = tree.worldViews[b]
    for (let j = 0; j < 16; j++)
      assert.ok(
        Object.is(Math.fround(now[j]), Math.fround(then[j])),
        `term ${j}: ${now[j]} vs ${then[j]} (${JSON.stringify({ position, turn, scale, local, target, up, viewer })})`,
      )
  }
})
