import {
  decomposeMatrix4,
  writeRotationQuaternion,
} from '../../../../math/src/matrix/matrix4Trs.ts'
import {
  conjugateQuaternion,
  multiplyQuaternionVectorFirst,
} from '../../../../math/src/quaternion/quaternion.ts'
import {
  crossVector3,
  lengthSqVector3,
  normalizeVector3,
} from '../../../../math/src/vector/vector.ts'
import { setNodeQuaternion, type TransformTree } from './transformTree.ts'
import { updateNodeWorldMatrix } from './update.ts'

/**
 * Aiming a hierarchy node at a world point. The node's world rotation becomes the orthonormal
 * basis whose `z` axis lies on the line of sight, with `x = up × z` and `y = z × x`; its local
 * rotation then removes the parent's world rotation, a unit quaternion whose inverse is its
 * conjugate. Two aims have no line of sight or no `x`, and each keeps a defined answer: the eye on
 * the target takes `z = (0, 0, 1)`; a line of sight along `up` moves `z` by `0.0001` off the up
 * axis, renormalises it, and crosses again. The parent's rotation and scale are those of
 * `decomposeMatrix4`: a parent of negative determinant carries its mirror on `x`, and the node's
 * world `z` and `y` still follow the aim, its `x` mirrored. A parent with non-uniform or sheared
 * scale is not compensated exactly: its rotation is read from its normalised columns.
 */

/** The basis being built, stored by row as `writeRotationQuaternion` reads it, and its three axes;
 *  then the parent's decomposition. One buffer each, written and read within one call; pure, so a
 *  bundle that never aims a node drops them. */
const basis = /* @__PURE__ */ new Float64Array(9),
  forward = /* @__PURE__ */ new Float64Array(3),
  right = /* @__PURE__ */ new Float64Array(3),
  above = /* @__PURE__ */ new Float64Array(3),
  aim = /* @__PURE__ */ new Float64Array(4),
  parentPosition = /* @__PURE__ */ new Float64Array(3),
  parentTurn = /* @__PURE__ */ new Float64Array(4),
  parentScale = /* @__PURE__ */ new Float64Array(3)

/** Writes into `basis` the rotation that aims the node at `(tx, ty, tz)` from the eye `world`
 *  carries in its translation. */
function writeAimBasis(
  world: ArrayLike<number>,
  tx: number,
  ty: number,
  tz: number,
  up: ArrayLike<number>,
  viewer: boolean,
) {
  // A camera or a light looks down its −z, so `z` runs from the target to the eye; an object
  // presents its +z, so `z` runs from the eye to the target.
  if (viewer) {
    forward[0] = world[12] - tx
    forward[1] = world[13] - ty
    forward[2] = world[14] - tz
  } else {
    forward[0] = tx - world[12]
    forward[1] = ty - world[13]
    forward[2] = tz - world[14]
  }
  // A zero sum means the squares are zero or underflowed: `(fx, fy, 1)` then has length exactly 1 in a
  // double, already unit.
  if (lengthSqVector3(forward) === 0) forward[2] = 1
  else normalizeVector3(forward)
  crossVector3(right, up, forward)
  if (lengthSqVector3(right) === 0) {
    if (Math.abs(up[2]) === 1) forward[0] += 0.0001
    else forward[2] += 0.0001
    normalizeVector3(forward)
    crossVector3(right, up, forward)
  }
  normalizeVector3(right)
  // Columns x, y = z × x, z; `y` is unit already, the cross product of two orthonormal axes.
  crossVector3(above, forward, right)
  basis[0] = right[0]
  basis[1] = above[0]
  basis[2] = forward[0]
  basis[3] = right[1]
  basis[4] = above[1]
  basis[5] = forward[1]
  basis[6] = right[2]
  basis[7] = above[2]
  basis[8] = forward[2]
}

/**
 * The local rotation that turns a node whose world matrix is `world` toward the world point
 * `(tx, ty, tz)`, written into `out` as `(x, y, z, w)`, the parent's rotation removed when
 * `parentWorld` is given. `viewer` and `up` are those of `lookAtNode`; the world matrices must
 * already be resolved.
 */
function aimQuaternion(
  out: Float64Array,
  world: ArrayLike<number>,
  tx: number,
  ty: number,
  tz: number,
  up: ArrayLike<number>,
  viewer: boolean,
  parentWorld: ArrayLike<number> | null,
) {
  writeAimBasis(world, tx, ty, tz, up, viewer)
  writeRotationQuaternion(out, basis)
  if (!parentWorld) return out
  decomposeMatrix4(parentWorld, parentPosition, parentTurn, parentScale)
  // The parent's linear part is `R·S`, its mirror on `x` alone: `S = |S|·D`, `D = diag(±1, 1, 1)`.
  // The local turn `D·R⁻¹·A·D` gives the world `R·S·D·R⁻¹·A·D = |S|·A·D` for a uniform `|S|`: the
  // aim `A` with its `x` mirrored. `R⁻¹` is the conjugate; conjugating a turn by the mirror `D`
  // keeps its `x` and `w` and negates its `y` and `z`, the axis being an axial vector. The local
  // turn is the product `c ⊗ q`, `c` the parent's conjugate and `q` the world aim.
  conjugateQuaternion(parentTurn, parentTurn)
  multiplyQuaternionVectorFirst(out, parentTurn, out)
  if (parentScale[0] < 0) {
    out[1] = -out[1]
    out[2] = -out[2]
  }
  return out
}

/**
 * Turns `node` toward the world point `(x, y, z)`. `viewer` is true for a camera or a light, which
 * look toward their `−z`, false for an object, which presents its `+z`. `up` is the node's up,
 * `(0, 1, 0)` by default. First updates the ancestors and the node.
 */
export function lookAtNode(
  tree: TransformTree,
  node: number,
  x: number,
  y: number,
  z: number,
  up: ArrayLike<number>,
  viewer: boolean,
) {
  updateNodeWorldMatrix(tree, node, true, false)
  const parent = tree.parent[node]
  aimQuaternion(
    aim,
    tree.worldViews[node],
    x,
    y,
    z,
    up,
    viewer,
    parent >= 0 ? tree.worldViews[parent] : null,
  )
  setNodeQuaternion(tree, node, aim[0], aim[1], aim[2], aim[3])
}
