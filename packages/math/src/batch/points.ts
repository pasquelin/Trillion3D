import { normalizeVector3, transformAffinePoint } from '../vector/vector.ts'
import { POSITION_VALUES } from './strides.ts'

/**
 * Transforms `n` 3D points by a single 4×4 affine matrix: `out[i] = m · points[i]`.
 * `points` and `out` are stored flat with 3 floats per element.
 *
 * Repeats `transformAffinePoint`.
 */
export function transformPointsBatch(
  out: Float64Array | Float32Array,
  m: ArrayLike<number>,
  points: ArrayLike<number>,
  n: number,
): void {
  // The unit's twelve values of `m`, read once before the loop; `out` may be `points`.
  const m0 = m[0],
    m1 = m[1],
    m2 = m[2],
    m4 = m[4],
    m5 = m[5],
    m6 = m[6],
    m8 = m[8],
    m9 = m[9],
    m10 = m[10],
    m12 = m[12],
    m13 = m[13],
    m14 = m[14]
  for (let i = 0; i < n; i++) {
    const at = i * POSITION_VALUES
    const x = points[at],
      y = points[at + 1],
      z = points[at + 2]
    out[at] = m0 * x + m4 * y + m8 * z + m12
    out[at + 1] = m1 * x + m5 * y + m9 * z + m13
    out[at + 2] = m2 * x + m6 * y + m10 * z + m14
  }
}

/**
 * Transforms `n` 3D points by `n` corresponding 4×4 affine matrices: `out[i] = mats[i] · points[i]`.
 * Useful for per-instance vertex transforms.
 *
 * Repeats `transformAffinePoint`.
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
 * Repeats `transformDirectionVector3`.
 */
export function transformDirectionsBatch(
  out: Float64Array,
  m: ArrayLike<number>,
  dirs: ArrayLike<number>,
  n: number,
): void {
  // The unit's nine values of `m`, read once before the loop; `out` may be `dirs`.
  const m0 = m[0],
    m1 = m[1],
    m2 = m[2],
    m4 = m[4],
    m5 = m[5],
    m6 = m[6],
    m8 = m[8],
    m9 = m[9],
    m10 = m[10]
  for (let i = 0; i < n; i++) {
    const at = i * POSITION_VALUES
    const x = dirs[at],
      y = dirs[at + 1],
      z = dirs[at + 2]
    out[at] = m0 * x + m4 * y + m8 * z
    out[at + 1] = m1 * x + m5 * y + m9 * z
    out[at + 2] = m2 * x + m6 * y + m10 * z
    normalizeVector3(out, at)
  }
}
