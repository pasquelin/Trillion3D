/**
 * Integer helpers of counts, sizes and powers of two, the one home of the spellings the engine
 * repeats: dispatch sizes, buffer alignment, bit sets, mip chains. Each is the plain expression,
 * so a call costs what the expression costs.
 *
 * Input rule, shared: arguments are finite integers in the stated range. Outside it a result is
 * whatever the named expression gives (NaN propagates; a zero divisor gives Infinity or NaN), and
 * is not checked here.
 */

/** The groups of `size` that `count` takes, the last one part full: `Math.ceil(count / size)`. */
export const ceilDiv = (count: number, size: number) => Math.ceil(count / size)

/**
 * The workgroups that cover `n` threads of `size` each, one at least (a dispatch of zero groups is
 * legal but a binding then never runs): `Math.max(1, Math.ceil(n / size))`.
 */
export const workgroupCount = (n: number, size: number) => Math.max(1, Math.ceil(n / size))

/** The least multiple of `n` not under `x`: `Math.ceil(x / n) * n`. Any `n > 0`, not only powers of two. */
export const alignUp = (x: number, n: number) => Math.ceil(x / n) * n

/** The greatest multiple of `n` not over `x`: `Math.floor(x / n) * n`. Any `n > 0`. */
export const alignDown = (x: number, n: number) => Math.floor(x / n) * n

/** The least power of two not under `v`, 1 at least (every `v <= 1`, 0 and negatives included, gives 1). */
export const nextPow2 = (v: number) => (v <= 1 ? 1 : 2 ** Math.ceil(Math.log2(v)))

/** The exponent of the greatest power of two not over `v`, for an integer `v` in `[1, 2 ** 32[`; 0 gives -1. */
export const floorLog2 = (v: number) => 31 - Math.clz32(v)

/** Whether the integer `v` is a power of two, 1 included; 0 and negatives are not. Int32 range (bitwise: a fraction truncates, 0.5 reads as 0 and gives true). */
export const isPow2 = (v: number) => v > 0 && (v & (v - 1)) === 0

/** The 32-bit words that hold `n` bits, `n >= 0` an integer below 2 ** 32: `(n + 31) >>> 5`. */
export const bitWords = (n: number) => (n + 31) >>> 5
