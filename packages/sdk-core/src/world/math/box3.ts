import { boxTransform } from '../../math/primitives/box.ts';
import { sphereFromBounds } from '../../math/primitives/sphere.ts';
import { Vector3 } from './vector3.ts';
import type { Matrix4 } from './matrix4.ts';
import type { XYZLike as XYZ } from './likes.ts';

/** What `setFromObject` walks: a node, its world matrix, and the box its own content spans. */
export interface BoundedNode {
  /** Brings the node's world matrix up to date. */
  updateMatrixWorld(force?: boolean): void;
  /** Visits the node and every node below it. */
  traverse(fn: (node: BoundedNode) => void): void;
  /** Where the node sits in the world, as a matrix. */
  readonly matrixWorld: Matrix4;
  /** The box of the node's own content in its local frame; null for a node that holds none. */
  localBounds?(): Box3 | null;
}

const flat = new Float64Array(6);

/** An axis-aligned box. Empty is `min > max`, the state a new box starts in. */
export class Box3 {
  /** Always `true`: tells a box apart from anything else. */
  readonly isBox3 = true as const;
  /** The corner with the smallest x, y and z. */
  min: Vector3;
  /** The corner with the largest x, y and z. */
  max: Vector3;
  constructor(
    min = new Vector3(Infinity, Infinity, Infinity),
    max = new Vector3(-Infinity, -Infinity, -Infinity),
  ) {
    this.min = min;
    this.max = max;
  }

  /** Sets both corners. */
  set(min: XYZ, max: XYZ) {
    this.min.copy(min);
    this.max.copy(max);
    return this;
  }
  /** Makes the box hold nothing, ready to grow. */
  makeEmpty() {
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    return this;
  }
  /** Whether the box holds nothing. */
  isEmpty() {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }
  /** Takes the corners of another box. */
  copy(b: Box3) {
    return this.set(b.min, b.max);
  }
  /** A new box with the same corners. */
  clone() {
    return new Box3().copy(this);
  }
  /** Grows the box just enough to hold a point. */
  expandByPoint(p: XYZ) {
    this.min.min(p);
    this.max.max(p);
    return this;
  }
  /** Grows the box by `s` on every side. */
  expandByScalar(s: number) {
    this.min.addScalar(-s);
    this.max.addScalar(s);
    return this;
  }
  /** Grows the box to hold another box too. */
  union(b: Box3) {
    this.min.min(b.min);
    this.max.max(b.max);
    return this;
  }
  /** The smallest box around a flat list of coordinates. */
  setFromArray(array: ArrayLike<number>, itemSize = 3) {
    this.makeEmpty();
    for (let i = 0; i + 2 < array.length; i += itemSize)
      this.expandByPoint({ x: array[i], y: array[i + 1], z: array[i + 2] });
    return this;
  }
  /** The smallest box around a list of points. */
  setFromPoints(points: XYZ[]) {
    this.makeEmpty();
    for (const p of points) this.expandByPoint(p);
    return this;
  }
  /** The world box of everything under `node`, each content's box carried by its world matrix. */
  setFromObject(node: BoundedNode) {
    this.makeEmpty();
    node.updateMatrixWorld(true);
    node.traverse((child) => {
      const local = child.localBounds?.();
      if (local && !local.isEmpty()) this.union(local.clone().applyMatrix4(child.matrixWorld));
    });
    return this;
  }
  /** Moves the box by a matrix and keeps it lined up with the axes. */
  applyMatrix4(m: Matrix4) {
    flat.set([this.min.x, this.min.y, this.min.z, this.max.x, this.max.y, this.max.z]);
    boxTransform(flat, 0, flat, 0, m.elements);
    this.min.set(flat[0], flat[1], flat[2]);
    this.max.set(flat[3], flat[4], flat[5]);
    return this;
  }
  /** The middle of the box. */
  getCenter(out = new Vector3()) {
    return this.isEmpty()
      ? out.set(0, 0, 0)
      : out.addVectors(this.min, this.max).multiplyScalar(0.5);
  }
  /** How wide, tall and deep the box is. */
  getSize(out = new Vector3()) {
    return this.isEmpty() ? out.set(0, 0, 0) : out.subVectors(this.max, this.min);
  }
  /** Whether a point is inside the box. */
  containsPoint(p: XYZ) {
    const { min, max } = this;
    return !(
      p.x < min.x ||
      p.x > max.x ||
      p.y < min.y ||
      p.y > max.y ||
      p.z < min.z ||
      p.z > max.z
    );
  }
  /** Whether two boxes overlap. */
  intersectsBox(b: Box3) {
    const { min, max } = this;
    return !(
      b.max.x < min.x ||
      b.min.x > max.x ||
      b.max.y < min.y ||
      b.min.y > max.y ||
      b.max.z < min.z ||
      b.min.z > max.z
    );
  }
  /** The sphere through the corners (`sphereFromBounds`); an empty box gives radius −1. */
  getBoundingSphere<T extends { center: Vector3; radius: number }>(out: T): T {
    const { min, max } = this;
    sphereFromBounds(flat, 0, min.x, min.y, min.z, max.x, max.y, max.z);
    out.center.set(flat[0], flat[1], flat[2]);
    out.radius = flat[3];
    return out;
  }
  /** Whether two boxes have the same corners. */
  equals(b: Box3) {
    return this.min.equals(b.min) && this.max.equals(b.max);
  }
}
