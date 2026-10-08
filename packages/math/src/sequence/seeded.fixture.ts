/**
 * The test inputs' seeded generators of the recurrence `x · 1103515245 + 12345`, kept as the tests
 * and fixtures drew them, so their streams stay the same numbers: on `Math.imul` (wrapped), in
 * doubles (the product rounds above 2⁵³) or masked to 31 bits. Test inputs only; the engine's
 * generators are `random.ts`.
 */

/** 2³²: a 32-bit word over it lies in `[0, 1)`, exactly. */
const WORD_RANGE = 4294967296

/** One step of the recurrence `x · 1103515245 + 12345` on `Math.imul`, wrapping: the state moved, as
 *  an unsigned word. */
const lcgImulStep = (state: number) => (Math.imul(state, 1103515245) + 12345) >>> 0

/** The same recurrence in doubles: the product passes 2⁵³ and rounds, so its low word is not the
 *  wrapped one of `lcgImulStep`; the streams the fixtures drew this way are kept bit for bit. */
const lcgFloatStep = (state: number) => (state * 1103515245 + 12345) >>> 0

/** The doubles recurrence masked to 31 bits instead of wrapped to 32. */
const lcgMaskedStep = (state: number) => (state * 1103515245 + 12345) & 0x7fffffff

/** The words of `step` from `seed`: each draw is the stepped state. */
const run = (step: (state: number) => number, seed: number) => {
  let state = seed
  return () => (state = step(state))
}

/** A word source over `[0, 1)`. */
const unit = (word: () => number) => () => word() / WORD_RANGE

/** The `x · 1103515245 + 12345` words from `seed`, on `Math.imul`: each draw is the stepped word. */
export const lcgImulWord = (seed: number) => run(lcgImulStep, seed >>> 0)

/** The lcgImulWord sequence over `[0, 1)`. */
export const lcgImulRandom = (seed: number) => unit(lcgImulWord(seed))

/** The `x · 1103515245 + 12345` words from `seed`, the product in doubles (it rounds above 2⁵³). */
export const lcgFloatWord = (seed: number) => run(lcgFloatStep, seed)

/** The lcgFloatWord sequence over `[0, 1)`. */
export const lcgFloatRandom = (seed: number) => unit(lcgFloatWord(seed))

/** The doubles recurrence masked to 31 bits, over `[0, 1]`: the masked word over `0x7fffffff`. */
export function lcgMaskedRandom(seed: number) {
  const word = run(lcgMaskedStep, seed)
  return () => word() / 0x7fffffff
}
