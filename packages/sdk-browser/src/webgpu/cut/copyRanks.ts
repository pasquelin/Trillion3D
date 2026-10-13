/**
 * Rank copies the cut's lists share: a list remade in place, its length the source's. They live
 * beside the cut, which the core holds, so the core never reaches the renderer's pages for them.
 */
/** Copies `source` into `target`, rank by rank: neither push, nor a prior clear. */
export function copyPages<T>(target: T[], source: readonly T[]) {
  for (let i = 0; i < source.length; i++) target[i] = source[i]
  target.length = source.length
}
/** The same for packed ranks, from a typed list: `target` takes `source`'s live length. A typed
 *  buffer is grown and never shrunk, so `count` names its live ranks when it is shorter (`#1235`). */
export function copyPacked(target: number[], source: ArrayLike<number>, count = source.length) {
  for (let i = 0; i < count; i++) target[i] = source[i]
  target.length = count
}
