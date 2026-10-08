/** The integer two little-endian `u32` words `low`, `high` hold, `low + high * 2 ** 32`: exact up
 *  to `2 ** 53`, past which it rounds to the nearest double. */
export const uint64FromWords = (low: number, high: number) => low + high * 2 ** 32
