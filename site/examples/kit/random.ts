/**
 * A sequence in [0, 1) from a seed: the same scene on every run and every machine. A linear
 * congruential step on 32-bit integers, the constants of Numerical Recipes: plenty for placing
 * pebbles and trees, never for anything that must be unpredictable.
 */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
}
