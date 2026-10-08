import type { NumberSink } from '../matrix/matrix4.ts'
import { crossVector3, length3 } from '../vector/vector.ts'

/** The two edges from the first corner, `b − a` then `c − a`, reused within a call. */
const EDGES = new Float64Array(6)
/** The cross product `triangleArea` measures, reused within a call. */
const CROSS = new Float64Array(3)

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
  EDGES[0] = v[b] - v[a]
  EDGES[1] = v[b + 1] - v[a + 1]
  EDGES[2] = v[b + 2] - v[a + 2]
  EDGES[3] = v[c] - v[a]
  EDGES[4] = v[c + 1] - v[a + 1]
  EDGES[5] = v[c + 2] - v[a + 2]
  return crossVector3(out, EDGES, EDGES, o, 0, 3)
}

/** The triangle's area, `length3(triangleCross) / 2`, corners read as `triangleCross` reads them:
 *  `triangle_area` of the Rust crate, whose plain root `length3` holds inside its normal band. */
export function triangleArea(v: ArrayLike<number>, a: number, b: number, c: number) {
  triangleCross(CROSS, 0, v, a, b, c)
  return length3(CROSS[0], CROSS[1], CROSS[2]) / 2
}
