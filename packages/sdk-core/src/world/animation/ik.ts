import {
  axisAngleQuaternion,
  multiplyQuaternion,
  normalizeQuaternion,
} from '../../../../math/src/quaternion/quaternion.ts'
import { hypot3 } from '../../../../math/src/float/hypot.ts'
import { crossVector3, dotVector3, subVector3 } from '../../../../math/src/vector/vector.ts'
import { Quaternion } from '../math/quaternion.ts'
import { Vector3 } from '../math/vector3.ts'
import type { Object3D } from '../object/object3d.ts'

import type { XYZLike } from '../math/likes.ts'

const scratch = {
  a: new Float64Array(3),
  b: new Float64Array(3),
  c: new Float64Array(3),
  t: new Float64Array(3),
  ab: new Float64Array(3),
  cb: new Float64Array(3),
  ac: new Float64Array(3),
  at: new Float64Array(3),
  ba: new Float64Array(3),
  toPole: new Float64Array(3),
  across: new Float64Array(3),
  plane: new Float64Array(3),
  axis: new Float64Array(3),
  q: new Float64Array(4),
  turn: new Float64Array(4),
  global: new Float64Array(4),
  inverse: new Float64Array(4),
  local: new Float64Array(4),
  point: new Vector3(),
  world: new Quaternion(),
  keptRoot: new Quaternion(),
  keptMid: new Quaternion(),
}
const X = [1, 0, 0],
  Y = [0, 1, 0]
const length = (v: ArrayLike<number>) => hypot3(v[0], v[1], v[2])
const clampedAcos = (x: number) => Math.acos(Math.min(1, Math.max(-1, x)))
const angle = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  clampedAcos(dotVector3(a, b) / (length(a) * length(b) || 1))
/** Some axis across `v`: `v × x`, or `v × y` when `v` runs nearly along x. */
const across = (out: Float64Array, v: ArrayLike<number>) =>
  crossVector3(out, v, Math.abs(v[0]) < 0.9 * length(v) ? X : Y)

/** Writes a node's world position into `out`. */
function worldPoint(node: Object3D, out: Float64Array) {
  const p = node.getWorldPosition(scratch.point)
  out[0] = p.x
  out[1] = p.y
  out[2] = p.z
  return out
}

/** Turns `node` by the world rotation `turn` (axis, angle), its local pose rewritten: the turn is
 *  brought into its frame, `local · global⁻¹ · turn · global`. World reads bring the matrices
 *  they need up to date; the solve settles the subtree once, at its end. */
function turnInWorld(node: Object3D, axis: ArrayLike<number>, radians: number) {
  const { q, turn, global, inverse, local } = scratch,
    n = length(axis)
  if (!(n > 0) || !radians) return
  const unit = scratch.axis
  unit[0] = axis[0] / n
  unit[1] = axis[1] / n
  unit[2] = axis[2] / n
  axisAngleQuaternion(turn, unit, radians)
  const g = node.getWorldQuaternion(scratch.world)
  global[0] = g.x
  global[1] = g.y
  global[2] = g.z
  global[3] = g.w
  inverse[0] = -g.x
  inverse[1] = -g.y
  inverse[2] = -g.z
  inverse[3] = g.w
  multiplyQuaternion(q, inverse, turn)
  multiplyQuaternion(q, q, global)
  const l = node.quaternion
  local[0] = l.x
  local[1] = l.y
  local[2] = l.z
  local[3] = l.w
  multiplyQuaternion(q, local, q)
  normalizeQuaternion(q)
  node.quaternion.set(q[0], q[1], q[2], q[3])
}

/** Turns `root` about `axis` by the angle from the plane normal `bent` to the normal `toward`,
 *  both across `axis`: the chain's bend is rolled into the plane `toward` is normal to. */
function rollOnto(root: Object3D, axis: Float64Array, bent: Float64Array, toward: Float64Array) {
  const side = scratch.across
  const roll = Math.atan2(
    dotVector3(axis, crossVector3(side, bent, toward)) / length(axis),
    dotVector3(bent, toward),
  )
  turnInWorld(root, axis, roll)
}

/**
 * A two-bone chain — `root`, `mid`, and `end` hanging from `mid` — bent so that `end` reaches
 * `target`, or as near as the two bones reach, by the law of cosines: `root` and `mid` turn in the
 * plane the chain makes with `pole` (its current bend when none is given), then the whole chain
 * swings onto the target. `weight` blends from the pose it had to the solved one. Only the two
 * rotations are written; a mixer that plays after it writes over them, so it runs after the clips.
 */
export function solveTwoBoneIK(
  root: Object3D,
  mid: Object3D,
  end: Object3D,
  target: XYZLike,
  pole?: XYZLike,
  weight = 1,
) {
  const { a, b, c, t, ab, cb, ac, at, ba, toPole, plane } = scratch
  root.updateMatrixWorld(true)
  // Only a partial solve blends back to the pose it had.
  const partial = !(weight >= 1)
  if (partial) {
    scratch.keptRoot.copy(root.quaternion)
    scratch.keptMid.copy(mid.quaternion)
  }
  worldPoint(root, a)
  worldPoint(mid, b)
  worldPoint(end, c)
  t[0] = target.x
  t[1] = target.y
  t[2] = target.z
  subVector3(ab, b, a)
  subVector3(cb, c, b)
  subVector3(ac, c, a)
  subVector3(at, t, a)
  const lab = length(ab),
    lcb = length(cb),
    lat = Math.min(Math.max(length(at), 1e-6), (lab + lcb) * (1 - 1e-6))
  const bend0 = angle(ac, ab),
    knee0 = angle(subVector3(ba, a, b), cb),
    bend1 = clampedAcos((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)),
    knee1 = clampedAcos((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb))
  if (pole) {
    toPole[0] = pole.x - a[0]
    toPole[1] = pole.y - a[1]
    toPole[2] = pole.z - a[2]
  }
  // A fully folded chain has no root-to-end direction; its first bone still defines one.
  const direction = length(ac) ? ac : ab,
    tiny = 1e-9 * lab * lcb
  // A straight chain has no bend of its own: it bends toward the target, or across it.
  crossVector3(plane, direction, pole ? toPole : ab)
  if (!(length(plane) > tiny)) crossVector3(plane, direction, at)
  if (!(length(plane) > tiny)) across(plane, direction)
  // Bring an existing bend into the pole's plane before changing its angle.
  if (pole && length(ac) && length(crossVector3(ba, ac, ab)) > tiny) rollOnto(root, ac, ba, plane)
  turnInWorld(root, plane, bend1 - bend0)
  turnInWorld(mid, plane, knee1 - knee0)
  worldPoint(end, c)
  subVector3(ac, c, a)
  crossVector3(plane, ac, at)
  // Opposite collinear directions need a half-turn: about the bend's own normal, which keeps both
  // bones in their plane, or about any perpendicular axis when the chain is straight.
  if (!(length(plane) > 1e-9 * length(ac) * length(at)) && dotVector3(ac, at) < 0) {
    crossVector3(plane, ac, subVector3(ab, worldPoint(mid, b), a))
    if (!(length(plane) > tiny)) across(plane, ac)
  }
  turnInWorld(root, plane, angle(ac, at))
  // Align the solved elbow with the pole around the target axis, preserving the endpoint.
  if (pole && length(at)) {
    worldPoint(mid, b)
    crossVector3(ba, at, subVector3(ab, b, a))
    crossVector3(plane, at, toPole)
    if (length(ba) && length(plane)) rollOnto(root, at, ba, plane)
  }
  if (partial) {
    root.quaternion.slerp(scratch.keptRoot, 1 - Math.max(0, weight))
    mid.quaternion.slerp(scratch.keptMid, 1 - Math.max(0, weight))
  }
  // The subtree's world matrices, settled once for whoever reads them after.
  root.updateMatrixWorld(true)
}
