import { pageAddress } from '../../webgpu/row/pageSlots.ts'
import { REQUEST_PRIORITY_MAX } from './request.ts'
import type { DagRoot } from './types.ts'

/**
 * The EVICTION QUEUE the GPU cut publishes on its readback (#872, `shader/evictWgsl.ts`). The cache
 * evicts per content key (`pageAddress`), and so does the GPU: a record names its key, a key's word
 * names its address's first page — its CANONICAL page, the one the queue lists — in its low
 * `KEY_PAGE_BITS`, and carries the key's coarsest level (#824) in the five above.
 *
 * A key's last use is its GROUP's (`shader/lastUseWgsl.ts`): the cut rule draws a cluster only with
 * its whole group, and a group only under the groups that replace it, up to the roots
 * (`../../page/cut/readiness.ts`). So a group's word is the last frame any view drew or asked for one
 * of its clusters, or for a cluster under it: a group is never older than a group it replaces.
 * Oldest use first, then finer level first among equal ages — a child leaves before its parent
 * (#477) —; a key some view used this frame or the one before is never listed.
 */
/** Levels and age steps the rank tells apart, the request's priority field split in two halves. */
export const EVICT_LEVELS = 32,
  EVICT_AGES = (REQUEST_PRIORITY_MAX + 1) / EVICT_LEVELS
/**
 * Frames a use protects its key for: the frame that used it and the one after, so a key any view
 * — a light's, a view drawn beside the main one — used in the frame before is still in use, whatever
 * order the views cut in. Never listed below this age.
 */
export const EVICT_IN_USE = 2
/**
 * What a page the view AHEAD of the camera asks for counts as (`shader/aheadWgsl.ts`): used this many
 * frames ago. Listed after every page older than that, before any page in use: the camera's pages
 * evict it, it never evicts one of theirs.
 */
export const AHEAD_AGE = EVICT_IN_USE
/** The age step a rank is made of: one step per doubling of the age (`bitLength`). */
export const ageStep = (age: number) => Math.min(EVICT_AGES - 1, 32 - Math.clz32(age >>> 0))
/** The first age step of the OLD keys: older than any page the view ahead asks for. The queue's
 *  head of old keys is what a page of the view ahead may take the place of (`oldEvictions`). */
export const OLD_STEP = ageStep(AHEAD_AGE) + 1
/** A key word: the canonical page on twenty-seven bits — 134,217,728 packed instances —, the level
 *  in the five above, as many as `EVICT_LEVELS` tells apart. */
export const KEY_PAGE_BITS = 27
export const KEY_PAGE_MAX = 2 ** KEY_PAGE_BITS
const keyWord = (page: number, level: number) =>
  ((Math.min(EVICT_LEVELS - 1, level) << KEY_PAGE_BITS) | page) >>> 0
const keyLevel = (word: number) => word >>> KEY_PAGE_BITS
/** Rank of a key in the queue, the highest evicted first: older age step, then finer level. Integer
 *  only, as `evictRank` in the kernel; `undefined` for a key in use. */
export function evictionRank(keyWordOf: number, age: number) {
  if (age < EVICT_IN_USE) return undefined
  return ageStep(age) * EVICT_LEVELS + (EVICT_LEVELS - 1 - keyLevel(keyWordOf))
}

/**
 * The content keys of `roots`, one per page address (`pageAddress`) in packing order, and their
 * GROUPS: a group of the compiled structure is one group whatever placement holds it, and a
 * cluster nothing replaces is a group of its own. `parents` lists, for each group, the groups that
 * replace its outputs — each once —, in `parentStart[g]` to `parentStart[g + 1]`.
 */
export function contentKeys(roots: readonly DagRoot[]) {
  const keyOf = new Map<string, number>(),
    /** Each page array's group ids, by its structure's group. */
    groupIds = new Map<DagRoot['pages'], Int32Array>(),
    /** The group of its own of each key whose cluster nothing replaces. */
    alone = new Map<number, number>(),
    keyGroups: number[] = []
  let groupCount = 0
  const arrays: DagRoot[] = []
  for (const root of roots)
    if (!groupIds.has(root.pages)) {
      groupIds.set(root.pages, new Int32Array(root.structure?.groupCount ?? 0).fill(-1))
      arrays.push(root)
    }
  /** The group of page `p` of `root`'s array: its structure's, or its key's own. */
  const groupOf = (root: DagRoot, p: number) => {
    const owner = root.structure?.owners[p] ?? -1
    if (owner >= 0) {
      const ids = groupIds.get(root.pages)!
      if (ids[owner] < 0) ids[owner] = groupCount++
      return ids[owner]
    }
    const k = keyOf.get(pageAddress(root.pages[p]))!
    let g = alone.get(k)
    if (g === undefined) alone.set(k, (g = groupCount++))
    return g
  }
  for (const root of arrays)
    root.pages.forEach((rec, p) => {
      const address = pageAddress(rec)
      if (!keyOf.has(address)) keyOf.set(address, keyOf.size)
      const k = keyOf.get(address)!,
        g = groupOf(root, p)
      if (keyGroups[k] === undefined) keyGroups[k] = g
    })
  const parentsOf: number[][] = Array.from({ length: groupCount }, () => [])
  for (const root of arrays) {
    const s = root.structure,
      ids = groupIds.get(root.pages)!
    if (!s) continue
    for (let owner = 0; owner < s.groupCount; owner++) {
      if (ids[owner] < 0) continue
      const into = parentsOf[ids[owner]]
      for (let i = s.outputOffsets[owner]; i < s.outputOffsets[owner + 1]; i++) {
        const parent = groupOf(root, s.outputs[i])
        if (!into.includes(parent)) into.push(parent)
      }
    }
  }
  const parentStart = new Uint32Array(groupCount + 1)
  for (let g = 0; g < groupCount; g++) parentStart[g + 1] = parentStart[g] + parentsOf[g].length
  return {
    keyOf: keyOf as ReadonlyMap<string, number>,
    keyCount: Math.max(1, keyOf.size),
    groupCount,
    keyGroups: Uint32Array.from(keyGroups),
    parentStart,
    parents: Uint32Array.from(parentsOf.flat()),
  }
}

export type ContentKeys = ReturnType<typeof contentKeys>

/**
 * Writes the content keys of a packing: each unique record's key at `words[recordKeyAt + r]`, each
 * key's word at `words[keyWordAt + k]` — its canonical page, the first page of its address in
 * packing order, and its coarsest level —, each key's group at `words[keyGroupAt + k]`, then each
 * group's parents from `words[groupParentAt]`: the `groupCount + 1` starts, then the parents.
 * Placement `w`'s pages read records from `pageBase + recordShift[w]` (`layout.ts`): one record
 * serves every placement of its primitive, and so does its key — no word per page.
 */
export function writeKeyTables(
  roots: readonly DagRoot[],
  places: { cutLinks: readonly { pageBase: number }[]; recordShift: Uint32Array },
  words: Uint32Array,
  at: { recordKey: number; keyWord: number; keyGroup: number; groupParent: number },
  keys: ContentKeys,
) {
  const placed = new Uint8Array(keys.keyCount),
    written = new Map<DagRoot['pages'], Set<number>>()
  roots.forEach((root, w) => {
    const pageBase = places.cutLinks[w].pageBase,
      recordBase = (pageBase + places.recordShift[w]) >>> 0
    // A page array placed again on the records it already has names the same keys: once each.
    let bases = written.get(root.pages)
    if (!bases) written.set(root.pages, (bases = new Set()))
    if (bases.has(recordBase)) return
    bases.add(recordBase)
    root.pages.forEach((rec, p) => {
      const k = keys.keyOf.get(pageAddress(rec))!,
        level = Math.max(0, Math.trunc(rec.level ?? 0))
      if (!placed[k]) {
        placed[k] = 1
        words[at.keyWord + k] = keyWord(pageBase + p, level)
      } else if (level > keyLevel(words[at.keyWord + k]))
        words[at.keyWord + k] = keyWord(canonicalPage(words[at.keyWord + k]), level)
      words[at.recordKey + recordBase + p] = k
    })
  })
  words.set(keys.keyGroups, at.keyGroup)
  words.set(keys.parentStart, at.groupParent)
  words.set(keys.parents, at.groupParent + keys.groupCount + 1)
}

/** The page a key word names: the one the queue lists for its key. */
export const canonicalPage = (word: number) => word & (KEY_PAGE_MAX - 1)
