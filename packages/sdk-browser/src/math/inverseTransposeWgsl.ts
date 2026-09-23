import { SINGULAR_DETERMINANT_WGSL } from '../../../sdk-core/src/index.ts';

/**
 * 3×3 inverse-transpose in WGSL, written once for the whole engine: the DAG selection kernel
 * (`../gpu/dag/shader/shader.ts`, cone axis) and the lighting-normal transform (`../lighting/standardLighting.ts`,
 * `xformNormal`) share this text. WGSL module declarations read in any order: this snippet is
 * added to each shader's text.
 *
 * Degeneracy is judged on the NORMALISED determinant, never on the raw determinant. An absolute
 * threshold judges scale, not degeneracy: a rotation of uniform scale s has determinant ±s³, so
 * s ≲ 2.15e-7 fell under 1e-20 and the function returned the LOCAL vector, unrotated. The 3×3
 * is therefore divided by the sum of its absolute values — exactly `isConformal`'s
 * normalisation — before the determinant. Under 1e-12, s³ itself becomes denormal in f32: only
 * this normalisation crosses that floor. This is THE engine's degeneracy guard; nothing that
 * follows adds another. The THRESHOLD itself is not written here: it comes from
 * `SINGULAR_DETERMINANT` (`packages/sdk-core/src/math/matrix/singular.ts`), rendered as text and inserted
 * into the shader, so the CPU (`normalMatrix3`) and the GPU read the same number.
 *
 * WHAT A SINGULAR MATRIX BECOMES. Singular does not mean gone: a scale (1, 1, 0) followed by a
 * rotation flattens a primitive onto a PLANE, and its faces keep a non-zero area there and a
 * perfectly defined normal. Returning the local vector then — the normal from BEFORE the
 * transform — lit the surface as if it had not rotated; returning zero extinguished it. The
 * engine convention, the same for every surface, opaque, masked or transparent:
 *
 *  1. Regular matrix: `facteur*(adjointe*v)`, the inverse-transpose, unchanged to the bit.
 *  2. Rank-2 singular matrix: `adjointe*v`, WITHOUT the factor — which is ±∞ since the
 *     determinant is zero. This is not a fallback, it is the right compute: the cofactor
 *     identity gives `cof(M)·(e1 × e2) = (M e1) × (M e2)`, so the adjoint applied to the local
 *     normal IS the cross product of the transformed edges, up to a positive 1/t² factor. A
 *     rank-2 matrix has a rank-1 adjoint, whose image is carried by the arrival plane's normal:
 *     any vertex normal not in the kernel falls there, so on a flattened face the three vertex
 *     normals become the FACE normal, and smoothing vanishes with the volume — the only answer
 *     a flat surface can give. The SIGN is not chosen apart: `adjointe*v` already carries it,
 *     and it is that of the transported old normal (same side as `facteur*(adjointe*v)` when the
 *     determinant is positive, the orientation of the edges' cross product otherwise). Face
 *     winding of a flattened face therefore comes from that cross product, never from a zero
 *     determinant.
 *  3. Really collapsed face — rank ≤ 1, or a null, infinite or NaN sum: the adjoint is zero
 *     (rank 1: columns are parallel) or cleared here (non-finite sum, where `m/t` is worthless).
 *     `adjointe*v` is then zero, and `uniteOuZero` returns the null vector rather than a NaN:
 *     the face covers no pixel, and nothing non-finite goes into lighting.
 *  4. Non-finite transform: refused at the engine entry (`../host/world/matrices.ts`,
 *     `../world/scene/scene.ts`, `../webgpu/pages/render/transform.ts`), never silently replaced here.
 *
 * All of that depends only on the matrix: normalisation, the determinant and the adjoint's
 * three cross products are therefore gathered in `invTranspose3Prep`, computed once, and
 * `invTranspose3Apply` keeps per vector only the 3×3 product and the factor. A shading that
 * transforms a triangle's three normals with the same matrix no longer remakes the prologue
 * three times. Operands and their per-vector order do not move — `facteur*(adjointe*v)`, as
 * before — so the regular case stays the previous one, to the bit. `inverseTranspose3` remains
 * the public writing for an isolated vector.
 */
const NOYAU = (prep: string, repli: string) => `
struct InvT3{adj:mat3x3f,facteur:f32,regulier:bool,}
fn invTranspose3Prep(m:mat3x3f)->InvT3{
${prep}
}
fn invTranspose3Apply(p:InvT3,v:vec3f)->vec3f{
 let porte=p.adj*v;
 return select(${repli},p.facteur*porte,p.regulier);
}
fn inverseTranspose3(m:mat3x3f,v:vec3f)->vec3f{return invTranspose3Apply(invTranspose3Prep(m),v);}
fn uniteOuZero(v:vec3f)->vec3f{return select(vec3f(0.0),normalize(v),dot(v,v)>0.0);}`;

/**
 * Shipped prepare: the normalised 3×3, then the determinant and adjoint of the normalised.
 * The adjoint is cleared when the sum of absolute values is neither finite nor strictly
 * positive — `m/t` is then NaN everywhere, and a NaN adjoint would leave case 3 from above.
 */
const PREP_LIVREE = ` let w=abs(m[0])+abs(m[1])+abs(m[2]);let t=w.x+w.y+w.z;
 let fini=(t>0.0)&&(bitcast<u32>(t)&0x7f800000u)!=0x7f800000u;
 let a=m[0]/t;let b=m[1]/t;let c=m[2]/t;
 let det=dot(a,cross(b,c));let z=vec3f(0.0);
 return InvT3(mat3x3f(select(z,cross(b,c),fini),select(z,cross(c,a),fini),select(z,cross(a,b),fini)),1.0/(det*t),fini&&abs(det)>${SINGULAR_DETERMINANT_WGSL});`;

/**
 * Prepare from BEFORE defect 6: absolute threshold `abs(det)<1e-20` on the RAW 3×3, and factor
 * `1/det` instead of `1/(det·t)`. `regulier` is the exact negation of the old guard, the one
 * that returned the vector as-is — hence the same decision, case for case, NaN included. Its
 * number is written by hand and stays: it is a DEAD RULE, on the raw determinant, which the
 * shared constant must not follow if it moves — otherwise the reproduction would stop reproducing.
 */
const PREP_BEFORE_DEFECT_6 = ` let a=m[0];let b=m[1];let c=m[2];
 let det=dot(a,cross(b,c));
 return InvT3(mat3x3f(cross(b,c),cross(c,a),cross(a,b)),1.0/det,!(abs(det)<1e-20));`;

/** Shipped kernel: this is the one, and only this one, that production shaders insert. */
export const INVERSE_TRANSPOSE_WGSL = NOYAU(PREP_LIVREE, 'porte');

/**
 * The same kernel with the prepare from before defect 6, TO REPLAY THE DEFECT ONLY: no
 * production shader inserts it. Its fallback remains the LOCAL vector `v` — that was the
 * defect, and a reproduction that adopted the shipped convention would reproduce nothing. It
 * lives here, against the shipped text, rather than copied into a bench: two neighbouring
 * forms in one file move together, while a copy pasted elsewhere stops matching the first
 * kernel change — without anyone seeing it. The whole block substitutes for the shipped
 * block, structure included, and `tests/browser/probes/substitutionBefore.ts` establishes the
 * substitution instead of hoping for it. A reproduction is only worth as long as it
 * reproduces: GPU actually executed, and measured against what the engine DRAWS (real
 * rasterisation, face state included), this form drops 656 drawn clusters over 6 916 cases
 * where the shipped form drops none (`tests/browser/probes/inverse-transpose-small-scale.ts`).
 * The "560 before, 54 after" of an earlier sample read raw geometric orientation, which
 * ignores face swap under reflection: it counted 119 legitimate rejects as defects and missed
 * 215.
 */
export const INVERSE_TRANSPOSE_BEFORE_WGSL = NOYAU(PREP_BEFORE_DEFECT_6, 'v');
