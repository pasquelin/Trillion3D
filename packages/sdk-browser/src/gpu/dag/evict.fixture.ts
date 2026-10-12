import { REQUEST_AHEAD } from './request.ts'
import { sortStaged, stagedPage, stagedRequest } from './request.fixture.ts'
import { AHEAD_AGE, EVICT_LEVELS, OLD_STEP, canonicalPage, evictionRank } from './evict.ts'
import { groupParentBase, keyGroupBase, keyWordBase, recordKeyBase } from './layout.ts'
import type { PackedDag } from './types.ts'
import { rootOfPacked } from '../../page/selection/placements.ts'

/** The key groups of a packing as the kernels read them (`evict.ts`): each key's group, and each
 *  group's parents from `parentStart[g]` to `parentStart[g + 1]`. */
export type KeyGroups = {
  keyGroups: ArrayLike<number>
  parentStart: ArrayLike<number>
  parents: ArrayLike<number>
}

/**
 * CPU mirror of `raiseUse` and `dagRaiseParents` (`shader/lastUseWgsl.ts`): each group of `groups`
 * raised to `value` in `lastUse`, and every group replacing a raised one raised to its clock, until
 * none rises. Returns the groups that rose, each once.
 */
export function raiseGroups(
  lastUse: Uint32Array,
  { parentStart, parents }: Pick<KeyGroups, 'parentStart' | 'parents'>,
  groups: Iterable<number>,
  value: number,
) {
  const rose: number[] = []
  const raise = (g: number, v: number) => {
    if (lastUse[g] >= v) return
    lastUse[g] = v
    rose.push(g)
  }
  for (const g of groups) raise(g, value)
  for (let i = 0; i < rose.length; i++) {
    const g = rose[i]
    for (let p = parentStart[g]; p < parentStart[g + 1]; p++) raise(parents[p], lastUse[g])
  }
  return rose
}

/** The clock a page the view ahead asks for is stamped with at frame `now` (`stampAhead`). */
export const aheadClock = (now: number) => Math.max(now, AHEAD_AGE) - AHEAD_AGE

/**
 * CPU mirror of `dagListEvictions`: the pool's listed content keys (`poolList.ts`) no view uses, by
 * `evictionRank` through `sortStaged`, the first `cap`, each as its canonical page — within a rank,
 * page order —, and how many of them form the OLD head (`OLD_STEP`).
 */
export function listEvictions(options: {
  pool: Iterable<number>
  keyWords: ArrayLike<number>
  /** The last use of key `key`: its group's word. */
  useOf: (key: number) => number
  now: number
  cap: number
}) {
  const { pool, keyWords, useOf, now, cap } = options
  const words: number[] = []
  let old = 0
  for (const key of pool) {
    const rank = evictionRank(keyWords[key], now - useOf(key))
    if (rank === undefined) continue
    if (rank >= OLD_STEP * EVICT_LEVELS) old++
    words.push(stagedRequest(canonicalPage(keyWords[key]), rank ^ REQUEST_AHEAD))
  }
  const queue = sortStaged(words).slice(0, Math.max(0, cap)).map(stagedPage)
  return { queue, old: Math.min(old, queue.length) }
}

/** The content key of `packed`'s page `page`, through its record (`layout.ts`), the key words, and
 *  the key groups. */
export function pageKeys(packed: PackedDag) {
  const cold = new Uint32Array(packed.pageCones.buffer, packed.pageCones.byteOffset)
  const recordKeys = cold.subarray(recordKeyBase(packed.pageCount)),
    keyWords = cold.subarray(keyWordBase(packed)),
    keyGroups = cold.subarray(keyGroupBase(packed), keyGroupBase(packed) + packed.keyCount),
    groupAt = groupParentBase(packed),
    parentStart = cold.subarray(groupAt, groupAt + packed.groupCount + 1),
    parents = cold.subarray(
      groupAt + packed.groupCount + 1,
      groupAt + packed.groupCount + 1 + packed.groupEdges,
    )
  const keyOf = (page: number) =>
    recordKeys[(page + packed.recordShift[rootOfPacked(packed.pageIndex, page)]) >>> 0]
  return {
    keyOf,
    keyWords,
    keyWordOf: (page: number) => keyWords[keyOf(page)],
    groups: { keyGroups, parentStart, parents } satisfies KeyGroups,
    groupOf: (page: number) => keyGroups[keyOf(page)],
  }
}
