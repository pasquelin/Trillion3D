/**
 * THE PAINT ORDER of a blend pass, one rule for the CPU sort (`sortPlan.ts`), the GPU sort that
 * mirrors it (`orderWgsl.ts`) and the CPU model: a total order, decreasing key, then increasing
 * rank — the GPU's and the CPU model's rank is the seed, in source order.
 *
 * Rank breaks equal keys, so the result depends neither on the previous frame, nor on arrival
 * order, nor on the machine — two overlapping items cannot swap from one frame to the next, so
 * the image does not flicker. A NaN key — a non-finite eye or item position — ranks farthest,
 * NaN keys among themselves by rank: compared as it is, a NaN would answer false both ways and
 * leave the entry wherever the previous frame had put it. `true` says the already-placed entry
 * must recede.
 */
export function precedes(keyA: number, rankA: number, keyB: number, rankB: number) {
  if (keyA === keyB) return rankA > rankB
  if (keyB !== keyB) return keyA === keyA || rankA > rankB
  return keyA < keyB
}
