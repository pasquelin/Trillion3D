import { composeMatrix4At } from '../../../../math/src/matrix/matrix4Compose.ts'
import { eulerFromRotationMatrix } from '../../../../math/src/matrix/euler.ts'
import { Observed } from '../observed.ts'
import type { XYZWLike as Q } from './likes.ts'

const rotation = new Float64Array(16),
  turn = new Float64Array(4),
  angles = new Float64Array(3),
  ORIGIN = [0, 0, 0],
  UNIT = [1, 1, 1]

/** Three angles in radians, applied in `order` (intrinsic, the first letter outermost). */
export class Euler extends Observed {
  /** Always `true`: tells a set of angles apart from anything else. */
  readonly isEuler = true as const
  private _x: number
  private _y: number
  private _z: number
  private _order: string
  /** The quaternion the angles follow (`_follow`), or `null`; `_seen` is the one they were read
   *  from. */
  private _source: Q | null = null
  private readonly _seen = new Float64Array(4)

  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    super()
    this._x = x
    this._y = y
    this._z = z
    this._order = order
  }
  /** The turn around the x axis, in radians. */
  get x() {
    if (this._source) this.resolve()
    return this._x
  }
  set x(value: number) {
    if (this._source) this.resolve()
    this._x = value
    this._changed()
  }
  /** The turn around the y axis, in radians. */
  get y() {
    if (this._source) this.resolve()
    return this._y
  }
  set y(value: number) {
    if (this._source) this.resolve()
    this._y = value
    this._changed()
  }
  /** The turn around the z axis, in radians. */
  get z() {
    if (this._source) this.resolve()
    return this._z
  }
  set z(value: number) {
    if (this._source) this.resolve()
    this._z = value
    this._changed()
  }
  /** The order the three turns apply in, such as `'XYZ'`. */
  get order() {
    return this._order
  }
  set order(value: string) {
    if (this._source) this.resolve()
    this._order = value
    this._changed()
  }
  /** Writes the angles; `quiet` skips the notification, for an owner syncing its twin. */
  set(x: number, y: number, z: number, order = this._order, quiet = false) {
    // The written angles are the quaternion's as it stands: never derived again over the write.
    if (this._source) this._follow(this._source)
    this._x = x
    this._y = y
    this._z = z
    this._order = order
    return quiet ? this : this._changed()
  }
  /** Takes the angles and order of another set. */
  copy(e: { x: number; y: number; z: number; order: string }) {
    return this.set(e.x, e.y, e.z, e.order)
  }
  /** A new set with the same angles and order. */
  clone() {
    return new Euler(this.x, this.y, this.z, this._order)
  }
  /** The angles of a column-major rotation matrix, in this order. */
  setFromRotationMatrix(m: { elements: ArrayLike<number> }, order = this._order, quiet = false) {
    return this.fromElements(m.elements, order, quiet)
  }
  /** The three angles that make the same turn as a quaternion. */
  setFromQuaternion(q: Q, order = this._order, quiet = false) {
    turn[0] = q.x
    turn[1] = q.y
    turn[2] = q.z
    turn[3] = q.w
    composeMatrix4At(rotation, 0, ORIGIN, 0, turn, 0, UNIT, 0)
    return this.fromElements(rotation, order, quiet)
  }
  /** The angles of the rotation in the upper 3×3 of the column-major `e`, read in place
   *  (`eulerFromRotationMatrix`). */
  private fromElements(e: ArrayLike<number>, order: string, quiet: boolean) {
    eulerFromRotationMatrix(angles, e, order)
    return this.set(angles[0], angles[1], angles[2], order, quiet)
  }
  /** The three angles and the order, as a list. */
  toArray(): [number, number, number, string] {
    return [this.x, this.y, this.z, this._order]
  }
  /**
   * The angles follow `q` from now on, the current ones taken as `q`'s as it stands: they are
   * derived again, quietly, when read after `q` changed. A node's owner writes its quaternion
   * alone, thousands a frame for the physics, and pays for the angles the page reads, not all.
   */
  _follow(q: Q) {
    const seen = this._seen
    this._source = q
    seen[0] = q.x
    seen[1] = q.y
    seen[2] = q.z
    seen[3] = q.w
  }
  private resolve() {
    const q = this._source!,
      seen = this._seen
    if (q.x === seen[0] && q.y === seen[1] && q.z === seen[2] && q.w === seen[3]) return
    this._follow(q)
    this.setFromQuaternion(q, this._order, true)
  }
}
