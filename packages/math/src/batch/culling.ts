import { BOX_VALUES } from '../geometry/box.ts'
import { sphereFromBounds } from '../geometry/sphere.ts'
import { SPHERE_VALUES } from './strides.ts'

/** Whether the plane `a·x + b·y + c·z + d ≥ 0` leaves the box behind: its most forward corner,
 *  picked per axis by the sign of the normal (`a > 0 ? max : min`, NaN picking min), lies below
 *  it — `frustumExcludesBox`'s test of one plane, its products in their order. The batch repeats it
 *  on purpose (docs/MATHS.md); `frustumExcludesBox` keeps it written in its loop, where this call
 *  measured 3 % slower, and the batch calling box.ts's `leadingDistance` 1 to 3 % slower. */
// jscpd:ignore-start
function planeExcludes(
  a: number,
  b: number,
  c: number,
  d: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  return a * (a > 0 ? maxX : minX) + b * (b > 0 ? maxY : minY) + c * (c > 0 ? maxZ : minZ) + d < 0
}
// jscpd:ignore-end

/**
 * Tests `n` bounding boxes against the six frustum planes (24 floats), and writes what is KEPT:
 * `kept[i]` is 1 where the box intersects the frustum or sits inside it, 0 where it is excluded.
 * Returns how many were kept. The name says keep because that is what the array holds — it
 * repeats `frustumExcludesBox` negated: true means the box is kept, false means it is excluded.
 */
export function frustumKeepsBoxBatch(
  kept: Uint8Array,
  planes: Float64Array,
  boxes: ArrayLike<number>,
  n: number,
): number {
  // The 24 plane values, read once before the loop; then `frustumExcludesBox` per box, its
  // `planeExcludes` on each plane in slot order until one excludes: the same products in the same
  // order. `kept` does not share memory with `planes`.
  const a0 = planes[0],
    b0 = planes[1],
    c0 = planes[2],
    d0 = planes[3],
    a1 = planes[4],
    b1 = planes[5],
    c1 = planes[6],
    d1 = planes[7],
    a2 = planes[8],
    b2 = planes[9],
    c2 = planes[10],
    d2 = planes[11],
    a3 = planes[12],
    b3 = planes[13],
    c3 = planes[14],
    d3 = planes[15],
    a4 = planes[16],
    b4 = planes[17],
    c4 = planes[18],
    d4 = planes[19],
    a5 = planes[20],
    b5 = planes[21],
    c5 = planes[22],
    d5 = planes[23]
  let count = 0
  for (let i = 0; i < n; i++) {
    const at = i * BOX_VALUES
    const minX = boxes[at],
      minY = boxes[at + 1],
      minZ = boxes[at + 2],
      maxX = boxes[at + 3],
      maxY = boxes[at + 4],
      maxZ = boxes[at + 5]
    const excluded =
      planeExcludes(a0, b0, c0, d0, minX, minY, minZ, maxX, maxY, maxZ) ||
      planeExcludes(a1, b1, c1, d1, minX, minY, minZ, maxX, maxY, maxZ) ||
      planeExcludes(a2, b2, c2, d2, minX, minY, minZ, maxX, maxY, maxZ) ||
      planeExcludes(a3, b3, c3, d3, minX, minY, minZ, maxX, maxY, maxZ) ||
      planeExcludes(a4, b4, c4, d4, minX, minY, minZ, maxX, maxY, maxZ) ||
      planeExcludes(a5, b5, c5, d5, minX, minY, minZ, maxX, maxY, maxZ)
    kept[i] = excluded ? 0 : 1
    if (!excluded) count++
  }
  return count
}

/**
 * Computes bounding spheres for `n` boxes. `out` receives 4 floats per element
 * (centre x, y, z, radius).
 *
 * `sphereFromBounds` of each of the `n` boxes.
 */
export function sphereFromBoundsBatch(
  out: Float64Array,
  boxes: ArrayLike<number>,
  n: number,
): void {
  // The six bounds are passed before the four writes, so `out` may be `boxes`.
  for (let i = 0; i < n; i++) {
    const src = i * BOX_VALUES
    sphereFromBounds(
      out,
      i * SPHERE_VALUES,
      boxes[src],
      boxes[src + 1],
      boxes[src + 2],
      boxes[src + 3],
      boxes[src + 4],
      boxes[src + 5],
    )
  }
}
