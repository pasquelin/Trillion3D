/**
 * The float values every hostile-input case starts from: both zeros, NaN, both infinities and the
 * smallest subnormal. A case appends what its own input also has to survive.
 */
export const HOSTILE_FLOATS: readonly number[] = [0, -0, NaN, Infinity, -Infinity, 5e-324];
