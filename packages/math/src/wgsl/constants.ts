import { wgslConst } from './decl.ts'
import { wgslF32 } from './number.ts'
import { SINGULAR_DETERMINANT as SINGULAR } from '../matrix/singular.ts'
import {
  FAR_VALUE as FAR,
  FINITE_SENTINEL as FINITE,
  FLOAT32_MAX as F32_MAX,
  FLOAT32_MIN_NORMAL as F32_MIN_NORMAL,
  GOLDEN_ANGLE as ANGLE,
  GOLDEN_FRACTION as GOLDEN,
  GOLDEN_U32 as GOLDEN_WORD,
  HALF_MAX as HALF,
  HALF_OVERFLOW as HALF_PAST,
  PLASTIC_STEP_X,
  PLASTIC_STEP_Y,
  QUARTER_PI as QUARTER,
  TAU,
} from '../constants.ts'

/**
 * The numbers shaders name, each the `f32` nearest its TypeScript value (`wgslF32`), declared once:
 * π and its multiples, √2, the greatest and the least normal `f32`, the finite stand-in for
 * infinity, the golden ratio's fraction and angle, the plastic steps, the half-float bounds
 * (`../constants.ts`), and the engine's singularity threshold
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
export const FAR_VALUE = wgslConst('FAR_VALUE', [], `const FAR_VALUE:f32=${wgslF32(FAR)};`)

/** The golden ratio's fraction in 32 bits, `⌊GOLDEN_FRACTION · 2³²⌋` = 0x9e3779b9: an odd salt
 *  with well-spread bits, which decorrelates two hashes of one seed. */
export const GOLDEN_U32 = wgslConst(
  'GOLDEN_U32',
  [],
  `const GOLDEN_U32:u32=0x${GOLDEN_WORD.toString(16)}u;`,
)

/** An eighth of a turn, π/4. */
export const QUARTER_PI = wgslConst('QUARTER_PI', [], `const QUARTER_PI:f32=${wgslF32(QUARTER)};`)

/** The square root of two, the diagonal of a unit square. */
export const SQRT2 = wgslConst('SQRT2', [], `const SQRT2:f32=${wgslF32(Math.SQRT2)};`)

/** The golden angle, π(3 − √5): the turn between two successive points of a sunflower spiral. */
export const GOLDEN_ANGLE = wgslConst(
  'GOLDEN_ANGLE',
  [],
  `const GOLDEN_ANGLE:f32=${wgslF32(ANGLE)};`,
)

/** The steps of the additive two-dimensional sequence, (1/p, 1/p²), p the plastic number. */
export const PLASTIC_STEP = wgslConst(
  'PLASTIC_STEP',
  [],
  `const PLASTIC_STEP:vec2f=vec2f(${wgslF32(PLASTIC_STEP_X)},${wgslF32(PLASTIC_STEP_Y)});`,
)

/** The least positive normal `f32`, 2⁻¹²⁶: a floor that keeps a quotient off the subnormals. */
export const FLOAT32_MIN_NORMAL = wgslConst(
  'FLOAT32_MIN_NORMAL',
  [],
  `const FLOAT32_MIN_NORMAL:f32=${wgslF32(F32_MIN_NORMAL)};`,
)

/** The greatest finite half float, 65504: a half-float target's bound. */
export const HALF_MAX = wgslConst('HALF_MAX', [], `const HALF_MAX:f32=${wgslF32(HALF)};`)

/** 65520, the least magnitude a half float rounds to infinity: every value under it stores
 *  finite in a half-float target. */
export const HALF_OVERFLOW = wgslConst(
  'HALF_OVERFLOW',
  [],
  `const HALF_OVERFLOW:f32=${wgslF32(HALF_PAST)};`,
)

/** 1e-20, the floor a divisor or a root's argument is held to: under every square a scene's
 *  derivatives, densities or angles give, over the `f32` underflow, so the quotient stays finite. */
export const DIVISOR_FLOOR = wgslConst(
  'DIVISOR_FLOOR',
  [],
  `const DIVISOR_FLOOR:f32=${wgslF32(1e-20)};`,
)

/** 1e9, a bound past any colour or depth a history range holds: an empty range starts at
 *  (RANGE_BOUND, −RANGE_BOUND), an open one is (−RANGE_BOUND, RANGE_BOUND). */
export const RANGE_BOUND = wgslConst('RANGE_BOUND', [], `const RANGE_BOUND:f32=${wgslF32(1e9)};`)
