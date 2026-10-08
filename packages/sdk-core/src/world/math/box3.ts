import {
  boxCenter,
  boxContainsPoint,
  boxEmpty,
  boxesOverlap,
  boxExpandByPoint,
  boxFromPoints,
  boxGrow,
  boxIsEmpty,
  boxTransform,
  boxUnion,
} from '../../../../math/src/geometry/box.ts'
import { sphereFromBounds } from '../../../../math/src/geometry/sphere.ts'
import { Vector3 } from './vector3.ts'
import type { Matrix4 } from './matrix4.ts'
import type { XYZLike as XYZ } from './likes.ts'

/** What `setFromObject` walks: a node, its world matrix, and the box its own content spans. */
export interface BoundedNode {
  /** Brings the node's world matrix up to date. */
  updateMatrixWorld(force?: boolean): void
  /** Visits the node and every node below it. */
  traverse(fn: (node: BoundedNode) => void): void
  /** Where the node sits in the world, as a matrix. */
  readonly matrixWorld: Matrix4
  /** The box of the node's own content in its local frame; null for a node that holds none. */
  localBounds?(): Box3 | null
}

/** The six bounds of a box, flat, for the core box functions; `other` holds a second box. */
const flat = new Float64Array(6),
  other = new Float64Array(6)

/** An axis-aligned box. Empty is `min > max`, the state a new box starts in. */
export class Box3 {
  /** Always `true`: tells a box apart from anything else. */
  readonly isBox3 = true as const
  /** The corner with the smallest x, y and z. */
  min: Vector3
  /** The corner with the largest x, y and z. */
  max: Vector3
  constructor(
    min = new Vector3(Infinity, Infinity, Infinity),
    max = new Vector3(-Infinity, -Infinity, -Infinity),
  ) {
    this.min = min
    this.max = max
  }

  /** Sets both corners. */
  set(min: XYZ, max: XYZ) {
    this.min.copy(min)
    this.max.copy(max)
    return this
  }
  /** Makes the box hold nothing, ready to grow. */
  makeEmpty() {
    this.min.set(Infinity, Infinity, Infinity)
    this.max.set(-Infinity, -Infinity, -Infinity)
    return this
  }
  /** Whether the box holds nothing (`boxIsEmpty`). */
  isEmpty() {
    return boxIsEmpty(this.toFlat(flat), 0)
  }
  /** Takes the corners of another box. */
  copy(b: Box3) {
    return this.set(b.min, b.max)
  }
  /** A new box with the same corners. */
  clone() {
    return new Box3().copy(this)
  }
  /** Grows the box just enough to hold a point. */
  expandByPoint(p: XYZ) {
    boxExpandByPoint(this.toFlat(flat), 0, p.x, p.y, p.z)
    return this.written()
  }
  /** Grows the box by `s` on every side. */
  expandByScalar(s: number) {
    boxGrow(flat, 0, this.toFlat(flat), 0, s)
    return this.written()
  }
  /** Grows the box to hold another box too. */
  union(b: Box3) {
    boxUnion(this.toFlat(flat), 0, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z)
    return this.written()
  }
  /** The smallest box around a flat list of coordinates: every whole point, one each `itemSize`
   *  numbers. */
  setFromArray(array: ArrayLike<number>, itemSize = 3) {
    const count = array.length < 3 ? 0 : Math.floor((array.length - 3) / itemSize) + 1
    boxFromPoints(flat, 0, array, 0, count, itemSize)
    return this.written()
  }
  /** The smallest box around a list of points. */
  setFromPoints(points: XYZ[]) {
    boxEmpty(flat, 0)
    for (const p of points) boxExpandByPoint(flat, 0, p.x, p.y, p.z)
    return this.written()
  }
  /** The world box of everything under `node`, each content's box carried by its world matrix. */
  setFromObject(node: BoundedNode) {
    this.makeEmpty()
    node.updateMatrixWorld(true)
    node.traverse((child) => {
      const local = child.localBounds?.()
      if (local && !local.isEmpty()) this.union(local.clone().applyMatrix4(child.matrixWorld))
    })
    return this
  }
  /** Moves the box by a matrix and keeps it lined up with the axes. */
  applyMatrix4(m: Matrix4) {
    boxTransform(flat, 0, this.toFlat(flat), 0, m.elements)
    return this.written()
  }
  /** The middle of the box (`boxCenter`); an empty box's is the origin. */
  getCenter(out = new Vector3()) {
    if (this.isEmpty()) return out.set(0, 0, 0)
    const { min, max } = this
    boxCenter(flat, 0, min.x, min.y, min.z, max.x, max.y, max.z)
    return out.set(flat[0], flat[1], flat[2])
  }
  /** How wide, tall and deep the box is. */
  getSize(out = new Vector3()) {
    return this.isEmpty() ? out.set(0, 0, 0) : out.subVectors(this.max, this.min)
  }
  /** Whether a point is inside the box, its faces included (`boxContainsPoint`). */
  containsPoint(p: XYZ) {
    return boxContainsPoint(this.toFlat(flat), 0, p.x, p.y, p.z)
  }
  /** Whether two boxes overlap, touching faces included (`boxesOverlap`). */
  intersectsBox(b: Box3) {
    return boxesOverlap(this.toFlat(flat), 0, b.toFlat(other), 0)
  }
  /** The sphere through the corners (`sphereFromBounds`); an empty box gives radius −1. */
  getBoundingSphere<T extends { center: Vector3; radius: number }>(out: T): T {
    const { min, max } = this
    sphereFromBounds(flat, 0, min.x, min.y, min.z, max.x, max.y, max.z)
    out.center.set(flat[0], flat[1], flat[2])
    out.radius = flat[3]
    return out
  }
  /** Whether two boxes have the same corners. */
  equals(b: Box3) {
    return this.min.equals(b.min) && this.max.equals(b.max)
  }
  /** The six bounds written flat into `into`, min then max. */
  private toFlat(into: Float64Array) {
    into[0] = this.min.x
    into[1] = this.min.y
    into[2] = this.min.z
    into[3] = this.max.x
    into[4] = this.max.y
    into[5] = this.max.z
    return into
  }
  /** The six bounds of `flat` written back into the corners. */
  private written() {
    this.min.set(flat[0], flat[1], flat[2])
    this.max.set(flat[3], flat[4], flat[5])
    return this
  }
}
