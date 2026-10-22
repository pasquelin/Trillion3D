// The ranges the sky's quality settings are held to.

/** The range of a 32-bit whole number, the type a count of the reference is held in. */
export const INT32: readonly [number, number] = [-2147483648, 2147483647]
/** The range of a 32-bit whole number of at least zero. */
export const INT32_FROM_ZERO: readonly [number, number] = [0, 2147483647]
/** The range of a table side or a slice count: a whole number of at least 4, the fewest the
 *  reference reads. */
export const TABLE_SIDE: readonly [number, number] = [4, 2147483647]
