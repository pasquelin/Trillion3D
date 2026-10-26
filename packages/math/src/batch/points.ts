import {
  transformAffinePoint,
  transformDirectionRowOf,
  transformPointRowOf,
  writeNormalizedVector3,
} from '../vector/vector.ts'
import { POSITION_VALUES } from './strides.ts'

/**
 * Transforms `n` 3D points by a single 4×4 affine matrix: `out[i] = m · points[i]`.
 * `points` and `out` are stored flat with 3 floats per element.
 *
 * `transformAffinePoint` of each point, the matrix read once into locals. Each element's three
 * numbers are read before its writes, so `out` may be `points`. A loop of its own, not a test per
 * element (measured 2× slower), nor one body for the points and the directions
 * (`transformDirectionsBatch`): the directions deoptimised once both forms had run.
 */
export function transformPointsBatch(
  out: Float64Array | Float32Array,
  m: ArrayLike<number>,
  points: ArrayLike<number>,
  n: number,
): void {
  // The matrix read once into locals, spelled out in each batch: a shared reader would hand the
  // values back through memory, not registers (docs/MATHS.md, batch conventions).
  // jscpd:ignore-start
  const m0 = m[0],
    m1 = m[1],
    m2 = m[2]
  const m4 = m[4],
    m5 = m[5],
    m6 = m[6]
  const m8 = m[8],
    m9 = m[9],
    m10 = m[10]
  // jscpd:ignore-end
  const m12 = m[12],
    m13 = m[13],
    m14 = m[14]
  for (let i = 0; i < n; i++) {
    const at = i * POSITION_VALUES
    const x = points[at],
      y = points[at + 1],
      z = points[at + 2]
    out[at] = transformPointRowOf(m0, m4, m8, m12, x, y, z)
    out[at + 1] = transformPointRowOf(m1, m5, m9, m13, x, y, z)
    out[at + 2] = transformPointRowOf(m2, m6, m10, m14, x, y, z)
  }
}

/**
 * Transforms `n` 3D points by `n` corresponding 4×4 affine matrices: `out[i] = mats[i] · points[i]`.
 * Useful for per-instance vertex transforms.
 *
 * `transformAffinePoint` of each point.
 */
export function transformPointsByMatricesBatch(
  out: Float64Array,
  mats: readonly ArrayLike<number>[],
  points: ArrayLike<number>,
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    const at = i * POSITION_VALUES
    transformAffinePoint(out, mats[i], points[at], points[at + 1], points[at + 2], at)
  }
}

/**
 * Transforms `n` direction vectors by the 3×3 linear block of a 4×4 matrix and normalizes:
 * `out[i] = normalize(m · dirs[i])`. Translation is ignored.
 *
 * `transformDirectionVector3` of each direction, the matrix read once into locals. Each element's
 * three numbers are read before its writes, so `out` may be `dirs`.
 */
export function transformDirectionsBatch(
  out: Float64Array,
  m: ArrayLike<number>,
  dirs: ArrayLike<number>,
  n: number,
): void {
  // The matrix read once into locals, spelled out in each batch: a shared reader would hand the
  // values back through memory, not registers (docs/MATHS.md, batch conventions).
  // jscpd:ignore-start
  const m0 = m[0],
    m1 = m[1],
    m2 = m[2]
  const m4 = m[4],
    m5 = m[5],
    m6 = m[6]
  const m8 = m[8],
    m9 = m[9],
    m10 = m[10]
  // jscpd:ignore-end
  for (let i = 0; i < n; i++) {
    const at = i * POSITION_VALUES
    const x = dirs[at],
      y = dirs[at + 1],
      z = dirs[at + 2]
    writeNormalizedVector3(
      out,
      at,
      transformDirectionRowOf(m0, m4, m8, x, y, z),
      transformDirectionRowOf(m1, m5, m9, x, y, z),
      transformDirectionRowOf(m2, m6, m10, x, y, z),
    )
  }
}
