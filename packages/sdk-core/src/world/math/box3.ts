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
  boxUnionBox,
} from '../../../../math/src/geometry/box.ts'
import { sphereFromBounds } from '../../../../math/src/geometry/sphere.ts'
import { Vector3 } from './vector3.ts'
import type { Matrix4 } from './matrix4.ts'
import type { XYZLike } from './likes.ts'

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
  /** A node drawn at several placements: one matrix of sixteen numbers each in `instanceMatrix`,
   *  `count` of them drawn. */
  readonly instanceMatrix?: { readonly array: Float32Array; readonly count: number }
  readonly count?: number
  /** A node bent by bones: where each stands in the world reaches the box too. */
  readonly skeleton?: { readonly bones: readonly { readonly matrixWorld: Matrix4 }[] }
}

/** How many placements of a node drawn at several are drawn: its `count`, within the matrices it holds. */
export const drawnCount = (node: {
  readonly count?: number
  readonly instanceMatrix: { readonly count: number }
}) => Math.min(node.count ?? node.instanceMatrix.count, node.instanceMatrix.count)

/** One placement's matrix, copied out of the instance array to be read as the transform's. */
const placement = new Float64Array(16)

/** The six bounds of a box, flat, for the core box functions; `other` holds a second box. */
const flat = new Float64Array(6),
  other = new Float64Array(6),
  point = new Float64Array(6)

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
  set(min: XYZLike, max: XYZLike) {
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
    return boxIsEmpty(boxToFlat(this, flat), 0)
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
  expandByPoint(p: XYZLike) {
    boxExpandByPoint(boxToFlat(this, flat), 0, p.x, p.y, p.z)
    return boxFromFlat(this, flat)
  }
  /** Grows the box by `s` on every side. */
  expandByScalar(s: number) {
    boxGrow(flat, 0, boxToFlat(this, flat), 0, s)
    return boxFromFlat(this, flat)
  }
  /** Grows the box to hold another box too. */
  union(b: Box3) {
    return this.unionFlat(boxToFlat(b, other))
  }
  /** Grows the box to hold the six bounds of a flat box. */
  private unionFlat(b: ArrayLike<number>) {
    boxUnionBox(boxToFlat(this, flat), 0, b)
    return boxFromFlat(this, flat)
  }
  /** The smallest box around a flat list of coordinates: every whole point, one each `itemSize`
   *  numbers. */
  setFromArray(array: ArrayLike<number>, itemSize = 3) {
    const count = array.length < 3 ? 0 : Math.floor((array.length - 3) / itemSize) + 1
    boxFromPoints(flat, 0, array, 0, count, itemSize)
    return boxFromFlat(this, flat)
  }
  /** The smallest box around a list of points. */
  setFromPoints(points: XYZLike[]) {
    boxEmpty(flat, 0)
    for (const p of points) boxExpandByPoint(flat, 0, p.x, p.y, p.z)
    return boxFromFlat(this, flat)
  }
  /** The world box of everything under `node`, each content's box carried by its world matrix. */
  setFromObject(node: BoundedNode) {
    this.makeEmpty()
    node.updateMatrixWorld(true)
    node.traverse((child) => {
      const local = child.localBounds?.()
      if (local && !local.isEmpty()) {
        const { instanceMatrix } = child
        if (instanceMatrix) {
          const placed = drawnCount({ count: child.count, instanceMatrix }),
            matrices = instanceMatrix.array
          for (let at = 0; at < placed; at++) {
            for (let i = 0; i < 16; i++) placement[i] = matrices[16 * at + i]
            boxTransform(other, 0, boxToFlat(local, other), 0, placement)
            boxTransform(other, 0, other, 0, child.matrixWorld.elements)
            this.unionFlat(other)
          }
        } else {
          boxTransform(other, 0, boxToFlat(local, other), 0, child.matrixWorld.elements)
          this.unionFlat(other)
        }
        for (const bone of child.skeleton?.bones ?? []) {
          const e = bone.matrixWorld.elements
          point[0] = point[3] = e[12]
          point[1] = point[4] = e[13]
          point[2] = point[5] = e[14]
          this.unionFlat(point)
        }
      }
    })
    return this
  }
  /** Moves the box by a matrix and keeps it lined up with the axes. */
  applyMatrix4(m: Matrix4) {
    boxTransform(flat, 0, boxToFlat(this, flat), 0, m.elements)
    return boxFromFlat(this, flat)
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
  containsPoint(p: XYZLike) {
    return boxContainsPoint(boxToFlat(this, flat), 0, p.x, p.y, p.z)
  }
  /** Whether two boxes overlap, touching faces included (`boxesOverlap`). */
  intersectsBox(b: Box3) {
    return boxesOverlap(boxToFlat(this, flat), 0, boxToFlat(b, other), 0)
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
}

/** The six bounds of `box` written flat into `into`, min then max: not on the SDK's facade
 *  (`index.ts` names `Box3` alone). */
export function boxToFlat(box: Box3, into: Float64Array) {
  into[0] = box.min.x
  into[1] = box.min.y
  into[2] = box.min.z
  into[3] = box.max.x
  into[4] = box.max.y
  into[5] = box.max.z
  return into
}

/** `box`'s corners from the six bounds of `from`, min then max. */
export function boxFromFlat<T extends Box3>(box: T, from: ArrayLike<number>) {
  box.min.set(from[0], from[1], from[2])
  box.max.set(from[3], from[4], from[5])
  return box
}
