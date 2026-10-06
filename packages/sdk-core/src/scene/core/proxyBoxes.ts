import { PROXY_TRIANGLE_FLOATS } from '../../contracts/proxy.ts'

// Apart from the refit: occupancy reads it from the core index, and the refit's rounding scratch
// must not ride into every bundle that imports the index.
/** Canonical bounds of each proxy triangle, six per triangle: what a still pose covers. */
export function proxyTriangleBoxes(triangles: Float32Array) {
  const boxes = new Float64Array((triangles.length / PROXY_TRIANGLE_FLOATS) * 6)
  for (let t = 0; t < boxes.length / 6; t++)
    for (let a = 0; a < 3; a++) {
      const base = t * PROXY_TRIANGLE_FLOATS + a
      const x = triangles[base],
        y = triangles[base + 3],
        z = triangles[base + 6]
      boxes[t * 6 + a] = Math.min(x, y, z)
      boxes[t * 6 + a + 3] = Math.max(x, y, z)
    }
  return boxes
}

/**
 * `extent` = the bounds of the first `count` boxes (zeros when there are no boxes), in one pass
 * with six accumulators: min and max are exact and order-free, NaN and signed zeros included, so it
 * is the per-axis passes' result to the bit.
 */
export function proxyBoxesExtent(boxes: Float64Array, count: number, extent: number[]) {
  extent.fill(0)
  if (!boxes.length) return
  let x0 = Infinity,
    y0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    z1 = -Infinity
  for (let b = 0; b < count * 6; b += 6) {
    x0 = Math.min(x0, boxes[b])
    y0 = Math.min(y0, boxes[b + 1])
    z0 = Math.min(z0, boxes[b + 2])
    x1 = Math.max(x1, boxes[b + 3])
    y1 = Math.max(y1, boxes[b + 4])
    z1 = Math.max(z1, boxes[b + 5])
  }
  extent[0] = x0
  extent[1] = y0
  extent[2] = z0
  extent[3] = x1
  extent[4] = y1
  extent[5] = z1
}
