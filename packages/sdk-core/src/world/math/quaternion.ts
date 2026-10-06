import {
  axisAngleQuaternion,
  multiplyQuaternion,
  normalizeQuaternion,
  localTurnQuaternion,
  slerpQuaternion,
} from '../../math/matrix/quaternion.ts'
import { writeRotationQuaternion } from '../../math/matrix/matrix4Trs.ts'
import { ObservedComponents } from './observed.ts'
import type { EulerLike, XYZLike as V, XYZWLike as Q } from './likes.ts'
import { hypot3, hypot4 } from '../../math/primitives/hypot.ts'

const other = new Float64Array(4),
  axis = new Float64Array(3),
  turn = new Float64Array(4),
  rows = new Float64Array(9)
const load = (into: Float64Array, q: Q) => {
  into[0] = q.x
  into[1] = q.y
  into[2] = q.z
  into[3] = q.w
  return into
}

/** A rotation as a unit quaternion over `math/matrix/quaternion.ts`. Written components notify the owner. */
export class Quaternion extends ObservedComponents {
  /** Always `true`: tells a quaternion apart from anything else. */
  readonly isQuaternion = true as const

  constructor(x = 0, y = 0, z = 0, w = 1) {
    super(new Float64Array([x, y, z, w]))
  }
  /** The fourth number: how little the rotation turns. */
  get w() {
    return this.elements[3]
  }
  set w(value: number) {
    this.elements[3] = value
    this._changed()
  }
  /** Writes the four numbers; `quiet` skips the notification, for an owner syncing its twin, and
   *  a write that changes none of them tells nobody. */
  set(x: number, y: number, z: number, w: number, quiet = false) {
    const e = this.elements
    if (e[0] === x && e[1] === y && e[2] === z && e[3] === w) return this
    this.elements[0] = x
    this.elements[1] = y
    this.elements[2] = z
    this.elements[3] = w
    return quiet ? this : this._changed()
  }
  private written(from: ArrayLike<number>, quiet = false) {
    return this.set(from[0], from[1], from[2], from[3], quiet)
  }
  /** Takes the numbers of another quaternion. */
  copy(q: Q) {
    return this.set(q.x, q.y, q.z, q.w)
  }
  /** A new quaternion with the same numbers. */
  clone() {
    return new Quaternion(this.x, this.y, this.z, this.w)
  }
  /** Resets to no rotation at all. */
  identity() {
    return this.set(0, 0, 0, 1)
  }
  /** Becomes a turn of `angle` radians around the axis `v`. */
  setFromAxisAngle(v: V, angle: number) {
    const n = hypot3(v.x, v.y, v.z) || 1
    axis[0] = v.x / n
    axis[1] = v.y / n
    axis[2] = v.z / n
    return this.written(axisAngleQuaternion(other, axis, angle))
  }
  /** The rotation of three Euler angles, in the order they name (`localTurnQuaternion`). */
  setFromEuler(e: EulerLike, quiet = false) {
    return this.written(localTurnQuaternion(other, e.x, e.y, e.z, e.order), quiet)
  }
  /** From the upper 3×3 of a column-major matrix whose columns are unit length. */
  setFromRotationMatrix(m: { elements: ArrayLike<number> }) {
    const e = m.elements
    for (let row = 0; row < 3; row++) {
      rows[row * 3] = e[row]
      rows[row * 3 + 1] = e[row + 4]
      rows[row * 3 + 2] = e[row + 8]
    }
    writeRotationQuaternion(other, rows)
    return this.written(other)
  }
  /** The shortest rotation taking unit vector `a` onto unit vector `b`. */
  setFromUnitVectors(a: V, b: V) {
    const r = a.x * b.x + a.y * b.y + a.z * b.z + 1
    if (r < 1e-8)
      return Math.abs(a.x) > Math.abs(a.z)
        ? this.set(-a.y, a.x, 0, 0).normalize()
        : this.set(0, -a.z, a.y, 0).normalize()
    return this.set(
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x,
      r,
    ).normalize()
  }
  /** Adds the turn `q` after this one. */
  multiply(q: Q) {
    return this.written(multiplyQuaternion(other, this.elements, load(turn, q)))
  }
  /** Adds the turn `q` before this one. */
  premultiply(q: Q) {
    return this.written(multiplyQuaternion(other, load(turn, q), this.elements))
  }
  /** Becomes `a` followed by `b`. */
  multiplyQuaternions(a: Q, b: Q) {
    return this.written(multiplyQuaternion(other, load(other, a), load(turn, b)))
  }
  /** Becomes the turn that undoes this one. */
  invert() {
    return this.set(-this.x, -this.y, -this.z, this.w)
  }
  /** Flips the axis part: the opposite turn for a unit quaternion. */
  conjugate() {
    return this.invert()
  }
  /** How much two rotations agree, from −1 to 1. */
  dot(q: Q) {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w
  }
  /** The size of the four numbers together. */
  length() {
    return hypot4(this.x, this.y, this.z, this.w)
  }
  /** Scales the numbers to size 1, a pure rotation. */
  normalize() {
    other.set(this.elements)
    return this.written(normalizeQuaternion(other))
  }
  /** The angle between two rotations, in radians. */
  angleTo(q: Q) {
    return 2 * Math.acos(Math.min(1, Math.abs(this.dot(q))))
  }
  /** Spherical interpolation towards `q`, along the shorter arc. */
  slerp(q: Q, t: number) {
    const line = slerpQuaternion(other, this.elements, 0, load(turn, q), 0, t)
    this.written(other)
    return line ? this.normalize() : this
  }
  /** Whether two quaternions hold the same numbers. */
  equals(q: Q) {
    return this.x === q.x && this.y === q.y && this.z === q.z && this.w === q.w
  }
  /** Reads four numbers from a list. */
  fromArray(array: ArrayLike<number>, offset = 0) {
    return this.set(array[offset], array[offset + 1], array[offset + 2], array[offset + 3])
  }
  /** The four numbers as a list. */
  toArray(): [number, number, number, number] {
    return [this.x, this.y, this.z, this.w]
  }
}
