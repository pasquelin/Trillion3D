// Pseudo-random draws of the correctness campaigns: the xorshift generator one campaign published
// its figures with, and the two distributions every campaign draws from. The other campaign
// draws from the repository's `mulberry32` (site/examples/kit/random.ts); the generators stay
// distinct — changing one would move its cases — but `entre` and `log` have only one writing.

/** Xorshift32: three exclusive shifts, the state never passing through zero. */
export function xorshift32(graine: number): () => number {
  let etat = graine;
  return () => {
    etat ^= etat << 13;
    etat ^= etat >>> 17;
    etat ^= etat << 5;
    return (etat >>> 0) / 4294967296;
  };
}

/**
 * The two distributions drawn from a generator: `entre(a, b)` uniform on the interval, `log(a, b)`
 * uniform on a log scale — the one that covers the decades of a distance, a radius or an error
 * equally.
 */
export function lois(hasard: () => number): {
  hasard: () => number;
  entre: (a: number, b: number) => number;
  log: (a: number, b: number) => number;
} {
  return {
    hasard,
    entre: (a: number, b: number) => a + (b - a) * hasard(),
    log: (a: number, b: number) => a * (b / a) ** hasard(),
  };
}
