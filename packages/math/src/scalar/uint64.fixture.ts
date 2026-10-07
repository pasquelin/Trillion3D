/** The two little-endian `u32` words of the integer `value < 2 ** 53`: `value % 2 ** 32`, then
 *  `Math.floor(value / 2 ** 32)`; `uint64FromWords` reads them back. */
export const uint64Words = (value: number) => [value % 2 ** 32, Math.floor(value / 2 ** 32)]
