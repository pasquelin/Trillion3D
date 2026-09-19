import { IDENTITY_MATRIX4, copyMatrix4, determinantMatrix4 } from './mathMatrix4.ts';
import { invertMatrix4 } from './mathMatrix4Inverse.ts';
import { normalMatrix3 } from './mathMatrix3.ts';
import { decomposeMatrix4 } from './mathMatrix4Trs.ts';

/** Floats of a 3×3 normal matrix. */
export const NORMAL_MATRIX_VALUES = 9;

/**
 * Inverts `n` 4×4 matrices in batch: `out[i] = mats[i]⁻¹`.
 *
 * If a matrix is singular according to the engine singularity rule (`mathSingular.ts`),
 * it writes the identity matrix to `out[i]` and sets `singular[i] = 1` (if provided),
 * never throwing mid-batch.
 *
 * Repeats `invertMatrix4`. Replaces Three.js loop: `for … m.invert()`.
 */
export function invertMatrix4Batch(
  out: readonly Float64Array[],
  mats: readonly ArrayLike<number>[],
  n: number,
  singular?: Uint8Array,
): void {
  for (let i = 0; i < n; i++) {
    const dst = out[i];
    // `invertMatrix4` yields the zero matrix on an exactly zero determinant and states that the
    // caller reads the determinant, never the output: a regular inverse may hold those four zeros.
    const zero = determinantMatrix4(mats[i]) === 0;
    if (zero) copyMatrix4(dst, IDENTITY_MATRIX4);
    else invertMatrix4(dst, mats[i]);
    if (singular) singular[i] = zero ? 1 : 0;
  }
}

/**
 * Computes `n` 3×3 normal matrices from 4×4 matrices: `out[i] = transpose(inverse(mats[i]))`.
 * `out` is flat with 9 floats per element.
 *
 * Repeats `normalMatrix3`. Replaces Three.js loop: `for … normalMatrix.getNormalMatrix(m)`.
 */
export function normalMatrix3Batch(
  out: Float64Array,
  mats: readonly ArrayLike<number>[],
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    normalMatrix3(out, mats[i], i * NORMAL_MATRIX_VALUES);
  }
}

export { composeMatrix4Batch } from './mathMatrix4Compose.ts';

/**
 * Decomposes `n` 4×4 matrices into positions, quaternions and scales.
 *
 * Repeats `decomposeMatrix4`. Replaces Three.js loop: `for … m.decompose(p, q, s)`.
 */
export function decomposeMatrix4Batch(
  positions: readonly Float64Array[],
  quaternions: readonly Float64Array[],
  scales: readonly Float64Array[],
  mats: readonly ArrayLike<number>[],
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    decomposeMatrix4(mats[i], positions[i], quaternions[i], scales[i]);
  }
}
