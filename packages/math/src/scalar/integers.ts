/** Integer helpers of counts, sizes and powers of two: each the plain expression. */

/** The groups of `size` that `count` takes, the last one part full: `Math.ceil(count / size)`. */
export const ceilDiv = (count: number, size: number) => Math.ceil(count / size)

/** The workgroups that cover `n` threads of `size` each, one at least. */
export const workgroupCount = (n: number, size: number) => Math.max(1, Math.ceil(n / size))

/** The least multiple of `n > 0` not under `x`: `Math.ceil(x / n) * n`. */
export const alignUp = (x: number, n: number) => Math.ceil(x / n) * n

/** The greatest multiple of `n > 0` not over `x`: `Math.floor(x / n) * n`. */
export const alignDown = (x: number, n: number) => Math.floor(x / n) * n

/** The least power of two not under `v`, 1 for every `v <= 1`. */
export const nextPow2 = (v: number) => (v <= 1 ? 1 : 2 ** Math.ceil(Math.log2(v)))

/** The exponent of the greatest power of two not over the integer `v`; 0 gives -1. */
export const floorLog2 = (v: number) => 31 - Math.clz32(v)

/** Whether the int32 `v` is a power of two, 1 included; 0 and negatives are not. */
export const isPow2 = (v: number) => v > 0 && (v & (v - 1)) === 0

/** The 32-bit words that hold `n` bits, `n` an integer in `[0, 2 ** 32[`: `(n + 31) >>> 5`. */
export const bitWords = (n: number) => (n + 31) >>> 5
