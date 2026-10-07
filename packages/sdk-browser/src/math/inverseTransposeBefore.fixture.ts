import { inverseTransposeKernel } from './inverseTransposeKernel.ts'

/**
 * Prepare with the absolute-threshold guard: absolute threshold `abs(det)<1e-20` on the RAW 3×3,
 * and factor `1/det` instead of `1/(det·t)`. `regular` is the exact negation of that guard, the one
 * that returned the vector as-is — hence the same decision, case for case, NaN included. Its
 * number is written by hand and stays: it is a DEAD RULE, on the raw determinant, which the
 * shared constant must not follow if it moves — otherwise the reproduction would stop reproducing.
 */
const PREP_BEFORE_DEFECT_6 = ` let a=m[0];let b=m[1];let c=m[2];
 let det=dot(a,cross(b,c));
 return InvT3(mat3x3f(cross(b,c),cross(c,a),cross(a,b)),1.0/det,!(abs(det)<1e-20));`

/**
 * The same kernel with the absolute-threshold prepare, TO REPLAY THE DEFECT ONLY: no
 * production shader inserts it, so it is test code. Its fallback remains the LOCAL vector `v` —
 * that was the defect, and a reproduction that adopted the shipped convention would reproduce
 * nothing. It shares the shipped kernel's text (`inverseTransposeKernel.ts`) rather than a copy in
 * a bench: only the prepare and the fallback differ, so a kernel change moves both, where a pasted
 * copy would stop matching the first kernel change — without anyone seeing it. The whole block substitutes for the shipped
 * block, structure included, and `tests/gpu/math/substitutionBefore.ts` establishes the
 * substitution instead of hoping for it. A reproduction is only worth as long as it
 * reproduces: GPU actually executed, and measured against what the engine DRAWS (real
 * rasterisation, face state included), this form drops 656 drawn clusters over 6 916 cases
 * where the shipped form drops none (`tests/gpu/math/inverse-transpose-small-scale.gpu.ts`).
 * The "560 before, 54 after" of an earlier sample read raw geometric orientation, which
 * ignores face swap under reflection: it counted 119 legitimate rejects as defects and missed
 * 215.
 */
export const INVERSE_TRANSPOSE_BEFORE_WGSL = inverseTransposeKernel(PREP_BEFORE_DEFECT_6, 'v')
