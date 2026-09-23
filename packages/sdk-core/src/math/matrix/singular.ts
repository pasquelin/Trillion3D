/**
 * THE ENGINE "SINGULAR MATRIX" RULE, written once, for the CPU AND for the GPU.
 *
 * THE FACT. A transform is singular when it collapses space: its determinant vanishes.
 * Testing it on the RAW determinant says nothing, because a determinant carries scale cubed.
 * A uniform-scale rotation `s` has determinant ±s³: at `s = 1e-7`, perfectly regular,
 * the raw determinant is 1e-21 and falls under any absolute threshold; at `s = 1e7`, equally
 * regular, it is 1e21. An absolute threshold therefore judges scale, never degeneracy.
 *
 * THE RULE, in one sentence. The linear part is divided by the sum of the absolute values of its
 * nine terms — its scale — BEFORE the determinant; it is singular when this normalised
 * determinant does not exceed `SINGULAR_DETERMINANT`. A zero, infinite or NaN scale is singular:
 * the division then yields nothing.
 *
 * WHERE IT APPLIES. `normalMatrix3` (`matrix3.ts`) on the CPU, `invTranspose3Prep`
 * (`packages/sdk-browser/src/math/inverseTransposeWgsl.ts`) on the GPU, which inserts `SINGULAR_DETERMINANT_WGSL`
 * into its text instead of rewriting the number. Both decide the same thing, each in its
 * precision: the CPU in double, the GPU in single. What a singular matrix BECOMES — the
 * flattened-normal convention — is written once, in `inverseTransposeWgsl.ts`.
 *
 * WHAT IT DOES NOT COVER. `invertMatrix4` (`matrix4Inverse.ts`) is the full 4×4 inverse, held
 * to the bits of the reference 3D library, `det === 0` threshold included; it transports no
 * normal, and its contract is parity with the reference, not this rule.
 */

/**
 * The threshold, on the NORMALISED determinant. Under 1e-12, the cube of a scale becomes denormal in
 * single precision: only normalisation crosses that floor, so this threshold no longer judges
 * anything but the shape of the matrix, never its size.
 */
export const SINGULAR_DETERMINANT = 1e-20;

/** The threshold as WGSL writes it, rendered from the constant: one number, two languages. */
export const SINGULAR_DETERMINANT_WGSL = SINGULAR_DETERMINANT.toExponential();

/**
 * The SCALE of a linear part: the sum of the absolute values of the nine terms of the 3×3 block of a
 * column-major 4×4. This is the normalisation divisor, and the same sum the conformance
 * test reads (`packages/sdk-browser/src/page/cone/cone.ts`): one sum, one term order.
 */
export function linearPartScale(m: ArrayLike<number>) {
  return (
    Math.abs(m[0]) +
    Math.abs(m[1]) +
    Math.abs(m[2]) +
    Math.abs(m[4]) +
    Math.abs(m[5]) +
    Math.abs(m[6]) +
    Math.abs(m[8]) +
    Math.abs(m[9]) +
    Math.abs(m[10])
  );
}

/**
 * Determinant of the NORMALISED linear part, in the WGSL kernel order: the three columns
 * divided by the scale, then `a · (b × c)`. Columns are divided BEFORE the product, never the
 * raw determinant divided by the cube of the scale: `t³` overflows beyond 1e103 and vanishes under
 * 1e-103, which is exactly where this rule is meant to decide. A zero, infinite
 * or NaN scale yields `NaN`, which no `> threshold` comparison accepts.
 */
export function normalizedLinearDeterminant(m: ArrayLike<number>) {
  const t = linearPartScale(m);
  if (!(t > 0) || !Number.isFinite(t)) return NaN;
  const a0 = m[0] / t,
    a1 = m[1] / t,
    a2 = m[2] / t;
  const b0 = m[4] / t,
    b1 = m[5] / t,
    b2 = m[6] / t;
  const c0 = m[8] / t,
    c1 = m[9] / t,
    c2 = m[10] / t;
  return a0 * (b1 * c2 - b2 * c1) + a1 * (b2 * c0 - b0 * c2) + a2 * (b0 * c1 - b1 * c0);
}

/**
 * THE DECISION, in the very form of the WGSL kernel (`invTranspose3Prep`): the factor that multiplies
 * the adjugate of the linear part.
 *
 *  — `1 / determinant`, the matrix is REGULAR: the inverse-transpose, at the reference bits.
 *    The passed determinant is the RAW determinant the caller already has; only the decision reads the
 *    normalised determinant, so a regular matrix yields exactly what it used to.
 *  — `1`, the matrix is SINGULAR: the adjugate as-is, with no factor — it would be ±∞. This is
 *    the cross product of the transformed edges, up to a positive factor the consumer
 *    erases by normalising. An EXACTLY ZERO raw determinant lands here too, even when the shape
 *    is regular: the sum of its six products can cancel by compensation where the normalised
 *    version does not, and a zero divisor yields nothing usable. This is the case
 *    the engine already treated this way, adjugate aside, and it remains treated this way — the GPU,
 *    which divides by the NORMALISED determinant, does not have this case and then yields the
 *    inverse-transpose.
 *  — `null`, the scale is neither finite nor strictly positive: the adjugate itself is no longer
 *    worth anything and must be REPLACED by zero, like the kernel's `select(z, cross(…), finite)`.
 *    A NaN term is not fixed by multiplying it by zero, hence `null` rather than a zero factor.
 */
export function adjugateFactor(m: ArrayLike<number>, determinant: number) {
  const normalized = normalizedLinearDeterminant(m);
  if (Number.isNaN(normalized)) return null;
  if (determinant === 0 || !(Math.abs(normalized) > SINGULAR_DETERMINANT)) return 1;
  return 1 / determinant;
}
