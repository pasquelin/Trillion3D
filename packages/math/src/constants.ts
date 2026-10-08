/** Named numeric constants of the engine: one home each, imported rather than respelled. Each is
 *  written as its literal value, the bits of the expression its doc names (`constants.test.ts`
 *  holds them to it): a literal is what a bundler can drop when nothing reads it. `HALF_PI` keeps
 *  its expression, shorter than its digits. */

/** Half a turn, in radians: `Math.PI`. */
export const PI = 3.141592653589793
/** A quarter turn, in radians. */
export const HALF_PI = Math.PI / 2
/** An eighth of a turn, in radians: `Math.PI / 4`. */
export const QUARTER_PI = 0.7853981633974483
/** A full turn, in radians: `Math.PI * 2`. */
export const TAU = 6.283185307179586
/** Degrees to radians, `Math.PI / 180`: `degrees * DEG2RAD`. */
export const DEG2RAD = 0.017453292519943295
/** Radians to degrees, `180 / Math.PI`: `radians * RAD2DEG`. */
export const RAD2DEG = 57.29577951308232
/** The golden ratio's fractional part, (sqrt 5 - 1) / 2: the step of a low-discrepancy turn. */
export const GOLDEN_FRACTION = 0.6180339887498949
/**
 * The largest finite float32, exactly `(2 - 2 ** -23) * 2 ** 127`. It is not `3.4e38`, which is a
 * different number (`FINITE_SENTINEL`): the two are never interchangeable.
 */
export const FLOAT32_MAX = 3.4028234663852886e38
/**
 * `3.4e38`, the finite stand-in for infinity some packed buffers and shaders hold where a constant
 * may not be infinite: past every finite threshold a comparison meets, times a value it overflows
 * to that value's signed infinity. It is not `FLOAT32_MAX`: its float32 lies 2.8e35 under it, and
 * a buffer written with one and read against the other disagrees.
 */
export const FINITE_SENTINEL = 3.4e38
/** The square root of three, `Math.sqrt(3)`: the diagonal of a unit cube. */
export const SQRT3 = 1.7320508075688772
/** The golden angle in radians, `Math.PI * (3 - Math.sqrt(5))`: the turn between two successive
 *  points of a sunflower spiral, the one that spreads them most evenly. */
export const GOLDEN_ANGLE = 2.399963229728653
/** One float32 step at magnitude 1, `2 ** -23`: the GPU draws every world in float32. */
export const FLOAT32_STEP = 1.1920928955078125e-7
/** One mebibyte, `1024 * 1024` bytes. */
export const MIB = 1048576
/** The golden ratio's fraction in 32 bits, `⌊GOLDEN_FRACTION · 2³²⌋` = 0x9e3779b9: an odd salt with
 *  well-spread bits, the seed a generator takes for zero; `GOLDEN_32` of the Rust crate. */
export const GOLDEN_U32 = 0x9e3779b9
/** The step of an octahedral byte, `Math.fround(2 / 255)`: a byte `q` of an octahedral code back to
 *  `[-1, 1]` as `q · OCT_BYTE_STEP − 1`, in float32 as the GPU and the Rust codec decode it. */
export const OCT_BYTE_STEP = 0.007843137718737125
/** The greatest finite half float, `(2 - 2 ** -10) * 2 ** 15`: a half-float target's bound. */
export const HALF_MAX = 65504
/** The least magnitude a half float rounds to infinity, `HALF_MAX + 2 ** 4` (half the step past
 *  the greatest half, rounded to even away from it): every value under it stores finite. */
export const HALF_OVERFLOW = 65520
/** The least positive normal float32, `2 ** -126`. */
export const FLOAT32_MIN_NORMAL = 1.1754943508222875e-38
/** `1e30`, a distance or a bound past any scene's: an empty range's start, a ray's exit along an
 *  axis it does not move on. Its square overflows a float32, so it is never squared. */
export const FAR_VALUE = 1e30
/** The steps of the additive two-dimensional sequence, `1 / p` and `1 / p²`, `p` the plastic number
 *  (the real root of `x³ = x + 1`): its points spread evenly over the unit square. */
export const PLASTIC_STEP_X = 0.7548776662466927
export const PLASTIC_STEP_Y = 0.5698402909980532
