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
