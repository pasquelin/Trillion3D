import { boxTransform } from '../../mathBox.ts';
import { Vector3 } from './vector3.ts';
import type { Matrix4 } from './matrix4.ts';
import type { XYZLike as XYZ } from './likes.ts';

/** What `setFromObject` walks: a node, its world matrix, and the box its own content spans. */
export interface BoundedNode {
  updateMatrixWorld(force?: boolean): void;
  traverse(fn: (node: BoundedNode) => void): void;
  readonly matrixWorld: Matrix4;
  /** The box of the node's own content in its local frame; null for a node that holds none. */
  localBounds?(): Box3 | null;
}

const flat = new Float64Array(6);

/** An axis-aligned box. Empty is `min > max`, the state a new box starts in. */
export class Box3 {
  readonly isBox3 = true as const;
  min: Vector3;
  max: Vector3;
  constructor(
    min = new Vector3(Infinity, Infinity, Infinity),
    max = new Vector3(-Infinity, -Infinity, -Infinity),
  ) {
    this.min = min;
    this.max = max;
  }

  set(min: XYZ, max: XYZ) {
    this.min.copy(min);
    this.max.copy(max);
    return this;
  }
  makeEmpty() {
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    return this;
  }
  isEmpty() {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }
  copy(b: Box3) {
    return this.set(b.min, b.max);
  }
  clone() {
    return new Box3().copy(this);
  }
  expandByPoint(p: XYZ) {
    this.min.min(p);
    this.max.max(p);
    return this;
  }
  expandByScalar(s: number) {
    this.min.addScalar(-s);
    this.max.addScalar(s);
    return this;
  }
  union(b: Box3) {
    this.min.min(b.min);
    this.max.max(b.max);
    return this;
  }
  setFromArray(array: ArrayLike<number>, itemSize = 3) {
    this.makeEmpty();
    for (let i = 0; i + 2 < array.length; i += itemSize)
      this.expandByPoint({ x: array[i], y: array[i + 1], z: array[i + 2] });
    return this;
  }
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
  applyMatrix4(m: Matrix4) {
    flat.set([this.min.x, this.min.y, this.min.z, this.max.x, this.max.y, this.max.z]);
    boxTransform(flat, 0, flat, 0, m.elements);
    this.min.set(flat[0], flat[1], flat[2]);
    this.max.set(flat[3], flat[4], flat[5]);
    return this;
  }
  getCenter(out = new Vector3()) {
    return this.isEmpty()
      ? out.set(0, 0, 0)
      : out.addVectors(this.min, this.max).multiplyScalar(0.5);
  }
  getSize(out = new Vector3()) {
    return this.isEmpty() ? out.set(0, 0, 0) : out.subVectors(this.max, this.min);
  }
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
  getBoundingSphere<T extends { center: Vector3; radius: number }>(out: T): T {
    this.getCenter(out.center);
    out.radius = this.isEmpty() ? -1 : this.getSize(new Vector3()).length() * 0.5;
    return out;
  }
  equals(b: Box3) {
    return this.min.equals(b.min) && this.max.equals(b.max);
  }
}
