import { wgslFn, wgslStruct } from './decl.ts'
import { SINGULAR_DETERMINANT } from './constants.ts'

/**
 * The 3×3 inverse-transpose, the normal matrix of a world, written once for the whole engine
 * (the processor's twin is `normalMatrix3` of `../matrix/matrix3.ts`; the threshold is the one
 * of `../matrix/singular.ts`, declared in `constants.ts`, so the processor and the shader read the
 * same number).
 *
 * Degeneracy is judged on the NORMALISED determinant, never on the raw one. An absolute threshold
 * judges scale, not degeneracy: a rotation of uniform scale s has determinant ±s³, so s ≲ 2.15e-7
 * fell under 1e-20 and returned the LOCAL vector, unrotated. The 3×3 is therefore divided by the
 * sum of its absolute values before the determinant. This is THE engine's degeneracy guard.
 *
 * What a singular matrix becomes: a regular one gives `scale*(adjoint*v)`; a rank-2 one gives
 * `adjoint*v` without the factor (infinite as the determinant is zero), which is the cross
 * product of the transformed edges up to a positive factor, so a flattened face keeps its
 * normal and its winding; a collapsed one (rank ≤ 1, or a null, infinite or NaN sum) has a zero
 * adjoint, and `uniteOuZero` returns the null vector rather than a NaN.
 *
 * What depends only on the matrix (normalisation, determinant, the adjoint's three cross
 * products) is gathered in `invTranspose3Prep`, computed once; `invTranspose3Apply` keeps per
 * vector the 3×3 product and the factor.
 */

export const InvT3 = wgslStruct('InvT3', [], 'struct InvT3{adj:mat3x3f,scale:f32,regular:bool,}')

/** The sum of the absolute values of the nine entries: the scale a 3×3 is divided by. */
export const absoluteSum3 = wgslFn(
  'absoluteSum3',
  [],
  `fn absoluteSum3(m:mat3x3f)->f32{
 let w=abs(m[0])+abs(m[1])+abs(m[2]);
 return w.x+w.y+w.z;
}`,
)

/** Whether `t`, an `absoluteSum3`, can divide: above zero and neither infinite nor NaN, read at the
 *  bit. */
export const isFiniteScale = wgslFn(
  'isFiniteScale',
  [],
  'fn isFiniteScale(t:f32)->bool{return (t>0.0)&&(bitcast<u32>(t)&0x7f800000u)!=0x7f800000u;}',
)

export const invTranspose3Prep = wgslFn(
  'invTranspose3Prep',
  [InvT3, SINGULAR_DETERMINANT, absoluteSum3, isFiniteScale],
  `fn invTranspose3Prep(m:mat3x3f)->InvT3{
 let t=absoluteSum3(m);
 let finite=isFiniteScale(t);
 let a=m[0]/t;let b=m[1]/t;let c=m[2]/t;
 let det=dot(a,cross(b,c));let z=vec3f(0.0);
 return InvT3(mat3x3f(select(z,cross(b,c),finite),select(z,cross(c,a),finite),select(z,cross(a,b),finite)),1.0/(det*t),finite&&abs(det)>SINGULAR_DETERMINANT);
}`,
)

export const invTranspose3Apply = wgslFn(
  'invTranspose3Apply',
  [InvT3],
  `fn invTranspose3Apply(p:InvT3,v:vec3f)->vec3f{
 let carried=p.adj*v;
 return select(carried,p.scale*carried,p.regular);
}`,
)

export const inverseTranspose3 = wgslFn(
  'inverseTranspose3',
  [invTranspose3Prep, invTranspose3Apply],
  'fn inverseTranspose3(m:mat3x3f,v:vec3f)->vec3f{return invTranspose3Apply(invTranspose3Prep(m),v);}',
)

export const uniteOuZero = wgslFn(
  'uniteOuZero',
  [],
  'fn uniteOuZero(v:vec3f)->vec3f{return select(vec3f(0.0),normalize(v),dot(v,v)>0.0);}',
)
