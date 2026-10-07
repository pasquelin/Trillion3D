/** Named numeric constants of the engine: one home each, imported rather than respelled. */

/** A quarter turn, in radians. */
export const HALF_PI = Math.PI / 2
/** A full turn, in radians. */
export const TAU = Math.PI * 2
/** Degrees to radians: `degrees * DEG2RAD`. */
export const DEG2RAD = Math.PI / 180
/** Radians to degrees: `radians * RAD2DEG`. */
export const RAD2DEG = 180 / Math.PI
/** The golden ratio, (1 + sqrt 5) / 2. */
export const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2
/** The golden ratio's fractional part, (sqrt 5 - 1) / 2: the step of a low-discrepancy turn. */
export const GOLDEN_FRACTION = (Math.sqrt(5) - 1) / 2
/**
 * The largest finite float32, exactly `(2 - 2 ** -23) * 2 ** 127`. It is not `3.4e38`, which is a
 * different number (a sentinel some packed buffers use): the two are never interchangeable.
 */
export const FLOAT32_MAX = 3.4028234663852886e38
/** One float32 step at magnitude 1: the GPU draws every world in float32. */
export const FLOAT32_STEP = 2 ** -23
/** One mebibyte, in bytes. */
export const MIB = 1024 * 1024
