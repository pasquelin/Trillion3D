import { wgslFn } from './decl.ts'

/**
 * The linear part of a world matrix, its cofactors, and the side its determinant falls on, as the
 * shaders read them. Three mirror tests, three roundings or NaN verdicts: `matrixWindingCw` is the determinant
 * builtin below zero (`../matrix/orientation.ts` on the processor), `windingKept` the same
 * builtin at or above zero, which a NaN fails too, and `matrixWindingCwTriple` the triple product
 * `a · (b × c)`, another rounding of the same determinant. None stands for another.
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

export const matrixWindingCwTriple = wgslFn(
  'matrixWindingCwTriple',
  [],
  'fn matrixWindingCwTriple(w:mat4x4f)->bool{return dot(w[0].xyz,cross(w[1].xyz,w[2].xyz))<0.0;}',
)

/** The cofactor matrix of the 3×3 of columns `a, b, c`, the adjugate transposed: its columns are
 *  the adjugate's rows `b × c`, `c × a`, `a × b`, so it is det · M⁻ᵀ and `dot(a, b × c)` the
 *  determinant. Unguarded: `invTranspose3Prep` (`inverseTranspose.ts`) holds the engine's guard. */
export const cofactor3 = wgslFn(
  'cofactor3',
  [],
  'fn cofactor3(a:vec3f,b:vec3f,c:vec3f)->mat3x3f{return mat3x3f(cross(b,c),cross(c,a),cross(a,b));}',
)
