import { writeRotationQuaternion } from '../matrix/matrix4Trs.ts'
import { setNodeQuaternion, type TransformTree } from './transformTree.ts'
import { updateNodeWorldMatrix } from './update.ts'

/**
 * Aiming a hierarchy node at a world point. The node's world rotation becomes the orthonormal
 * basis whose `z` axis lies on the line of sight, with `x = up × z` and `y = z × x`; its local
 * rotation then removes the parent's world rotation, a unit quaternion whose inverse is its
 * conjugate. Two aims have no line of sight or no `x`, and each keeps a defined answer: the eye on
 * the target takes `z = (0, 0, 1)`; a line of sight along `up` moves `z` by `0.0001` off the up
 * axis, renormalises it, and crosses again. A parent with non-uniform or sheared scale is not
 * compensated exactly: its rotation is read from its normalised columns.
 */

/** The basis being built, stored by row as `writeRotationQuaternion` reads it; then the parent's
 *  normalised columns. One buffer each, written and read within one call. */
const basis = new Float64Array(9),
  aim = new Float64Array(4),
  parentTurn = new Float64Array(4)

/** Writes into `basis` the rotation that aims the node at `(tx, ty, tz)` from the eye `world`
 *  carries in its translation. Scalars throughout: `up` is read once. */
function writeAimBasis(
  world: ArrayLike<number>,
  tx: number,
  ty: number,
  tz: number,
  up: ArrayLike<number>,
  viewer: boolean,
) {
  const ux = up[0],
    uy = up[1],
    uz = up[2]
  const ex = world[12],
    ey = world[13],
    ez = world[14]
  // A camera or a light looks down its −z, so `z` runs from the target to the eye; an object
  // presents its +z, so `z` runs from the eye to the target.
  let fx: number, fy: number, fz: number
  if (viewer) {
    fx = ex - tx
    fy = ey - ty
    fz = ez - tz
  } else {
    fx = tx - ex
    fy = ty - ey
    fz = tz - ez
  }
  // The squared length serves twice: the zero test, then the normalisation.
  let lengthSq = fx * fx + fy * fy + fz * fz
  let k: number
  // A zero sum means the squares are zero or underflowed: `(fx, fy, 1)` then has length exactly 1 in a
  // double, already unit.
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
  // Columns x, y = z × x, z; `y` is unit already, the cross product of two orthonormal axes.
  basis[0] = rx
  basis[1] = fy * rz - fz * ry
  basis[2] = fx
  basis[3] = ry
  basis[4] = fz * rx - fx * rz
  basis[5] = fy
  basis[6] = rz
  basis[7] = fx * ry - fy * rx
  basis[8] = fz
}

/** Writes into `basis` the rotation of the world matrix `world`: each of its three columns divided
 *  by its length, by one division and three products. */
function writeColumnRotation(world: ArrayLike<number>) {
  for (let column = 0; column < 3; column++) {
    const at = column * 4
    const cx = world[at],
      cy = world[at + 1],
      cz = world[at + 2]
    const k = 1 / Math.sqrt(cx * cx + cy * cy + cz * cz)
    basis[column] = cx * k
    basis[3 + column] = cy * k
    basis[6 + column] = cz * k
  }
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
  writeColumnRotation(parentWorld)
  writeRotationQuaternion(parentTurn, basis)
  // local = c ⊗ q, with c = conj(p) = (−p.xyz, p.w) the parent's inverse rotation. The vector
  // part of the product is c.xyz·q.w + c.w·q.xyz + c.xyz × q.xyz, its scalar c.w·q.w − c.xyz·q.xyz.
  // The conjugate is negated once, as a value: a NaN keeps the sign that negation gives it.
  const cx = -parentTurn[0],
    cy = -parentTurn[1],
    cz = -parentTurn[2],
    cw = parentTurn[3]
  const qx = out[0],
    qy = out[1],
    qz = out[2],
    qw = out[3]
  out[0] = cx * qw + cw * qx + cy * qz - cz * qy
  out[1] = cy * qw + cw * qy + cz * qx - cx * qz
  out[2] = cz * qw + cw * qz + cx * qy - cy * qx
  out[3] = cw * qw - cx * qx - cy * qy - cz * qz
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
