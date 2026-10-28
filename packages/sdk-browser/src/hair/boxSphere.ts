import { boxGrow, boxTransform, boxUnionBox } from '../../../math/src/geometry/box.ts'
import { sphereFromBounds } from '../../../math/src/geometry/sphere.ts'
import { length3 } from '../../../math/src/vector/vector.ts'

/**
 * A bounding volume that is a box and a sphere about the same centre: the bounds of a groom, which
 * the macro groups gather by their spheres and the screen rectangle and the voxel box read by their
 * boxes. Lengths are metres, in doubles; the box is six numbers (`minX, minY, minZ, maxX, maxY,
 * maxZ`, `../../../math/src/geometry/box.ts`), the sphere four (the centre, then the radius).
 */
export interface BoxSphere {
  readonly box: Float64Array
  readonly sphere: Float64Array
}

/** The volume of the six bounds `box`, its sphere the one through its corners. */
export function boxSphereOf(box: ArrayLike<number>): BoxSphere {
  const volume = {
    box: Float64Array.from({ length: 6 }, (_, k) => box[k]!),
    sphere: new Float64Array(4),
  }
  sphereFromBounds(volume.sphere, 0, box[0]!, box[1]!, box[2]!, box[3]!, box[4]!, box[5]!)
  return volume
}

/** `out` as `bounds` grown by `amount` on every side: its box and its sphere. */
export function expandInto(out: BoxSphere, bounds: BoxSphere, amount: number) {
  boxGrow(out.box, 0, bounds.box, 0, amount)
  const { sphere } = bounds
  out.sphere[0] = sphere[0]!
  out.sphere[1] = sphere[1]!
  out.sphere[2] = sphere[2]!
  out.sphere[3] = sphere[3]! + amount
}

/**
 * `out` as the volume that holds both `a` and `b` (`out` may be either): the box of their boxes, and
 * the sphere about its centre that reaches both spheres, never larger than the one through the box's
 * corners.
 */
export function unionInto(out: BoxSphere, a: BoxSphere, b: BoxSphere) {
  const { box, sphere } = out
  const ax = a.sphere[0]!,
    ay = a.sphere[1]!,
    az = a.sphere[2]!,
    ar = a.sphere[3]!
  const bx = b.sphere[0]!,
    by = b.sphere[1]!,
    bz = b.sphere[2]!,
    br = b.sphere[3]!
  if (box === b.box) boxUnionBox(box, 0, a.box)
  else {
    if (box !== a.box) box.set(a.box)
    boxUnionBox(box, 0, b.box)
  }
  sphereFromBounds(sphere, 0, box[0]!, box[1]!, box[2]!, box[3]!, box[4]!, box[5]!)
  const reachOf = (x: number, y: number, z: number, radius: number) =>
    length3(x - sphere[0]!, y - sphere[1]!, z - sphere[2]!) + radius
  sphere[3] = Math.min(sphere[3]!, Math.max(reachOf(ax, ay, az, ar), reachOf(bx, by, bz, br)))
}

/** The box that holds the image of `box` by the column-major matrix `m` (an affine one). */
export function transformBox(box: ArrayLike<number>, m: ArrayLike<number>) {
  const moved = new Float64Array(6)
  boxTransform(moved, 0, box, 0, m)
  return moved
}

/** The greatest scale a column-major matrix gives an axis: the longest of its three axis columns. */
export const maximumAxisScale = (m: ArrayLike<number>) =>
  Math.max(
    length3(m[0]!, m[1]!, m[2]!),
    length3(m[4]!, m[5]!, m[6]!),
    length3(m[8]!, m[9]!, m[10]!),
  )
