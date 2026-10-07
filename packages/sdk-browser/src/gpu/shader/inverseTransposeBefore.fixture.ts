import {
  invTranspose3Apply,
  invTranspose3Prep,
} from '../../../../math/src/wgsl/inverseTranspose.ts'

/** The shipped kernel's two functions as a program holds them, each the maths library's
 *  declaration (`packages/math/src/wgsl/inverseTranspose.ts`): what the replay below substitutes,
 *  each where the program's assembly wrote it. */
export const INVERSE_TRANSPOSE_SHIPPED = {
  prep: invTranspose3Prep.text,
  apply: invTranspose3Apply.text,
}

/** The 3×3 inverse-transpose kernel's two functions, as they were written before the maths
 *  library held them (`packages/math/src/wgsl/inverseTranspose.ts`): `prep` computes the adjoint,
 *  the factor and whether the matrix is regular, `fallback` is what a singular one returns. The
 *  shipped kernel and the replay of the absolute-threshold defect below differ by these two only. */
const inverseTransposeKernel = (prep: string, fallback: string) => ({
  prep: `fn invTranspose3Prep(m:mat3x3f)->InvT3{
${prep}
}`,
  apply: `fn invTranspose3Apply(p:InvT3,v:vec3f)->vec3f{
 let carried=p.adj*v;
 return select(${fallback},p.scale*carried,p.regular);
}`,
})

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
 * nothing. Only the prepare and the fallback differ from the shipped kernel's text
 * (`inverseTransposeKernel`, `INVERSE_TRANSPOSE_SHIPPED`), and `inverseTranspose.test.ts` holds the
 * rest of both equal. Each function substitutes for the shipped one, and
 * `tests/gpu/math/substitutionBefore.ts` establishes the
 * substitution instead of hoping for it. A reproduction is only worth as long as it
 * reproduces: GPU actually executed, and measured against what the engine DRAWS (real
 * rasterisation, face state included), this form drops 656 drawn clusters over 6 916 cases
 * where the shipped form drops none (`tests/gpu/math/inverse-transpose-small-scale.gpu.ts`).
 * The "560 before, 54 after" of an earlier sample read raw geometric orientation, which
 * ignores face swap under reflection: it counted 119 legitimate rejects as defects and missed
 * 215.
 */
export const INVERSE_TRANSPOSE_BEFORE = inverseTransposeKernel(PREP_BEFORE_DEFECT_6, 'v')
