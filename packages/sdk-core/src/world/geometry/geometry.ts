import { BufferAttribute, ownAttribute, type VertexAttribute } from '../buffer/attribute.ts';
import { Box3 } from '../math/box3.ts';
import { Sphere } from '../math/volumes.ts';
import { Matrix4 } from '../math/matrix4.ts';
import { computeNormals } from './normals.ts';
import { forgetTree } from '../object/raycastTrees.ts';
import { readPoints, spanBox, spanSphere } from './bounds.ts';
import { transformVertices } from './transform.ts';

/** The shape alone: named per-vertex attributes, an optional triangle index, material groups,
 *  the morph targets that move it and the range of it drawn. */
export class Geometry {
  /** Always `true`: tells a geometry apart from anything else. */
  readonly isGeometry = true as const;
  /** What the resource is, as a reader of the scene tells resources apart. */
  readonly kind = 'geometry' as const;
  /** The kind of the geometry, `'Geometry'`. */
  type = 'Geometry';
  /** Its name. */
  name = '';
  /** The per-vertex lists by name: `position`, `normal`, `uv`, `color`; each owns its numbers or
   *  views an interleaved buffer. */
  readonly attributes: Record<string, VertexAttribute> = {};
  /** Per morphed attribute, one attribute per morph target. */
  morphAttributes: Record<string, VertexAttribute[]> = {};
  /** True when a morph target holds displacements, not positions. */
  morphTargetsRelative = false;
  /** Which vertices make each triangle, three numbers per triangle; `null` reads them in order. */
  index: BufferAttribute | null = null;
  /** Index ranges drawn with `material[materialIndex]` when a mesh carries several. */
  readonly groups: { start: number; count: number; materialIndex: number }[] = [];
  /** The range of the index drawn. */
  drawRange = { start: 0, count: Infinity };
  /** Free room for the data of whoever built the geometry. */
  userData: Record<string, unknown> = {};
  /** Called when the geometry is given back: what a renderer's own copy of it listens to. */
  readonly released = new Set<() => void>();
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

  /** Tells every holder the geometry changed; the bounds are forgotten when its positions did. */
  _changed(moved = true) {
    this.version++;
    if (moved) this.boundingBox = this.boundingSphere = null;
    this.recipe = null;
    for (const listener of this._listeners) listener();
    return this;
  }
  /** Stores a per-vertex list under `name`. */
  setAttribute(name: string, attribute: VertexAttribute) {
    this.attributes[name] = attribute;
    const moved = name === 'position';
    if (attribute.kind === 'attribute') attribute._onChange = () => this._changed(moved);
    return this._changed(moved);
  }
  /** The per-vertex list stored under `name`, if any. */
  getAttribute(name: string): VertexAttribute | undefined {
    return this.attributes[name];
  }
  /** Removes the per-vertex list stored under `name`. */
  deleteAttribute(name: string) {
    delete this.attributes[name];
    return this._changed(name === 'position');
  }
  /** The triangle list, or `null`. */
  getIndex() {
    return this.index;
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
    if (this.index) this.index._onChange = () => this._changed(false);
    return this._changed(false);
  }
  /** Draws `count` indices from `start` with the mesh's material number `materialIndex`. */
  addGroup(start: number, count: number, materialIndex = 0) {
    this.groups.push({ start, count, materialIndex });
    return this._changed(false);
  }
  /** Removes every material group. */
  clearGroups() {
    this.groups.length = 0;
    return this._changed(false);
  }
  /** Smooth normals: each vertex averages the faces that share it, weighted by their area. */
  computeVertexNormals() {
    const position = this.attributes.position;
    if (!position) return this;
    const normals = computeNormals(readPoints(position), this.index?.array ?? null);
    return this.setAttribute('normal', new BufferAttribute(normals, 3));
  }
  /** Measures the box around every vertex, and every shape a morph target gives it, and keeps
   *  it in `boundingBox`; a normalised position is measured at its scale. */
  computeBoundingBox() {
    return (this.boundingBox = spanBox(this.boundingBox ?? new Box3(), this));
  }
  /** Measures the ball centred on the box and reaching the farthest vertex or morphed vertex, and
   *  keeps it in `boundingSphere`. */
  computeBoundingSphere() {
    return (this.boundingSphere = spanSphere(this.boundingSphere ?? new Sphere(), this));
  }
  /** Moves every position, turns every normal: the geometry itself changes, not a pose. */
  applyMatrix4(m: Matrix4) {
    transformVertices(this.attributes, m);
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
  /** A new geometry with copies of every list, its groups, range, data and bounds, and the
   *  recipe that still builds it. */
  clone() {
    const copy = this.shaped((attribute) => attribute.clone());
    if (this.index) copy.setIndex(this.index.clone());
    copy.boundingBox = this.boundingBox?.clone() ?? null;
    copy.boundingSphere = this.boundingSphere?.clone() ?? null;
    copy.recipe = this.recipe && { type: this.recipe.type, args: [...this.recipe.args] };
    return copy;
  }
  /** A geometry drawing the same triangles with no index: every corner a vertex of its own. */
  toNonIndexed() {
    const order = this.index?.array;
    if (!order) return this.clone();
    const copy = this.shaped((attribute) => ownAttribute(attribute, order));
    copy.groups.length = 0;
    return copy;
  }
  /** A new geometry of the same name, groups, range and data, its attributes made by `own`. */
  private shaped(own: (attribute: VertexAttribute) => BufferAttribute) {
    const copy = new Geometry();
    copy.name = this.name;
    for (const [name, attribute] of Object.entries(this.attributes))
      copy.setAttribute(name, own(attribute));
    for (const [name, targets] of Object.entries(this.morphAttributes))
      copy.morphAttributes[name] = targets.map(own);
    copy.morphTargetsRelative = this.morphTargetsRelative;
    for (const group of this.groups) copy.groups.push({ ...group });
    copy.drawRange = { ...this.drawRange };
    copy.userData = JSON.parse(JSON.stringify(this.userData)) as Record<string, unknown>;
    return copy;
  }
  /** Gives the geometry back: runs every release hook once, forgets the holders and the raycast
   *  tree; a disposed geometry is drawn and cast at by nobody. */
  dispose() {
    for (const hook of this.released) hook();
    this.released.clear();
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
