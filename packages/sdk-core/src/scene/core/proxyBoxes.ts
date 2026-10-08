import { boxEmpty, boxFromPoints, boxUnion } from '../../../../math/src/geometry/box.ts'
import { PROXY_TRIANGLE_FLOATS } from '../../contracts/proxy.ts'

// Apart from the refit: occupancy reads it from the core index, and the refit's rounding scratch
// must not ride into every bundle that imports the index.
/** Canonical bounds of each proxy triangle, six per triangle: what a still pose covers. */
export function proxyTriangleBoxes(triangles: Float32Array) {
  const boxes = new Float64Array((triangles.length / PROXY_TRIANGLE_FLOATS) * 6)
  for (let t = 0; t < boxes.length / 6; t++)
    boxFromPoints(boxes, t * 6, triangles, t * PROXY_TRIANGLE_FLOATS, 3, 3)
  return boxes
}

const scratch = new Float64Array(6)

/**
 * `extent` = the bounds of the first `count` boxes (zeros when there are no boxes), in one pass
 * with six accumulators: min and max are exact and order-free, NaN and signed zeros included, so it
 * is the per-axis passes' result to the bit.
 */
export function proxyBoxesExtent(boxes: Float64Array, count: number, extent: number[]) {
  extent.fill(0)
  if (!boxes.length) return
  boxEmpty(scratch, 0)
  for (let b = 0; b < count * 6; b += 6)
    boxUnion(
      scratch,
      0,
      boxes[b],
      boxes[b + 1],
      boxes[b + 2],
      boxes[b + 3],
      boxes[b + 4],
      boxes[b + 5],
    )
  for (let i = 0; i < 6; i++) extent[i] = scratch[i]
}
