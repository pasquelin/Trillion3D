import { BOX_VALUES } from '../geometry/box.ts'
import { length3 } from '../vector/vector.ts'
import { SPHERE_VALUES } from './strides.ts'

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
  // `frustumExcludesBox` written in the loop: the same products in the same order.
  let count = 0
  for (let i = 0; i < n; i++) {
    const at = i * BOX_VALUES
    const minX = boxes[at],
      minY = boxes[at + 1],
      minZ = boxes[at + 2],
      maxX = boxes[at + 3],
      maxY = boxes[at + 4],
      maxZ = boxes[at + 5]
    let excluded = false
    for (let p = 0; p < 24; p += 4) {
      const a = planes[p],
        b = planes[p + 1],
        c = planes[p + 2],
        d = planes[p + 3]
      if (
        a * (a > 0 ? maxX : minX) + b * (b > 0 ? maxY : minY) + c * (c > 0 ? maxZ : minZ) + d <
        0
      ) {
        excluded = true
        break
      }
    }
    kept[i] = excluded ? 0 : 1
    if (!excluded) count++
  }
  return count
}

/**
 * Computes bounding spheres for `n` boxes. `out` receives 4 floats per element
 * (centre x, y, z, radius).
 *
 * Repeats `sphereFromBounds`. Loops over `n` boxes.
 */
export function sphereFromBoundsBatch(
  out: Float64Array,
  boxes: ArrayLike<number>,
  n: number,
): void {
  // `sphereFromBounds` written in the loop; the six bounds are read before the four writes, so
  // `out` may be `boxes`.
  for (let i = 0; i < n; i++) {
    const src = i * BOX_VALUES,
      o = i * SPHERE_VALUES
    const minX = boxes[src],
      minY = boxes[src + 1],
      minZ = boxes[src + 2],
      maxX = boxes[src + 3],
      maxY = boxes[src + 4],
      maxZ = boxes[src + 5]
    if (maxX < minX || maxY < minY || maxZ < minZ) {
      out[o] = 0
      out[o + 1] = 0
      out[o + 2] = 0
      out[o + 3] = -1
      continue
    }
    out[o] = (minX + maxX) * 0.5
    out[o + 1] = (minY + maxY) * 0.5
    out[o + 2] = (minZ + maxZ) * 0.5
    out[o + 3] = length3(maxX - minX, maxY - minY, maxZ - minZ) * 0.5
  }
}
