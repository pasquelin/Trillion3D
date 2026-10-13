import type { NumberSink } from '../matrix/matrix4.ts'
import { writeCrossVector3 } from '../vector/vector.ts'

/**
 * The triangle's edge cross product, `(b − a) × (c − a)`, into `out[o..o + 2]`: its normal by its
 * winding, twice its area long, zero for a degenerate triangle. The corners are read at `v[a]`,
 * `v[b]` and `v[c]` (three numbers each), the edges taken from the first corner, then
 * `crossVector3`. `triangle_cross` of `packages/math/rust/src/triangle.rs`.
 */
export function triangleCross<T extends NumberSink>(
  out: T,
  o: number,
  v: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
) {
  // The corners and both edges in locals, every corner read before the one write: `out` may be `v`.
  const ax = v[a],
    ay = v[a + 1],
    az = v[a + 2]
  writeCrossVector3(
    out,
    o,
    v[b] - ax,
    v[b + 1] - ay,
    v[b + 2] - az,
    v[c] - ax,
    v[c + 1] - ay,
    v[c + 2] - az,
  )
  return out
}
