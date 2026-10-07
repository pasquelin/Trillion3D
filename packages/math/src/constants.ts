/** Named numeric constants of the engine: one home each, imported rather than respelled. Each is
 *  written as its literal value, the bits of the expression its doc names (`constants.test.ts`
 *  holds them to it): a literal is what a bundler can drop when nothing reads it. `HALF_PI` keeps
 *  its expression, shorter than its digits. */

/** A quarter turn, in radians. */
export const HALF_PI = Math.PI / 2
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
 * different number (a sentinel some packed buffers use): the two are never interchangeable.
 */
export const FLOAT32_MAX = 3.4028234663852886e38
/** One float32 step at magnitude 1, `2 ** -23`: the GPU draws every world in float32. */
export const FLOAT32_STEP = 1.1920928955078125e-7
/** One mebibyte, `1024 * 1024` bytes. */
export const MIB = 1048576
