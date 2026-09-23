import { composeMatrix4 } from '../../math/matrix/matrix4Compose.ts';
import { Observed } from './observed.ts';
import type { XYZWLike as Q } from './likes.ts';

const clamp = (v: number) => Math.min(1, Math.max(-1, v));
/** Beyond this the middle angle is at its pole and the outer two share one degree of freedom. */
const POLE = 0.9999999;
const rotation = new Float64Array(16),
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

  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    super();
    this._x = x;
    this._y = y;
    this._z = z;
    this._order = order;
  }
  /** The turn around the x axis, in radians. */
  get x() {
    return this._x;
  }
  set x(value: number) {
    this._x = value;
    this._changed();
  }
  /** The turn around the y axis, in radians. */
  get y() {
    return this._y;
  }
  set y(value: number) {
    this._y = value;
    this._changed();
  }
  /** The turn around the z axis, in radians. */
  get z() {
    return this._z;
  }
  set z(value: number) {
    this._z = value;
    this._changed();
  }
  /** The order the three turns apply in, such as `'XYZ'`. */
  get order() {
    return this._order;
  }
  set order(value: string) {
    this._order = value;
    this._changed();
  }
  /** Writes the angles; `quiet` skips the notification, for an owner syncing its twin. */
  set(x: number, y: number, z: number, order = this._order, quiet = false) {
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
    return new Euler(this._x, this._y, this._z, this._order);
  }
  /** The angles of a column-major rotation matrix, in this order. */
  setFromRotationMatrix(m: { elements: ArrayLike<number> }, order = this._order, quiet = false) {
    const e = m.elements;
    // prettier-ignore
    const [m11, m12, m13, m21, m22, m23, m31, m32, m33] = [
      e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10],
    ];
    let x: number, y: number, z: number;
    switch (order) {
      case 'YXZ':
        x = Math.asin(-clamp(m23));
        [y, z] =
          Math.abs(m23) < POLE
            ? [Math.atan2(m13, m33), Math.atan2(m21, m22)]
            : [Math.atan2(-m31, m11), 0];
        break;
      case 'ZXY':
        x = Math.asin(clamp(m32));
        [y, z] =
          Math.abs(m32) < POLE
            ? [Math.atan2(-m31, m33), Math.atan2(-m12, m22)]
            : [0, Math.atan2(m21, m11)];
        break;
      case 'ZYX':
        y = Math.asin(-clamp(m31));
        [x, z] =
          Math.abs(m31) < POLE
            ? [Math.atan2(m32, m33), Math.atan2(m21, m11)]
            : [0, Math.atan2(-m12, m22)];
        break;
      case 'YZX':
        z = Math.asin(clamp(m21));
        [x, y] =
          Math.abs(m21) < POLE
            ? [Math.atan2(-m23, m22), Math.atan2(-m31, m11)]
            : [0, Math.atan2(m13, m33)];
        break;
      case 'XZY':
        z = Math.asin(-clamp(m12));
        [x, y] =
          Math.abs(m12) < POLE
            ? [Math.atan2(m32, m22), Math.atan2(m13, m11)]
            : [Math.atan2(-m23, m33), 0];
        break;
      default:
        y = Math.asin(clamp(m13));
        [x, z] =
          Math.abs(m13) < POLE
            ? [Math.atan2(-m23, m33), Math.atan2(-m12, m11)]
            : [Math.atan2(m32, m22), 0];
    }
    return this.set(x, y, z, order, quiet);
  }
  /** The three angles that make the same turn as a quaternion. */
  setFromQuaternion(q: Q, order = this._order, quiet = false) {
    composeMatrix4(rotation, ORIGIN, [q.x, q.y, q.z, q.w], UNIT);
    return this.setFromRotationMatrix({ elements: rotation }, order, quiet);
  }
  /** The three angles and the order, as a list. */
  toArray(): [number, number, number, string] {
    return [this._x, this._y, this._z, this._order];
  }
}
