import {
  addScaledVector3,
  applyMatrix3Vector3,
  crossVector3,
  dotVector3,
  lengthSqVector3,
  normalizeVector3,
  scaleVector3,
  transformDirectionVector3,
  transformHomogeneousPoint,
} from '../../mathVector.ts';
import { rotateByQuaternion } from '../../mathQuaternion.ts';
import { fromSpherical } from './spherical.ts';
import { ObservedComponents } from './observed.ts';
import type { Matrix4, Matrix3 } from './matrix4.ts';
import type { XYZLike as XYZ, XYZWLike as Q } from './likes.ts';

const a = new Float64Array(3),
  b = new Float64Array(3),
  h = new Float64Array(4),
  q = new Float64Array(4);
/** A vector read into flat numbers, for the core functions that take them. */
const load = (into: Float64Array, v: XYZ) => {
  into[0] = v.x;
  into[1] = v.y;
  into[2] = v.z;
  return into;
};

/**
 * A point or a direction in three dimensions, chainable. The numbers live in `elements`, which
 * the core functions of `mathVector.ts` read and write; every write tells the owner.
 */
export class Vector3 extends ObservedComponents {
  readonly isVector3 = true as const;

  constructor(x = 0, y = 0, z = 0) {
    super(new Float64Array([x, y, z]));
  }
  set(x: number, y: number, z: number) {
    this.elements[0] = x;
    this.elements[1] = y;
    this.elements[2] = z;
    return this._changed();
  }
  /** The flat numbers written by a core function, handed to the owner as one write. */
  private written(from: ArrayLike<number>) {
    return this.set(from[0], from[1], from[2]);
  }
  setScalar(s: number) {
    return this.set(s, s, s);
  }
  copy(v: XYZ) {
    return this.set(v.x, v.y, v.z);
  }
  clone() {
    return new Vector3(this.x, this.y, this.z);
  }
  add(v: XYZ) {
    return this.set(this.x + v.x, this.y + v.y, this.z + v.z);
  }
  addScalar(s: number) {
    return this.set(this.x + s, this.y + s, this.z + s);
  }
  addVectors(u: XYZ, v: XYZ) {
    return this.set(u.x + v.x, u.y + v.y, u.z + v.z);
  }
  addScaledVector(v: XYZ, s: number) {
    return this.written(addScaledVector3(load(a, this), load(b, v), s));
  }
  sub(v: XYZ) {
    return this.addScaledVector(v, -1);
  }
  subVectors(u: XYZ, v: XYZ) {
    return this.copy(u).sub(v);
  }
  multiply(v: XYZ) {
    return this.set(this.x * v.x, this.y * v.y, this.z * v.z);
  }
  multiplyScalar(s: number) {
    return this.written(scaleVector3(load(a, this), s));
  }
  divideScalar(s: number) {
    return this.multiplyScalar(1 / s);
  }
  negate() {
    return this.multiplyScalar(-1);
  }
  min(v: XYZ) {
    return this.set(Math.min(this.x, v.x), Math.min(this.y, v.y), Math.min(this.z, v.z));
  }
  max(v: XYZ) {
    return this.set(Math.max(this.x, v.x), Math.max(this.y, v.y), Math.max(this.z, v.z));
  }
  dot(v: XYZ) {
    return dotVector3(this.elements, load(b, v));
  }
  cross(v: XYZ) {
    return this.crossVectors(this, v);
  }
  crossVectors(u: XYZ, v: XYZ) {
    return this.written(crossVector3(a, load(a, u), load(b, v)));
  }
  lengthSq() {
    return lengthSqVector3(this.elements);
  }
  length() {
    return Math.sqrt(this.lengthSq());
  }
  setLength(length: number) {
    return this.normalize().multiplyScalar(length);
  }
  normalize() {
    load(a, this);
    normalizeVector3(a);
    return this.written(a);
  }
  distanceToSquared(v: XYZ) {
    load(a, this);
    addScaledVector3(a, load(b, v), -1);
    return lengthSqVector3(a);
  }
  distanceTo(v: XYZ) {
    return Math.sqrt(this.distanceToSquared(v));
  }
  lerp(v: XYZ, t: number) {
    return this.lerpVectors(this, v, t);
  }
  lerpVectors(u: XYZ, v: XYZ, t: number) {
    return this.set(u.x + (v.x - u.x) * t, u.y + (v.y - u.y) * t, u.z + (v.z - u.z) * t);
  }
  equals(v: XYZ) {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }
  /** Point transform, divided by the projective row. */
  applyMatrix4(m: Matrix4) {
    transformHomogeneousPoint(h, m.elements, this.x, this.y, this.z);
    const w = 1 / (h[3] || 1);
    return this.set(h[0] * w, h[1] * w, h[2] * w);
  }
  applyMatrix3(m: Matrix3) {
    return this.written(applyMatrix3Vector3(a, m.elements, this.x, this.y, this.z));
  }
  /** Direction transform: no translation, renormalised. */
  transformDirection(m: Matrix4) {
    return this.written(transformDirectionVector3(a, m.elements, this.x, this.y, this.z));
  }
  applyQuaternion(r: Q) {
    q[0] = r.x;
    q[1] = r.y;
    q[2] = r.z;
    q[3] = r.w;
    return this.written(rotateByQuaternion(a, q, this.x, this.y, this.z));
  }
  setFromMatrixPosition(m: Matrix4) {
    return this.written(m.elements.subarray(12, 15));
  }
  setFromSpherical(s: { radius: number; phi: number; theta: number }) {
    return this.written(fromSpherical(a, [s.radius, s.theta, s.phi]));
  }
  fromArray(array: ArrayLike<number>, offset = 0) {
    return this.set(array[offset], array[offset + 1], array[offset + 2]);
  }
  toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }
}

/** `[x, y, z]` or a vector, read as three numbers. */
export type Vec3Input = XYZ | readonly [number, number, number];
export const readVec3 = (v: Vec3Input): [number, number, number] =>
  Array.isArray(v) ? [v[0], v[1], v[2]] : [(v as XYZ).x, (v as XYZ).y, (v as XYZ).z];
