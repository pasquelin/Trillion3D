import { wgslConst } from './decl.ts'
import { wgslF32 } from './number.ts'
import { DIVISOR_FLOOR as TINY } from '../matrix/singular.ts'
import {
  FAR_VALUE as FAR,
  FINITE_SENTINEL as FINITE,
  FLOAT32_MAX as F32_MAX,
  FLOAT32_MIN_NORMAL as F32_MIN_NORMAL,
  GOLDEN_U32 as GOLDEN_WORD,
  HALF_MAX as HALF,
  PLASTIC_STEP_X,
  PLASTIC_STEP_Y,
  QUARTER_PI as QUARTER,
  TAU,
} from '../constants.ts'

/** The `f32` nearest `value`, declared as `name`. */
const f32Const = (name: string, value: number) =>
  wgslConst(name, [], `const ${name}:f32=${wgslF32(value)};`)

/**
 * The numbers shaders name, each the `f32` nearest its TypeScript value (`wgslF32`), declared once:
 * π and its multiples, √2, the greatest and the least normal `f32`, the finite stand-in for
 * infinity, the golden ratio's fraction and angle, the plastic steps, the half-float bounds
 * (`../constants.ts`), and the engine's singularity threshold
 * (`../matrix/singular.ts`), which the processor reads in double and the shader in single; then the
 * shaders' own sentinels, one per value and meaning. A shader lists the one it names.
 */

export const PI = f32Const('PI', Math.PI)

export const TWO_PI = f32Const('TWO_PI', TAU)

/** The Lambert normalisation, 1/π. */
export const INVERSE_PI = f32Const('INVERSE_PI', 1 / Math.PI)

/** The vector form factor's normalisation, 1/(2π). */
export const INVERSE_TWO_PI = f32Const('INVERSE_TWO_PI', 1 / TAU)

/** The uniform phase function's normalisation, 1/(4π): the light of a sphere's one steradian. */
export const INVERSE_FOUR_PI = f32Const('INVERSE_FOUR_PI', 1 / (2 * TAU))

/** The greatest finite `f32`: an empty range's low bound, a miss's distance. */
export const FLOAT32_MAX = f32Const('FLOAT32_MAX', F32_MAX)

/** The finite stand-in for infinity (`FINITE_SENTINEL`), 3.4e38, never `FLOAT32_MAX`: an
 *  unreachable band's bound a const-expression may hold, and the factor that sends a value to its
 *  signed infinity. */
export const FINITE_SENTINEL = f32Const('FINITE_SENTINEL', FINITE)

/** 3.0e38, the magnitude past which a shader takes a value for infinite — a radius that reaches
 *  everywhere, a clip `w` too great to bound a box —, with headroom under `FINITE_SENTINEL`. */
export const INFINITE_THRESHOLD = f32Const('INFINITE_THRESHOLD', 3.0e38)

/** 1e30, a distance or a bound past any scene's: an empty range's start, a ray's exit along an axis
 *  it does not move on. Its square still overflows, so it is never squared. */
export const FAR_VALUE = f32Const('FAR_VALUE', FAR)

/** The golden ratio's fraction in 32 bits, `⌊(√5 − 1) / 2 · 2³²⌋` = 0x9e3779b9: an odd salt
 *  with well-spread bits, which decorrelates two hashes of one seed. */
export const GOLDEN_U32 = wgslConst(
  'GOLDEN_U32',
  [],
  `const GOLDEN_U32:u32=0x${GOLDEN_WORD.toString(16)}u;`,
)

/** An index naming nothing (`NO_INDEX`, `../constants.ts`): no slot, rank or entry of a table,
 *  all bits set. */
export const NO_INDEX = wgslConst('NO_INDEX', [], 'const NO_INDEX:u32=0xffffffffu;')

/** An eighth of a turn, π/4. */
export const QUARTER_PI = f32Const('QUARTER_PI', QUARTER)

/** The square root of two, the diagonal of a unit square. */
export const SQRT2 = f32Const('SQRT2', Math.SQRT2)

/** The steps of the additive two-dimensional sequence, (1/p, 1/p²), p the plastic number. */
export const PLASTIC_STEP = wgslConst(
  'PLASTIC_STEP',
  [],
  `const PLASTIC_STEP:vec2f=vec2f(${wgslF32(PLASTIC_STEP_X)},${wgslF32(PLASTIC_STEP_Y)});`,
)

/** The least positive normal `f32`, 2⁻¹²⁶: a floor that keeps a quotient off the subnormals. */
export const FLOAT32_MIN_NORMAL = f32Const('FLOAT32_MIN_NORMAL', F32_MIN_NORMAL)

/** The greatest finite half float, 65504: a half-float target's bound. */
export const HALF_MAX = f32Const('HALF_MAX', HALF)

/** The floor a divisor or a root's argument is held to: under every square a scene's
 *  derivatives, densities or angles give, over the `f32` underflow, so the quotient stays finite —
 *  and the threshold on a normalised determinant under which a 3×3 is singular: the engine's one
 *  tiny number, 1e-20 (`../matrix/singular.ts`). */
export const DIVISOR_FLOOR = f32Const('DIVISOR_FLOOR', TINY)

/** 1e9, a bound past any colour or depth a history range holds: an empty range starts at
 *  (RANGE_BOUND, −RANGE_BOUND), an open one is (−RANGE_BOUND, RANGE_BOUND). */
export const RANGE_BOUND = f32Const('RANGE_BOUND', 1e9)
