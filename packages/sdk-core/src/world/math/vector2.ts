import { toSpherical } from './spherical.ts';
import { Observed } from './observed.ts';
import type { XYLike as XY } from './likes.ts';

/** A point in the plane: texture repeat and offset, lathe profiles, shape outlines. */
export class Vector2 extends Observed {
  /** Always `true`: tells a 2D vector apart from anything else. */
  readonly isVector2 = true as const;
  private _x: number;
  private _y: number;

  // Observed accessors spelled out per public class: `Euler` has the same `x`/`y` pair but a
  // different contract (angles plus an order), and a shared base would change both prototypes.
  // jscpd:ignore-start
  constructor(x = 0, y = 0) {
    super();
    this._x = x;
    this._y = y;
  }
  /** Left to right. */
  get x() {
    return this._x;
  }
  set x(value: number) {
    this._x = value;
    this._changed();
  }
  /** Bottom to top. */
  get y() {
    return this._y;
  }
  set y(value: number) {
    this._y = value;
    this._changed();
  }
  // jscpd:ignore-end
  /** Sets both numbers. */
  set(x: number, y: number) {
    this._x = x;
    this._y = y;
    return this._changed();
  }
  /** Takes the numbers of another 2D vector. */
  copy(v: XY) {
    return this.set(v.x, v.y);
  }
  /** A new 2D vector with the same numbers. */
  clone() {
    return new Vector2(this._x, this._y);
  }
  /** Adds another 2D vector. */
  add(v: XY) {
    return this.set(this._x + v.x, this._y + v.y);
  }
  /** Takes another 2D vector away. */
  sub(v: XY) {
    return this.set(this._x - v.x, this._y - v.y);
  }
  /** Multiplies both numbers by `s`. */
  multiplyScalar(s: number) {
    return this.set(this._x * s, this._y * s);
  }
  /** How long the 2D arrow is. */
  length() {
    return Math.hypot(this._x, this._y);
  }
  /** Keeps the direction, makes the length 1. */
  normalize() {
    return this.multiplyScalar(1 / (this.length() || 1));
  }
  /** How far it is from another 2D point. */
  distanceTo(v: XY) {
    return Math.hypot(this._x - v.x, this._y - v.y);
  }
  /** Reads two numbers from a list. */
  fromArray(array: ArrayLike<number>, offset = 0) {
    return this.set(array[offset], array[offset + 1]);
  }
  /** The two numbers as a list. */
  toArray(): [number, number] {
    return [this._x, this._y];
  }
}

/** Four numbers: a homogeneous point, a viewport, a plane's coefficients. */
export class Vector4 {
  /** Always `true`: tells a 4D vector apart from anything else. */
  readonly isVector4 = true as const;
  /** The first number. */
  x: number;
  /** The second number. */
  y: number;
  /** The third number. */
  z: number;
  /** The fourth number. */
  w: number;
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }
  /** Sets all four numbers. */
  set(x: number, y: number, z: number, w: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }
  /** Takes the numbers of another 4D vector. */
  copy(v: { x: number; y: number; z: number; w: number }) {
    return this.set(v.x, v.y, v.z, v.w);
  }
  /** A new 4D vector with the same numbers. */
  clone() {
    return new Vector4(this.x, this.y, this.z, this.w);
  }
  /** The four numbers as a list. */
  toArray(): [number, number, number, number] {
    return [this.x, this.y, this.z, this.w];
  }
}

/** A direction and a distance, in the convention of `spherical.ts`. */
export class Spherical {
  /** The distance from the centre. */
  radius: number;
  /** The angle down from straight up, in radians. */
  phi: number;
  /** The angle around the up axis, in radians. */
  theta: number;
  constructor(radius = 1, phi = 0, theta = 0) {
    this.radius = radius;
    this.phi = phi;
    this.theta = theta;
  }
  /** Sets the distance and both angles. */
  set(radius: number, phi: number, theta: number) {
    this.radius = radius;
    this.phi = phi;
    this.theta = theta;
    return this;
  }
  /** The distance and angles of a 3D point. */
  setFromVector3(v: { x: number; y: number; z: number }) {
    const [radius, theta, phi] = toSpherical(new Float64Array([0, this.theta, this.phi]), [
      v.x,
      v.y,
      v.z,
    ]);
    return this.set(radius, radius === 0 ? 0 : phi, radius === 0 ? 0 : theta);
  }
  /** A new direction with the same numbers. */
  clone() {
    return new Spherical(this.radius, this.phi, this.theta);
  }
}
