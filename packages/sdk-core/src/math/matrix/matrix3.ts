import type { NumberSink } from './matrix4.ts';
import { adjugateFactor } from './singular.ts';

/**
 * `out = transpose(inverse(3×3 block of m))`, column-major on nine numbers: the matrix that carries
 * the normals of a surface transformed by `m`, including shear and non-uniform scale.
 * The inverse is the reference one, cofactors and product order included, then transposed with
 * no floating-point operation.
 *
 * SINGULAR MATRIX: the ADJUGATE, undivided, not the reference's zero matrix. What
 * decides singularity is the engine's single rule (`singular.ts`), the same one the
 * WGSL kernel applies — the determinant of the NORMALISED linear part, never the raw
 * determinant, which only judges scale. A regular matrix returns exactly the previous bits: the
 * factor stays `1 / det`, the RAW determinant, and the rule only chooses the branch.
 * A singular pose does not erase the surface, it flattens it onto a plane: its faces keep an
 * area and a normal there. `cof(M)·(e1 × e2) = (M e1) × (M e2)` — the adjugate applied to a local
 * normal IS the cross product of the transformed edges, sign included — and every consumer
 * then normalises, which erases the missing scale factor. Rank ≤ 1, the primitive is
 * collapsed onto a line or a point: the columns are parallel, the adjugate is zero by
 * itself, and the normal comes out zero with no special case writing it. A zero, infinite
 * or NaN scale is the only case written apart: nine zeros, because a NaN term is not fixed
 * by multiplying it. This is the engine convention, the same as the WGSL kernel in
 * `packages/sdk-browser/inverseTransposeWgsl.ts`, where it is written in full; the reference
 * returns zero on every singular matrix and loses the surface.
 */
export function normalMatrix3<T extends NumberSink>(out: T, m: ArrayLike<number>, outOffset = 0) {
  const n11 = m[0],
    n21 = m[1],
    n31 = m[2];
  const n12 = m[4],
    n22 = m[5],
    n32 = m[6];
  const n13 = m[8],
    n23 = m[9],
    n33 = m[10];
  const t11 = n33 * n22 - n32 * n23,
    t12 = n32 * n13 - n33 * n12,
    t13 = n23 * n12 - n22 * n13;
  const det = n11 * t11 + n21 * t12 + n31 * t13;
  // The factor comes from the engine's single rule: `1 / det` if the matrix is regular — the
  // previous bits —, `1` if it is singular, and nothing at all if its scale is neither finite nor
  // strictly positive. The first three cofactors are already here — the determinant
  // required them — and the other six are those of the multiplication below.
  const detInv = adjugateFactor(m, det);
  // Zero, infinite or NaN scale: nine zeros, like the WGSL kernel which then replaces its adjugate.
  // The primitive has neither area nor normal left, and nothing non-finite goes into lighting.
  if (detInv === null) {
    for (let i = 0; i < 9; i++) out[outOffset + i] = 0;
    return out;
  }
  out[outOffset] = t11 * detInv;
  out[outOffset + 3] = (n31 * n23 - n33 * n21) * detInv;
  out[outOffset + 6] = (n32 * n21 - n31 * n22) * detInv;
  out[outOffset + 1] = t12 * detInv;
  out[outOffset + 4] = (n33 * n11 - n31 * n13) * detInv;
  out[outOffset + 7] = (n31 * n12 - n32 * n11) * detInv;
  out[outOffset + 2] = t13 * detInv;
  out[outOffset + 5] = (n21 * n13 - n23 * n11) * detInv;
  out[outOffset + 8] = (n22 * n11 - n21 * n12) * detInv;
  return out;
}
