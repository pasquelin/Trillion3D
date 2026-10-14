import { KEY_PAGE_BITS, canonicalPage } from './evict.ts'
import { EVICT_IN_USE, OLD_STEP, POOL_RANKS, POOL_TIERS } from '../pool/rank.ts'
import { poolRank } from '../pool/rank.fixture.ts'
import { sortPool } from '../pool/sort.fixture.ts'
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
export const aheadClock = (now: number) => Math.max(now, EVICT_IN_USE) - EVICT_IN_USE

/**
 * THE CONTRACT of the geometry queue (`shader/evictWgsl.ts`), not its steps: the pool's listed
 * content keys (`poolList.ts`) no view uses, by `poolRank`, the highest first and a rank's keys in
 * the pool's order, as the pool sort lists them (`sortPool`); the first `cap`, each as its
 * canonical page; and how many of them form the OLD head — a rank of `OLD_STEP` or past.
 */
export function listEvictions(options: {
  pool: Iterable<number>
  keyWords: ArrayLike<number>
  /** The last use of key `key`: its group's word. */
  useOf: (key: number) => number
  now: number
  cap: number
}) {
  const { keyWords, useOf, now, cap } = options
  const pool = Array.from(options.pool)
  const ranks = pool.map((key) =>
    poolRank(now - useOf(key), keyWords[key] >>> KEY_PAGE_BITS, EVICT_IN_USE),
  )
  const { queue } = sortPool(pool.length, (j) => ranks[j], cap)
  const old = ranks.filter((rank) => rank >= OLD_STEP * POOL_TIERS && rank < POOL_RANKS).length
  return {
    queue: queue.map((j) => canonicalPage(keyWords[pool[j]])),
    old: Math.min(old, queue.length),
  }
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
