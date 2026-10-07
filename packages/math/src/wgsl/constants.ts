import { wgslConst } from './decl.ts'
import { wgslF32 } from './number.ts'
import { SINGULAR_DETERMINANT as SINGULAR } from '../matrix/singular.ts'
import {
  FINITE_SENTINEL as FINITE,
  FLOAT32_MAX as F32_MAX,
  GOLDEN_FRACTION as GOLDEN,
  TAU,
} from '../constants.ts'

/**
 * The numbers shaders name, each the `f32` nearest its TypeScript value (`wgslF32`), declared once:
 * π and its multiples, the greatest finite `f32`, the finite stand-in for infinity, the golden
 * ratio's fraction (`../constants.ts`), and the engine's singularity threshold
 * (`../matrix/singular.ts`), which the processor reads in double and the shader in single; then the
 * shaders' own sentinels, one per value and meaning. A shader lists the one it names.
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

/** The finite stand-in for infinity (`FINITE_SENTINEL`), 3.4e38, never `FLOAT32_MAX`: an
 *  unreachable band's bound a const-expression may hold, and the factor that sends a value to its
 *  signed infinity. */
export const FINITE_SENTINEL = wgslConst(
  'FINITE_SENTINEL',
  [],
  `const FINITE_SENTINEL:f32=${wgslF32(FINITE)};`,
)

/** 3.0e38, the magnitude past which a shader takes a value for infinite — a radius that reaches
 *  everywhere, a clip `w` too great to bound a box —, with headroom under `FINITE_SENTINEL`. */
export const INFINITE_THRESHOLD = wgslConst(
  'INFINITE_THRESHOLD',
  [],
  `const INFINITE_THRESHOLD:f32=${wgslF32(3.0e38)};`,
)

/** 1e30, a distance or a bound past any scene's: an empty range's start, a ray's exit along an axis
 *  it does not move on. Its square still overflows, so it is never squared. */
export const FAR_VALUE = wgslConst('FAR_VALUE', [], `const FAR_VALUE:f32=${wgslF32(1e30)};`)

/** The golden ratio's fraction in 32 bits, `⌊GOLDEN_FRACTION · 2³²⌋` = 0x9e3779b9: an odd salt
 *  with well-spread bits, which decorrelates two hashes of one seed. */
export const GOLDEN_U32 = wgslConst(
  'GOLDEN_U32',
  [],
  `const GOLDEN_U32:u32=0x${Math.floor(GOLDEN * 2 ** 32).toString(16)}u;`,
)
