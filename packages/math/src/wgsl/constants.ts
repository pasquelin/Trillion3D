import { wgslConst } from './decl.ts'
import { wgslF32 } from './number.ts'
import { SINGULAR_DETERMINANT as SINGULAR } from '../matrix/singular.ts'
import { FLOAT32_MAX as F32_MAX, GOLDEN_FRACTION as GOLDEN, TAU } from '../constants.ts'

/**
 * The numbers shaders name, each the `f32` nearest its TypeScript value (`wgslF32`), declared once:
 * π and its multiples, the greatest finite `f32`, the golden ratio's fraction (`../constants.ts`),
 * and the engine's singularity threshold (`../matrix/singular.ts`), which the processor reads in
 * double and the shader in single. A shader lists the one it names.
 */

export const PI = wgslConst('PI', [], `const PI:f32=${wgslF32(Math.PI)};`)

export const TWO_PI = wgslConst('TWO_PI', [], `const TWO_PI:f32=${wgslF32(TAU)};`)

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
  `const INVERSE_TWO_PI:f32=${wgslF32(1 / TAU)};`,
)

/** The threshold on the normalised determinant under which a 3×3 is singular. */
export const SINGULAR_DETERMINANT = wgslConst(
  'SINGULAR_DETERMINANT',
  [],
  `const SINGULAR_DETERMINANT:f32=${wgslF32(SINGULAR)};`,
)

/** The greatest finite `f32`: an empty range's low bound, a miss's distance. */
export const FLOAT32_MAX = wgslConst(
  'FLOAT32_MAX',
  [],
  `const FLOAT32_MAX:f32=${wgslF32(F32_MAX)};`,
)

/** The golden ratio's fractional part: the step of a low-discrepancy sequence. */
export const GOLDEN_FRACTION = wgslConst(
  'GOLDEN_FRACTION',
  [],
  `const GOLDEN_FRACTION:f32=${wgslF32(GOLDEN)};`,
)
