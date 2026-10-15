/**
 * The test inputs' one seeded generator on 32-bit unsigned integers, the twin of `lcg32` in
 * `packages/math/rust/src/random.rs`: integer arithmetic alone, so a seed gives the same numbers on
 * every run and every machine. The closure holds the state and gives a number in `[0, 1)`, the word
 * over 2³². Never for anything that must be unpredictable; the engine's hash is `mixWord`.
 */
import { WORD_RANGE } from '../constants.ts'

/** One step of the 32-bit linear congruential generator `x · 1664525 + 1013904223`, wrapping: the
 *  state moved, as an unsigned word. */
const lcg32 = (state: number) => (Math.imul(state, 1664525) + 1013904223) >>> 0

/** A sequence of numbers in `[0, 1)` drawn from a seed. */
export type Random = () => number

/** The lcg32 sequence over `[0, 1)` from `seed`. */
export function lcgRandom(seed: number): Random {
  let state = seed >>> 0
  return () => (state = lcg32(state)) / WORD_RANGE
}
