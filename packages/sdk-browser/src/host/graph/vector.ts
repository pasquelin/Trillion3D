/**
 * A VECTOR OF A POSE THE ENGINE'S OWN GRAPH HOLDS: three plain data fields.
 *
 * It is not a second math library: the core's `Vector3` keeps its numbers behind accessors of its
 * own, which the watch's hook cannot sit on (`../scene/hookCore.ts` replaces a node's vector by a
 * twin whose accessors sit over plain fields). A controller's operations are the reference's,
 * number for number.
 */

type XYZ = { readonly x: number; readonly y: number; readonly z: number };

/** Three numbers of a pose or a point: plain data fields, and the operations a controller uses. */
export class GraphVector {
  x: number;
  y: number;
  z: number;
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  /** Writes the three numbers. */
  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  /** Takes another point's numbers. */
  copy(v: XYZ) {
    return this.set(v.x, v.y, v.z);
  }
  /** A copy. */
  clone() {
    return new GraphVector(this.x, this.y, this.z);
  }
  /** Adds another vector. */
  add(v: XYZ) {
    return this.set(this.x + v.x, this.y + v.y, this.z + v.z);
  }
  /** Takes another vector away. */
  sub(v: XYZ) {
    return this.set(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  /** Scales the three numbers. */
  multiplyScalar(s: number) {
    return this.set(this.x * s, this.y * s, this.z * s);
  }
  /** Its length. */
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  /** Keeps the direction, sets the length. */
  setLength(length: number) {
    return this.multiplyScalar(1 / (this.length() || 1)).multiplyScalar(length);
  }
  /** Distance to a point. */
  distanceTo(v: XYZ) {
    const dx = this.x - v.x,
      dy = this.y - v.y,
      dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  /** Reads three numbers from a list. */
  fromArray(array: ArrayLike<number>, offset = 0) {
    return this.set(array[offset], array[offset + 1], array[offset + 2]);
  }
}
