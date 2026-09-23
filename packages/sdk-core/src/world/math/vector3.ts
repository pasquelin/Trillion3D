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
} from '../../math/primitives/vector.ts';
import { rotateByQuaternion } from '../../math/matrix/quaternion.ts';
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
 * the core functions of `math/primitives/vector.ts` read and write; every write tells the owner.
 */
export class Vector3 extends ObservedComponents {
  /** Always `true`: tells a 3D vector apart. */ readonly isVector3 = true as const;

  constructor(x = 0, y = 0, z = 0) {
    super(new Float64Array([x, y, z]));
  }
  /** Writes the three numbers; a write that changes none of them tells nobody. */
  set(x: number, y: number, z: number) {
    const e = this.elements;
    if (e[0] === x && e[1] === y && e[2] === z) return this;
    this.elements[0] = x;
    this.elements[1] = y;
    this.elements[2] = z;
    return this._changed();
  }
  /** The flat numbers written by a core function, handed to the owner as one write. */
  private written(from: ArrayLike<number>) {
    return this.set(from[0], from[1], from[2]);
  }
  /** Sets x, y and z to one value. */ setScalar(s: number) {
    return this.set(s, s, s);
  }
  /** Takes x, y and z of another point. */ copy(v: XYZ) {
    return this.set(v.x, v.y, v.z);
  }
  /** A new vector with the same numbers. */ clone() {
    return new Vector3(this.x, this.y, this.z);
  }
  /** Adds another vector. */ add(v: XYZ) {
    return this.set(this.x + v.x, this.y + v.y, this.z + v.z);
  }
  /** Adds `s` to x, y and z. */ addScalar(s: number) {
    return this.set(this.x + s, this.y + s, this.z + s);
  }
  /** Becomes `u + v`. */ addVectors(u: XYZ, v: XYZ) {
    return this.set(u.x + v.x, u.y + v.y, u.z + v.z);
  }
  /** Adds `v` times `s`. */ addScaledVector(v: XYZ, s: number) {
    return this.written(addScaledVector3(load(a, this), load(b, v), s));
  }
  /** Takes another vector away. */ sub(v: XYZ) {
    return this.addScaledVector(v, -1);
  }
  /** Becomes `u − v`. */ subVectors(u: XYZ, v: XYZ) {
    return this.copy(u).sub(v);
  }
  /** Multiplies x, y and z one by one. */ multiply(v: XYZ) {
    return this.set(this.x * v.x, this.y * v.y, this.z * v.z);
  }
  /** Multiplies x, y and z by `s`. */ multiplyScalar(s: number) {
    return this.written(scaleVector3(load(a, this), s));
  }
  /** Divides x, y and z by `s`. */ divideScalar(s: number) {
    return this.multiplyScalar(1 / s);
  }
  /** Points the other way. */ negate() {
    return this.multiplyScalar(-1);
  }
  /** Keeps the smaller of each number. */ min(v: XYZ) {
    return this.set(Math.min(this.x, v.x), Math.min(this.y, v.y), Math.min(this.z, v.z));
  }
  /** Keeps the larger of each number. */ max(v: XYZ) {
    return this.set(Math.max(this.x, v.x), Math.max(this.y, v.y), Math.max(this.z, v.z));
  }
  /** How much two arrows point the same way. */ dot(v: XYZ) {
    return dotVector3(this.elements, load(b, v));
  }
  /** Becomes the arrow square to both. */ cross(v: XYZ) {
    return this.crossVectors(this, v);
  }
  /** Becomes the arrow square to `u` and `v`. */ crossVectors(u: XYZ, v: XYZ) {
    return this.written(crossVector3(a, load(a, u), load(b, v)));
  }
  /** The length, squared: quicker to get. */ lengthSq() {
    return lengthSqVector3(this.elements);
  }
  /** How long the arrow is. */ length() {
    return Math.sqrt(this.lengthSq());
  }
  /** Keeps the direction, sets the length. */ setLength(length: number) {
    return this.normalize().multiplyScalar(length);
  }
  /** Keeps the direction, makes the length 1. */ normalize() {
    load(a, this);
    normalizeVector3(a);
    return this.written(a);
  }
  /** The distance to a point, squared. */ distanceToSquared(v: XYZ) {
    load(a, this);
    addScaledVector3(a, load(b, v), -1);
    return lengthSqVector3(a);
  }
  /** The distance to a point. */ distanceTo(v: XYZ) {
    return Math.sqrt(this.distanceToSquared(v));
  }
  /** Moves `t` of the way to `v`. */ lerp(v: XYZ, t: number) {
    return this.lerpVectors(this, v, t);
  }
  /** Becomes the point `t` of the way from `u` to `v`. */ lerpVectors(u: XYZ, v: XYZ, t: number) {
    return this.set(u.x + (v.x - u.x) * t, u.y + (v.y - u.y) * t, u.z + (v.z - u.z) * t);
  }
  /** Whether two vectors hold the same numbers. */ equals(v: XYZ) {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }
  /** Point transform, divided by the projective row. */
  applyMatrix4(m: Matrix4) {
    transformHomogeneousPoint(h, m.elements, this.x, this.y, this.z);
    const w = 1 / (h[3] || 1);
    return this.set(h[0] * w, h[1] * w, h[2] * w);
  }
  /** Multiplies by a 3×3 matrix. */ applyMatrix3(m: Matrix3) {
    return this.written(applyMatrix3Vector3(a, m.elements, this.x, this.y, this.z));
  }
  /** Direction transform: no translation, renormalised. */
  transformDirection(m: Matrix4) {
    return this.written(transformDirectionVector3(a, m.elements, this.x, this.y, this.z));
  }
  /** Turns the vector by a quaternion. */ applyQuaternion(r: Q) {
    q[0] = r.x;
    q[1] = r.y;
    q[2] = r.z;
    q[3] = r.w;
    return this.written(rotateByQuaternion(a, q, this.x, this.y, this.z));
  }
  /** Takes the move part of a matrix. */ setFromMatrixPosition(m: Matrix4) {
    return this.written(m.elements.subarray(12, 15));
  }
  /** The point at a distance and two angles. */
  setFromSpherical(s: { radius: number; phi: number; theta: number }) {
    return this.written(fromSpherical(a, [s.radius, s.theta, s.phi]));
  }
  /** Reads x, y and z from a list. */ fromArray(array: ArrayLike<number>, offset = 0) {
    return this.set(array[offset], array[offset + 1], array[offset + 2]);
  }
  /** x, y and z as a list. */ toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }
}

/** `[x, y, z]` or a vector, read as three numbers. */
export type Vec3Input = XYZ | readonly [number, number, number];
export const readVec3 = (v: Vec3Input): [number, number, number] =>
  Array.isArray(v) ? [v[0], v[1], v[2]] : [(v as XYZ).x, (v as XYZ).y, (v as XYZ).z];
