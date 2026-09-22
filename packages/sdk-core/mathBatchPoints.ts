import { transformAffinePoint, transformDirectionVector3 } from './mathVector.ts';
import { POSITION_VALUES } from './mathBatchStrides.ts';

/**
 * Transforms `n` 3D points by a single 4×4 affine matrix: `out[i] = m · points[i]`.
 * `points` and `out` are stored flat with 3 floats per element.
 *
 * Repeats `transformAffinePoint`. Replaces Three.js loop: `for … v.applyMatrix4(m)`.
 */
export function transformPointsBatch(
  out: Float64Array | Float32Array,
  m: ArrayLike<number>,
  points: ArrayLike<number>,
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    const at = i * POSITION_VALUES;
    transformAffinePoint(out, m, points[at], points[at + 1], points[at + 2], at);
  }
}

/**
 * Transforms `n` 3D points by `n` corresponding 4×4 affine matrices: `out[i] = mats[i] · points[i]`.
 * Useful for per-instance vertex transforms.
 *
 * Repeats `transformAffinePoint`. Replaces Three.js loop: `for … v[i].applyMatrix4(mats[i])`.
 */
export function transformPointsByMatricesBatch(
  out: Float64Array,
  mats: readonly ArrayLike<number>[],
  points: ArrayLike<number>,
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    const at = i * POSITION_VALUES;
    transformAffinePoint(out, mats[i], points[at], points[at + 1], points[at + 2], at);
  }
}

/**
 * Transforms `n` direction vectors by the 3×3 linear block of a 4×4 matrix and normalizes:
 * `out[i] = normalize(m · dirs[i])`. Translation is ignored.
 *
 * Repeats `transformDirectionVector3`. Replaces Three.js loop: `for … v.transformDirection(m)`.
 */
export function transformDirectionsBatch(
  out: Float64Array,
  m: ArrayLike<number>,
  dirs: ArrayLike<number>,
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    const at = i * POSITION_VALUES;
    transformDirectionVector3(out, m, dirs[at], dirs[at + 1], dirs[at + 2], at);
  }
}
