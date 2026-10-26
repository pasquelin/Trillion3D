import { resized } from '../../../../../math/src/sequence/resized.ts'

/** Copies `source` into `target`, rank by rank: neither push, nor a prior clear; `target` takes
 *  `source`'s live length. A typed buffer of packed ranks is grown and never shrunk, so `count`
 *  names its live ranks when it is shorter (`#1235`). */
export function copyRanks<T>(target: T[], source: ArrayLike<T>, count = source.length) {
  for (let i = 0; i < count; i++) target[i] = source[i]
  target.length = count
}

/** The packed ranks of a record list, parallel to it: `ids` is grown and never shrunk, `count`
 *  names the live ranks. */
export type RankList = { ids: Int32Array; count: number }

export const createRankList = (): RankList => ({ ids: new Int32Array(8), count: 0 })

/** Copies the first `count` ranks of `source` into `target` in one block move. */
export function copyRankList(target: RankList, source: Int32Array, count: number) {
  target.ids = resized(target.ids, count)
  target.ids.set(count === source.length ? source : source.subarray(0, count))
  target.count = count
}
