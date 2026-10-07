/**
 * Seeded generators on 32-bit unsigned integers, the twins of `packages/math/rust/src/random.rs`:
 * integer arithmetic alone, so a seed gives the same numbers on every run and every machine. Each
 * step is a pure function of the state; the `…Random` forms hold that state in the closure they
 * return, made once where a scene is laid out, and give a number in `[0, 1)`, the word over 2³².
 * Never for anything that must be unpredictable.
 */
import { GOLDEN_U32 } from '../constants.ts'

/** 2³²: a 32-bit word over it lies in `[0, 1)`, exactly. */
const WORD_RANGE = 4294967296

/** One step of the 32-bit xorshift (13, 17, 5): the state moved, as an unsigned word. */
export function xorshift32(state: number) {
  state = (state ^ (state << 13)) >>> 0
  state = (state ^ (state >>> 17)) >>> 0
  return (state ^ (state << 5)) >>> 0
}

/** One step of the 32-bit linear congruential generator `x · 1664525 + 1013904223`, wrapping: the
 *  state moved, as an unsigned word. */
export const lcg32 = (state: number) => (Math.imul(state, 1664525) + 1013904223) >>> 0

/** Mulberry32's state step, the odd increment `0x6d2b79f5`, wrapping. */
export const mulberry32Step = (state: number) => (state + 0x6d2b79f5) >>> 0

/** Mulberry32's output for a stepped state, a word mixed by two multiplications and three shifts. */
export function mulberry32Mix(state: number) {
  let value = Math.imul(state ^ (state >>> 15), state | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return (value ^ (value >>> 14)) >>> 0
}

/** The xorshift32 sequence over `[0, 1)` from `seed`; a zero seed, which xorshift never leaves,
 *  takes `GOLDEN_U32`. */
export function xorshiftRandom(seed: number) {
  let state = seed >>> 0 || GOLDEN_U32
  return () => (state = xorshift32(state)) / WORD_RANGE
}

/** The lcg32 sequence over `[0, 1)` from `seed`. */
export function lcgRandom(seed: number) {
  let state = seed >>> 0
  return () => (state = lcg32(state)) / WORD_RANGE
}

/** The Mulberry32 sequence over `[0, 1)` from `seed`: each draw steps the state, then mixes it. */
export function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => mulberry32Mix((state = mulberry32Step(state))) / WORD_RANGE
}
