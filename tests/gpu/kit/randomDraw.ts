// Pseudo-random draws of the correctness campaigns: the generators their cases were drawn with,
// and the two distributions every campaign draws from. The generators stay distinct —
// changing one would move its cases — but `between` (between) and `log` have only one writing.

/** A linear congruential step on 32-bit integers: the light-grid and resolve probes' draw. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
}

/** Xorshift32: three exclusive shifts, the state never passing through zero. */
export function xorshift32(seed: number): () => number {
  let state = seed
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

/**
 * The two distributions drawn from a generator: `between(a, b)` uniform on the interval, `log(a, b)`
 * uniform on a log scale — the one that covers the decades of a distance, a radius or an error
 * equally.
 */
export function lois(draw: () => number): {
  hasard: () => number
  between: (a: number, b: number) => number
  log: (a: number, b: number) => number
} {
  return {
    hasard: draw,
    between: (a: number, b: number) => a + (b - a) * draw(),
    log: (a: number, b: number) => a * (b / a) ** draw(),
  }
}
