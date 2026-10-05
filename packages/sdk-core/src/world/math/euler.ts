import { composeMatrix4At } from '../../math/matrix/matrix4Compose.ts';
import { Observed } from './observed.ts';
import type { XYZWLike as Q } from './likes.ts';

const clamp = (v: number) => Math.min(1, Math.max(-1, v));
/**
 * Beyond this the middle angle is at its pole and the outer two share one degree of freedom.
 * Declared: the sine of the pitch past which the rotation matrix is treated as gimbal-locked;
 * 0.9999999 leaves about 4e-4 rad of pitch to the pole, far above float64 rounding, so a matrix
 * just under it still resolves its outer angles; a lower value locks earlier and loses their
 * precision.
 */
const POLE = 0.9999999;
const rotation = new Float64Array(16),
  turn = new Float64Array(4),
  ORIGIN = [0, 0, 0],
  UNIT = [1, 1, 1];

/** Three angles in radians, applied in `order` (intrinsic, the first letter outermost). */
export class Euler extends Observed {
  /** Always `true`: tells a set of angles apart from anything else. */
  readonly isEuler = true as const;
  private _x: number;
  private _y: number;
  private _z: number;
  private _order: string;
  /** The quaternion the angles follow (`_follow`), or `null`; `_seen` is the one they were read
   *  from. */
  private _source: Q | null = null;
  private readonly _seen = new Float64Array(4);

  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    super();
    this._x = x;
    this._y = y;
    this._z = z;
    this._order = order;
  }
  /** The turn around the x axis, in radians. */
  get x() {
    if (this._source) this.resolve();
    return this._x;
  }
  set x(value: number) {
    if (this._source) this.resolve();
    this._x = value;
    this._changed();
  }
  /** The turn around the y axis, in radians. */
  get y() {
    if (this._source) this.resolve();
    return this._y;
  }
  set y(value: number) {
    if (this._source) this.resolve();
    this._y = value;
    this._changed();
  }
  /** The turn around the z axis, in radians. */
  get z() {
    if (this._source) this.resolve();
    return this._z;
  }
  set z(value: number) {
    if (this._source) this.resolve();
    this._z = value;
    this._changed();
  }
  /** The order the three turns apply in, such as `'XYZ'`. */
  get order() {
    return this._order;
  }
  set order(value: string) {
    if (this._source) this.resolve();
    this._order = value;
    this._changed();
  }
  /** Writes the angles; `quiet` skips the notification, for an owner syncing its twin. */
  set(x: number, y: number, z: number, order = this._order, quiet = false) {
    // The written angles are the quaternion's as it stands: never derived again over the write.
    if (this._source) this._follow(this._source);
    this._x = x;
    this._y = y;
    this._z = z;
    this._order = order;
    return quiet ? this : this._changed();
  }
  /** Takes the angles and order of another set. */
  copy(e: { x: number; y: number; z: number; order: string }) {
    return this.set(e.x, e.y, e.z, e.order);
  }
  /** A new set with the same angles and order. */
  clone() {
    return new Euler(this.x, this.y, this.z, this._order);
  }
  /** The angles of a column-major rotation matrix, in this order. */
  setFromRotationMatrix(m: { elements: ArrayLike<number> }, order = this._order, quiet = false) {
    return this.fromElements(m.elements, order, quiet);
  }
  /** The three angles that make the same turn as a quaternion. */
  setFromQuaternion(q: Q, order = this._order, quiet = false) {
    turn[0] = q.x;
    turn[1] = q.y;
    turn[2] = q.z;
    turn[3] = q.w;
    composeMatrix4At(rotation, 0, ORIGIN, 0, turn, 0, UNIT, 0);
    return this.fromElements(rotation, order, quiet);
  }
  /** The angles of the rotation in the upper 3×3 of the column-major `e`, read in place. */
  private fromElements(e: ArrayLike<number>, order: string, quiet: boolean) {
    const m11 = e[0],
      m12 = e[4],
      m13 = e[8],
      m21 = e[1],
      m22 = e[5],
      m23 = e[9],
      m31 = e[2],
      m32 = e[6],
      m33 = e[10];
    let x = 0,
      y = 0,
      z = 0;
    switch (order) {
      case 'YXZ':
        x = Math.asin(-clamp(m23));
        if (Math.abs(m23) < POLE) {
          y = Math.atan2(m13, m33);
          z = Math.atan2(m21, m22);
        } else y = Math.atan2(-m31, m11);
        break;
      case 'ZXY':
        x = Math.asin(clamp(m32));
        if (Math.abs(m32) < POLE) {
          y = Math.atan2(-m31, m33);
          z = Math.atan2(-m12, m22);
        } else z = Math.atan2(m21, m11);
        break;
      case 'ZYX':
        y = Math.asin(-clamp(m31));
        if (Math.abs(m31) < POLE) {
          x = Math.atan2(m32, m33);
          z = Math.atan2(m21, m11);
        } else z = Math.atan2(-m12, m22);
        break;
      case 'YZX':
        z = Math.asin(clamp(m21));
        if (Math.abs(m21) < POLE) {
          x = Math.atan2(-m23, m22);
          y = Math.atan2(-m31, m11);
        } else y = Math.atan2(m13, m33);
        break;
      case 'XZY':
        z = Math.asin(-clamp(m12));
        if (Math.abs(m12) < POLE) {
          x = Math.atan2(m32, m22);
          y = Math.atan2(m13, m11);
        } else x = Math.atan2(-m23, m33);
        break;
      default:
        y = Math.asin(clamp(m13));
        if (Math.abs(m13) < POLE) {
          x = Math.atan2(-m23, m33);
          z = Math.atan2(-m12, m11);
        } else x = Math.atan2(m32, m22);
    }
    return this.set(x, y, z, order, quiet);
  }
  /** The three angles and the order, as a list. */
  toArray(): [number, number, number, string] {
    return [this.x, this.y, this.z, this._order];
  }
  /**
   * The angles follow `q` from now on, the current ones taken as `q`'s as it stands: they are
   * derived again, quietly, when read after `q` changed. A node's owner writes its quaternion
   * alone, thousands a frame for the physics, and pays for the angles the page reads, not all.
   */
  _follow(q: Q) {
    const seen = this._seen;
    this._source = q;
    seen[0] = q.x;
    seen[1] = q.y;
    seen[2] = q.z;
    seen[3] = q.w;
  }
  private resolve() {
    const q = this._source!,
      seen = this._seen;
    if (q.x === seen[0] && q.y === seen[1] && q.z === seen[2] && q.w === seen[3]) return;
    this._follow(q);
    this.setFromQuaternion(q, this._order, true);
  }
}
