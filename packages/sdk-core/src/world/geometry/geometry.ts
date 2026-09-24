import { BufferAttribute } from '../buffer/index.ts';
import { Box3 } from '../math/box3.ts';
import { Sphere } from '../math/volumes.ts';
import { Matrix4 } from '../math/matrix4.ts';
import { transformPointsBatch } from '../../math/batch/points.ts';
import { normalMatrix3 } from '../../math/matrix/matrix3.ts';
import { applyMatrix3Vector3, normalizeVector3 } from '../../math/primitives/vector.ts';
import { computeNormals } from './normals.ts';
import { forgetTree } from '../object/raycastTrees.ts';

/** The shape alone: named per-vertex attributes, an optional triangle index, material groups. */
export class Geometry {
  /** Always `true`: tells a geometry apart from anything else. */
  readonly isGeometry = true as const;
  /** The kind of the geometry, `'Geometry'`. */
  type = 'Geometry';
  /** The per-vertex lists by name: `position`, `normal`, `uv`, `color`. */
  readonly attributes: Record<string, BufferAttribute> = {};
  /** Which vertices make each triangle, three numbers per triangle; `null` reads them in order. */
  index: BufferAttribute | null = null;
  /** Index ranges drawn with `material[materialIndex]` when a mesh carries several. */
  readonly groups: { start: number; count: number; materialIndex: number }[] = [];
  /** The box around every vertex, once computed; `null` until then. */
  boundingBox: Box3 | null = null;
  /** The ball around every vertex, once computed; `null` until then. */
  boundingSphere: Sphere | null = null;
  /** The family member and arguments that built this shape, while it is still what they built:
   *  what a saved scene stores instead of the vertices. Any later change forgets it. */
  recipe: { type: string; args: unknown[] } | null = null;
  /** Bumped by every change of shape: what the world compares to cut the pages again. */
  version = 0;
  /** Who draws this geometry: every mesh holding it hears its changes. */
  readonly _listeners = new Set<() => void>();

  /** Tells every holder the shape changed. */
  _changed() {
    this.version++;
    this.boundingBox = this.boundingSphere = null;
    this.recipe = null;
    for (const listener of this._listeners) listener();
    return this;
  }
  /** Stores a per-vertex list under `name`. */
  setAttribute(name: string, attribute: BufferAttribute) {
    this.attributes[name] = attribute;
    attribute._onChange = () => this._changed();
    return this._changed();
  }
  /** The per-vertex list stored under `name`, if any. */
  getAttribute(name: string): BufferAttribute | undefined {
    return this.attributes[name];
  }
  /** Removes the per-vertex list stored under `name`. */
  deleteAttribute(name: string) {
    delete this.attributes[name];
    return this._changed();
  }
  /** Whether a per-vertex list is stored under `name`. */
  hasAttribute(name: string) {
    return name in this.attributes;
  }
  /** Sets which vertices make each triangle. */
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
  /** Draws `count` indices from `start` with the mesh's material number `materialIndex`. */
  addGroup(start: number, count: number, materialIndex = 0) {
    this.groups.push({ start, count, materialIndex });
    return this._changed();
  }
  /** Removes every material group. */
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
  /** Measures the box around every vertex and keeps it in `boundingBox`. */
  computeBoundingBox() {
    const box = new Box3();
    const position = this.attributes.position;
    if (position) box.setFromArray(position.array, position.itemSize);
    return (this.boundingBox = box);
  }
  /** Measures the ball around every vertex and keeps it in `boundingSphere`. */
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
  /** Moves every vertex by `(x, y, z)`. */
  translate(x: number, y: number, z: number) {
    return this.applyMatrix4(new Matrix4().makeTranslation(x, y, z));
  }
  /** Turns every vertex around the x axis, by `angle` radians. */
  rotateX(angle: number) {
    return this.applyMatrix4(new Matrix4().makeRotationX(angle));
  }
  /** Turns every vertex around the y axis, by `angle` radians. */
  rotateY(angle: number) {
    return this.applyMatrix4(new Matrix4().makeRotationY(angle));
  }
  /** Turns every vertex around the z axis, by `angle` radians. */
  rotateZ(angle: number) {
    return this.applyMatrix4(new Matrix4().makeRotationZ(angle));
  }
  /** Stretches every vertex by `(x, y, z)`. */
  scale(x: number, y: number, z: number) {
    return this.applyMatrix4(new Matrix4().makeScale(x, y, z));
  }
  /** Moves the geometry so its box is centred on the origin. */
  center() {
    const c = this.computeBoundingBox().getCenter();
    return this.translate(-c.x, -c.y, -c.z);
  }
  /** A new geometry with copies of every list, and the recipe that still builds it. */
  clone() {
    const copy = new Geometry();
    for (const [name, attribute] of Object.entries(this.attributes))
      copy.setAttribute(name, attribute.clone());
    if (this.index) copy.setIndex(this.index.clone());
    for (const g of this.groups) copy.addGroup(g.start, g.count, g.materialIndex);
    copy.recipe = this.recipe && { type: this.recipe.type, args: [...this.recipe.args] };
    return copy;
  }
  /** Forgets the holders and the raycast tree: a disposed geometry is drawn and cast at by nobody. */
  dispose() {
    this._listeners.clear();
    forgetTree(this);
  }
}

/** Stamps `geometry` with the family call that built it (`Geometry.recipe`): a saved scene
 *  stores the call and builds the same shape again. */
export function withRecipe(geometry: Geometry, type: string, args: ArrayLike<unknown>) {
  geometry.recipe = { type, args: Array.from(args) };
  return geometry;
}
