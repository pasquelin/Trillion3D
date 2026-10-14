/**
 * Rank copies the cut's lists share: a list remade in place, its length the source's. They live
 * beside the cut, which the core holds, so the core never reaches the renderer's pages for them.
 */
/** Copies `source` into `target`, rank by rank: neither push, nor a prior clear; `target` takes
 *  `source`'s live length. A typed buffer of packed ranks is grown and never shrunk, so `count`
 *  names its live ranks when it is shorter (`#1235`). */
export function copyRanks<T>(target: T[], source: ArrayLike<T>, count = source.length) {
  for (let i = 0; i < count; i++) target[i] = source[i]
  target.length = count
}
