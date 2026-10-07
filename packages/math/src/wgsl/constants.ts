import { wgslConst } from './decl.ts'
import { wgslF32 } from './number.ts'
import { SINGULAR_DETERMINANT as SINGULAR } from '../matrix/singular.ts'

/**
 * The numbers shaders name, each the `f32` nearest its TypeScript value (`wgslF32`), declared once:
 * π and its multiples, and the engine's singularity threshold (`../matrix/singular.ts`), which the
 * processor reads in double and the shader in single. A shader lists the one it names.
 */

export const PI = wgslConst('PI', [], `const PI:f32=${wgslF32(Math.PI)};`)

export const TWO_PI = wgslConst('TWO_PI', [], `const TWO_PI:f32=${wgslF32(2 * Math.PI)};`)

/** The Lambert normalisation, 1/π. */
export const INVERSE_PI = wgslConst(
  'INVERSE_PI',
  [],
  `const INVERSE_PI:f32=${wgslF32(1 / Math.PI)};`,
)

/** The vector form factor's normalisation, 1/(2π). */
export const INVERSE_TWO_PI = wgslConst(
  'INVERSE_TWO_PI',
  [],
  `const INVERSE_TWO_PI:f32=${wgslF32(1 / (2 * Math.PI))};`,
)

/** The threshold on the normalised determinant under which a 3×3 is singular. */
export const SINGULAR_DETERMINANT = wgslConst(
  'SINGULAR_DETERMINANT',
  [],
  `const SINGULAR_DETERMINANT:f32=${wgslF32(SINGULAR)};`,
)
