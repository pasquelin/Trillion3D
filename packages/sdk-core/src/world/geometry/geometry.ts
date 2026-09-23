import { BufferAttribute } from '../buffer/index.ts';
import { Box3 } from '../math/box3.ts';
import { Sphere } from '../math/volumes.ts';
import { Matrix4 } from '../math/matrix4.ts';
import { transformPointsBatch } from '../../math/batch/points.ts';
import { normalMatrix3 } from '../../math/matrix/matrix3.ts';
import { applyMatrix3Vector3, normalizeVector3 } from '../../math/primitives/vector.ts';
import { computeNormals } from './normals.ts';

/** The shape alone: named per-vertex attributes, an optional triangle index, material groups. */
export class Geometry {
  readonly isGeometry = true as const;
  type = 'Geometry';
  readonly attributes: Record<string, BufferAttribute> = {};
  index: BufferAttribute | null = null;
  /** Index ranges drawn with `material[materialIndex]` when a mesh carries several. */
  readonly groups: { start: number; count: number; materialIndex: number }[] = [];
  boundingBox: Box3 | null = null;
  boundingSphere: Sphere | null = null;
  /** Bumped by every change of shape: what the world compares to cut the pages again. */
  version = 0;
  /** Who draws this geometry: every mesh holding it hears its changes. */
  readonly _listeners = new Set<() => void>();

  /** Tells every holder the shape changed. */
  _changed() {
    this.version++;
    this.boundingBox = this.boundingSphere = null;
    for (const listener of this._listeners) listener();
    return this;
  }
  setAttribute(name: string, attribute: BufferAttribute) {
    this.attributes[name] = attribute;
    attribute._onChange = () => this._changed();
    return this._changed();
  }
  getAttribute(name: string): BufferAttribute | undefined {
    return this.attributes[name];
  }
  deleteAttribute(name: string) {
    delete this.attributes[name];
    return this._changed();
  }
  hasAttribute(name: string) {
    return name in this.attributes;
  }
  setIndex(index: BufferAttribute | ArrayLike<number> | null) {
    if (index === null || index instanceof BufferAttribute) this.index = index;
    else {
      const values = Array.from(index);
      const max = values.reduce((a, b) => Math.max(a, b), 0);
      this.index = new BufferAttribute(
        max > 65535 ? new Uint32Array(values) : new Uint16Array(values),
        1,
      );
    }
    if (this.index) this.index._onChange = () => this._changed();
    return this._changed();
  }
  addGroup(start: number, count: number, materialIndex = 0) {
    this.groups.push({ start, count, materialIndex });
    return this._changed();
  }
  clearGroups() {
    this.groups.length = 0;
    return this._changed();
  }
  /** Smooth normals: each vertex averages the faces that share it, weighted by their area. */
  computeVertexNormals() {
    const position = this.attributes.position;
    if (!position) return this;
    const normals = computeNormals(position.array, this.index?.array ?? null);
    return this.setAttribute('normal', new BufferAttribute(normals, 3));
  }
  computeBoundingBox() {
    const box = new Box3();
    const position = this.attributes.position;
    if (position) box.setFromArray(position.array, position.itemSize);
    return (this.boundingBox = box);
  }
  computeBoundingSphere() {
    const box = this.boundingBox ?? this.computeBoundingBox();
    return (this.boundingSphere = box.getBoundingSphere(new Sphere()));
  }
  /** Moves every position, turns every normal: the geometry itself changes, not a pose. */
  applyMatrix4(m: Matrix4) {
    const position = this.attributes.position,
      normal = this.attributes.normal;
    if (position) {
      const points = position.array as Float32Array;
      transformPointsBatch(points, m.elements, points, position.count);
    }
    if (normal) {
      const n = normalMatrix3(new Float64Array(9), m.elements),
        v = new Float64Array(3);
      for (let i = 0; i < normal.count; i++) {
        applyMatrix3Vector3(v, n, normal.getX(i), normal.getY(i), normal.getZ(i));
        normalizeVector3(v);
        normal.setXYZ(i, v[0], v[1], v[2]);
      }
    }
    return this._changed();
  }
  translate(x: number, y: number, z: number) {
    return this.applyMatrix4(new Matrix4().makeTranslation(x, y, z));
  }
  rotateX(angle: number) {
    return this.applyMatrix4(new Matrix4().makeRotationX(angle));
  }
  rotateY(angle: number) {
    return this.applyMatrix4(new Matrix4().makeRotationY(angle));
  }
  rotateZ(angle: number) {
    return this.applyMatrix4(new Matrix4().makeRotationZ(angle));
  }
  scale(x: number, y: number, z: number) {
    return this.applyMatrix4(new Matrix4().makeScale(x, y, z));
  }
  /** Moves the geometry so its box is centred on the origin. */
  center() {
    const c = this.computeBoundingBox().getCenter();
    return this.translate(-c.x, -c.y, -c.z);
  }
  clone() {
    const copy = new Geometry();
    for (const [name, attribute] of Object.entries(this.attributes))
      copy.setAttribute(name, attribute.clone());
    if (this.index) copy.setIndex(this.index.clone());
    for (const g of this.groups) copy.addGroup(g.start, g.count, g.materialIndex);
    return copy;
  }
  /** Forgets the holders: a disposed geometry is drawn by nobody. */
  dispose() {
    this._listeners.clear();
  }
}
