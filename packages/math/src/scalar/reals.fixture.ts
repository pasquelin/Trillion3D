// The processor's twin of the shaders' `floorMod` (`../wgsl/reals.ts`), which its tests read the
// WGSL against.

/** `x` modulo `n` floored, the sign of `n`: `x − n · Math.floor(x / n)`. Unlike `wrap`
 *  it takes one division and one product, and a negative `n` folds into `(n, 0]`. */
export const floorMod = (x: number, n: number) => x - n * Math.floor(x / n)
