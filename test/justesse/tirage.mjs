// Pseudo-random draws of the correctness campaigns: a reproducible generator, and the two
// distributions every campaign draws from. The generators stay distinct — each campaign published
// its figures with its own, changing it would move its cases — but `entre` and `log` now have
// only one writing.

/** Mulberry32: well-dispersed 32-bit sequence, advanced one step per draw. */
export function mulberry32(graine) {
  let etat = graine;
  return () => {
    etat = (etat + 0x6d2b79f5) | 0;
    let t = Math.imul(etat ^ (etat >>> 15), 1 | etat);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Xorshift32: three exclusive shifts, the state never passing through zero. */
export function xorshift32(graine) {
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
export function lois(hasard) {
  return {
    hasard,
    entre: (a, b) => a + (b - a) * hasard(),
    log: (a, b) => a * (b / a) ** hasard(),
  };
}
