import { toSpherical } from './spherical.ts';
import { Observed } from './observed.ts';
import type { XYLike as XY } from './likes.ts';

/** A point in the plane: texture repeat and offset, lathe profiles, shape outlines. */
export class Vector2 extends Observed {
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
  get x() {
    return this._x;
  }
  set x(value: number) {
    this._x = value;
    this._changed();
  }
  get y() {
    return this._y;
  }
  set y(value: number) {
    this._y = value;
    this._changed();
  }
  // jscpd:ignore-end
  set(x: number, y: number) {
    this._x = x;
    this._y = y;
    return this._changed();
  }
  copy(v: XY) {
    return this.set(v.x, v.y);
  }
  clone() {
    return new Vector2(this._x, this._y);
  }
  add(v: XY) {
    return this.set(this._x + v.x, this._y + v.y);
  }
  sub(v: XY) {
    return this.set(this._x - v.x, this._y - v.y);
  }
  multiplyScalar(s: number) {
    return this.set(this._x * s, this._y * s);
  }
  length() {
    return Math.hypot(this._x, this._y);
  }
  normalize() {
    return this.multiplyScalar(1 / (this.length() || 1));
  }
  distanceTo(v: XY) {
    return Math.hypot(this._x - v.x, this._y - v.y);
  }
  fromArray(array: ArrayLike<number>, offset = 0) {
    return this.set(array[offset], array[offset + 1]);
  }
  toArray(): [number, number] {
    return [this._x, this._y];
  }
}

/** Four numbers: a homogeneous point, a viewport, a plane's coefficients. */
export class Vector4 {
  readonly isVector4 = true as const;
  x: number;
  y: number;
  z: number;
  w: number;
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }
  set(x: number, y: number, z: number, w: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }
  copy(v: { x: number; y: number; z: number; w: number }) {
    return this.set(v.x, v.y, v.z, v.w);
  }
  clone() {
    return new Vector4(this.x, this.y, this.z, this.w);
  }
  toArray(): [number, number, number, number] {
    return [this.x, this.y, this.z, this.w];
  }
}

/** A direction and a distance, in the convention of `spherical.ts`. */
export class Spherical {
  radius: number;
  phi: number;
  theta: number;
  constructor(radius = 1, phi = 0, theta = 0) {
    this.radius = radius;
    this.phi = phi;
    this.theta = theta;
  }
  set(radius: number, phi: number, theta: number) {
    this.radius = radius;
    this.phi = phi;
    this.theta = theta;
    return this;
  }
  setFromVector3(v: { x: number; y: number; z: number }) {
    const [radius, theta, phi] = toSpherical(new Float64Array([0, this.theta, this.phi]), [
      v.x,
      v.y,
      v.z,
    ]);
    return this.set(radius, radius === 0 ? 0 : phi, radius === 0 ? 0 : theta);
  }
  clone() {
    return new Spherical(this.radius, this.phi, this.theta);
  }
}
