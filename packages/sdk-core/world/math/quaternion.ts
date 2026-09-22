import {
  axisAngleQuaternion,
  multiplyQuaternion,
  normalizeQuaternion,
  localTurnQuaternion,
} from '../../mathQuaternion.ts';
import { writeRotationQuaternion } from '../../mathMatrix4Trs.ts';
import { ObservedComponents } from './observed.ts';
import type { EulerLike, XYZLike as V, XYZWLike as Q } from './likes.ts';

const other = new Float64Array(4),
  axis = new Float64Array(3),
  turn = new Float64Array(4),
  rows = new Float64Array(9);
const load = (into: Float64Array, q: Q) => {
  into[0] = q.x;
  into[1] = q.y;
  into[2] = q.z;
  into[3] = q.w;
  return into;
};

/** A rotation as a unit quaternion over `mathQuaternion.ts`. Written components notify the owner. */
export class Quaternion extends ObservedComponents {
  readonly isQuaternion = true as const;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    super(new Float64Array([x, y, z, w]));
  }
  get w() {
    return this.elements[3];
  }
  set w(value: number) {
    this.elements[3] = value;
    this._changed();
  }
  /** Writes the four numbers; `quiet` skips the notification, for an owner syncing its twin. */
  set(x: number, y: number, z: number, w: number, quiet = false) {
    this.elements[0] = x;
    this.elements[1] = y;
    this.elements[2] = z;
    this.elements[3] = w;
    return quiet ? this : this._changed();
  }
  private written(from: ArrayLike<number>, quiet = false) {
    return this.set(from[0], from[1], from[2], from[3], quiet);
  }
  copy(q: Q) {
    return this.set(q.x, q.y, q.z, q.w);
  }
  clone() {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }
  identity() {
    return this.set(0, 0, 0, 1);
  }
  setFromAxisAngle(v: V, angle: number) {
    const n = Math.hypot(v.x, v.y, v.z) || 1;
    axis[0] = v.x / n;
    axis[1] = v.y / n;
    axis[2] = v.z / n;
    return this.written(axisAngleQuaternion(other, axis, angle));
  }
  /** The rotation of three Euler angles, in the order they name (`localTurnQuaternion`). */
  setFromEuler(e: EulerLike, quiet = false) {
    return this.written(localTurnQuaternion(other, e.x, e.y, e.z, e.order), quiet);
  }
  /** From the upper 3×3 of a column-major matrix whose columns are unit length. */
  setFromRotationMatrix(m: { elements: ArrayLike<number> }) {
    const e = m.elements;
    rows.set([e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]);
    writeRotationQuaternion(other, rows);
    return this.written(other);
  }
  /** The shortest rotation taking unit vector `a` onto unit vector `b`. */
  setFromUnitVectors(a: V, b: V) {
    const r = a.x * b.x + a.y * b.y + a.z * b.z + 1;
    if (r < 1e-8)
      return Math.abs(a.x) > Math.abs(a.z)
        ? this.set(-a.y, a.x, 0, 0).normalize()
        : this.set(0, -a.z, a.y, 0).normalize();
    return this.set(
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x,
      r,
    ).normalize();
  }
  multiply(q: Q) {
    return this.written(multiplyQuaternion(other, this.elements, load(turn, q)));
  }
  premultiply(q: Q) {
    return this.written(multiplyQuaternion(other, load(turn, q), this.elements));
  }
  multiplyQuaternions(a: Q, b: Q) {
    return this.written(multiplyQuaternion(other, load(other, a), load(turn, b)));
  }
  invert() {
    return this.set(-this.x, -this.y, -this.z, this.w);
  }
  conjugate() {
    return this.invert();
  }
  dot(q: Q) {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
  }
  length() {
    return Math.hypot(this.x, this.y, this.z, this.w);
  }
  normalize() {
    other.set(this.elements);
    return this.written(normalizeQuaternion(other));
  }
  angleTo(q: Q) {
    return 2 * Math.acos(Math.min(1, Math.abs(this.dot(q))));
  }
  /** Spherical interpolation towards `q`, along the shorter arc. */
  slerp(q: Q, t: number) {
    let cos = this.dot(q);
    const sign = cos < 0 ? -1 : 1;
    cos *= sign;
    const angle = Math.acos(Math.min(1, cos)),
      sin = Math.sin(angle);
    // Nearly aligned: the arc is a line, and the normalised lerp is exact to rounding.
    const [wa, wb] =
      sin < 1e-6
        ? [1 - t, t * sign]
        : [Math.sin((1 - t) * angle) / sin, (Math.sin(t * angle) / sin) * sign];
    this.set(
      this.x * wa + q.x * wb,
      this.y * wa + q.y * wb,
      this.z * wa + q.z * wb,
      this.w * wa + q.w * wb,
    );
    return sin < 1e-6 ? this.normalize() : this;
  }
  equals(q: Q) {
    return this.x === q.x && this.y === q.y && this.z === q.z && this.w === q.w;
  }
  fromArray(array: ArrayLike<number>, offset = 0) {
    return this.set(array[offset], array[offset + 1], array[offset + 2], array[offset + 3]);
  }
  toArray(): [number, number, number, number] {
    return [this.x, this.y, this.z, this.w];
  }
}
