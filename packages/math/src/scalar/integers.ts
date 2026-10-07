/** Integer helpers of counts, sizes and powers of two: each the plain expression. */

/** The groups of `size` that `count` takes, the last one part full: `Math.ceil(count / size)`. */
export const ceilDiv = (count: number, size: number) => Math.ceil(count / size)

/** The workgroups that cover `n` threads of `size` each, one at least. */
export const workgroupCount = (n: number, size: number) => Math.max(1, Math.ceil(n / size))

/** The least multiple of `n > 0` not under `x`: `Math.ceil(x / n) * n`. */
export const alignUp = (x: number, n: number) => Math.ceil(x / n) * n

/** The greatest multiple of `n > 0` not over `x`: `Math.floor(x / n) * n`. */
export const alignDown = (x: number, n: number) => Math.floor(x / n) * n

/** The exponent of the least power of two not under the integer `v`, 1 ≤ v ≤ 2^32:
 *  `32 − clz32(v − 1)`, exact on that whole domain (`v − 1` fits 32 bits). */
const ceilLog2 = (v: number) => 32 - Math.clz32(v - 1)

/** The least power of two not under `v`: 1 for every `v <= 1`, `2 ** ceilLog2(⌈v⌉)` exactly for any
 *  real `v` up to 2^32 — every caller sizes a buffer, a table or a count far below —, NaN for NaN;
 *  past 2^32 it throws rather than wrap. */
export function nextPow2(v: number) {
  if (v <= 1) return 1
  if (v <= 2 ** 32) return 2 ** ceilLog2(Math.ceil(v))
  if (v !== v) return NaN
  throw new RangeError(`nextPow2: ${v} is past 2^32`)
}

/** The exponent of the greatest power of two not over the integer `v`; 0 gives -1. */
export const floorLog2 = (v: number) => 31 - Math.clz32(v)

/** Whether the int32 `v` is a power of two, 1 included; 0 and negatives are not. */
export const isPow2 = (v: number) => v > 0 && (v & (v - 1)) === 0

/** The 32-bit words that hold `n` bits, `n` a non-negative integer: exact up to 2^53, so a count read
 *  from untrusted data never wraps as `(n + 31) >>> 5` would from 2^32 - 31; no count (NaN) holds none. */
export const bitWords = (n: number) => Math.ceil(n / 32) || 0
