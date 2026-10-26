import { wgslFn } from './decl.ts'

/**
 * The linear part of a world matrix, its cofactors, and the side its determinant falls on, as the
 * shaders read them. Two mirror tests, two NaN verdicts: `matrixWindingCw` is the determinant
 * builtin below zero (`../matrix/orientation.ts` on the processor) and `windingKept` the same
 * builtin at or above zero, which a NaN fails too. Neither stands for the other.
 */

export const worldMatrix3 = wgslFn(
  'worldMatrix3',
  [],
  'fn worldMatrix3(world:mat4x4f)->mat3x3f{return mat3x3f(world[0].xyz,world[1].xyz,world[2].xyz);}',
)

export const matrixWindingCw = wgslFn(
  'matrixWindingCw',
  [worldMatrix3],
  'fn matrixWindingCw(w:mat4x4f)->bool{return determinant(worldMatrix3(w))<0.0;}',
)

export const windingKept = wgslFn(
  'windingKept',
  [],
  'fn windingKept(world3:mat3x3f)->bool{return determinant(world3)>=0.0;}',
)

/** The cofactor matrix of the 3×3 of columns `a, b, c`, the adjugate transposed: its columns are
 *  the adjugate's rows `b × c`, `c × a`, `a × b`, so it is det · M⁻ᵀ and `dot(a, b × c)` the
 *  determinant. Unguarded: `invTranspose3Prep` (`inverseTranspose.ts`) holds the engine's guard. */
export const cofactor3 = wgslFn(
  'cofactor3',
  [],
  'fn cofactor3(a:vec3f,b:vec3f,c:vec3f)->mat3x3f{return mat3x3f(cross(b,c),cross(c,a),cross(a,b));}',
)

/** The inverse of the 3×3 of columns `m`, by cofactors: the cofactors' columns are the adjugate's
 *  rows, scaled by the plain reciprocal of the determinant. Infinite where the matrix has no inverse,
 *  unlike the CPU's `inverse3` (`matrix3.ts`), which answers a singular matrix by its own rule: the
 *  caller takes the result as it comes. */
export const inverse3 = wgslFn(
  'inverse3',
  [cofactor3],
  `fn inverse3(m:mat3x3f)->mat3x3f{
 let c=cofactor3(m[0],m[1],m[2]);
 let k=1.0/dot(m[0],c[0]);
 return mat3x3f(vec3f(c[0].x,c[1].x,c[2].x)*k,vec3f(c[0].y,c[1].y,c[2].y)*k,vec3f(c[0].z,c[1].z,c[2].z)*k);
}`,
)
