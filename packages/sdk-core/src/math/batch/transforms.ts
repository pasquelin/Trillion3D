import { IDENTITY_MATRIX4, copyMatrix4, determinantMatrix4 } from '../matrix/matrix4.ts';
import { invertMatrix4 } from '../matrix/matrix4Inverse.ts';
import { normalMatrix3 } from '../matrix/matrix3.ts';
import { decomposeMatrix4 } from '../matrix/matrix4Trs.ts';
import { NORMAL_MATRIX_VALUES } from './strides.ts';

/**
 * Inverts `n` 4×4 matrices: `out[i] = mats[i]⁻¹`. Replaces Three's `for … m.invert()`.
 *
 * THE ONE PLACE THIS BATCH DOES NOT REPEAT ITS UNIT FUNCTION. `invertMatrix4` answers an exactly
 * zero determinant with the zero matrix, like the reference; this batch answers it with the
 * IDENTITY, so a caller that walks `out` without looking further multiplies by something
 * harmless instead of collapsing its scene. The substitution happens whether or not `singular`
 * is passed — the flag only tells you which elements it happened to, and a caller that must
 * distinguish them passes it.
 *
 * The test is `determinantMatrix4(mats[i]) === 0`, not the engine singularity rule: that rule
 * (`../matrix/singular.ts:21`) states it governs where a normal is transported and explicitly not the
 * inverse, whose threshold is parity with the reference. It reads the determinant rather than the
 * result because `invertMatrix4`'s own contract forbids reading its output — a regular inverse
 * may hold zeros where a singular one does.
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

export { composeMatrix4Batch } from '../matrix/matrix4Compose.ts';

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
