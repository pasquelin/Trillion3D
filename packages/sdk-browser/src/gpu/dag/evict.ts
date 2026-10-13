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
 * order the views cut in. Never listed below this age. A page the view AHEAD of the camera asks for
 * (`shader/aheadWgsl.ts`) counts as used this many frames ago: listed after every page older than
 * that, before any page in use — the camera's pages evict it, it never evicts one of theirs.
 */
export const EVICT_IN_USE = 2
/** The first age step of the OLD keys — a step a doubling of the age, its bit length —: older than
 *  any page the view ahead asks for. The queue's head of old keys is what a page of the view ahead
 *  may take the place of (`evictOld`). */
export const OLD_STEP = 32 - Math.clz32(EVICT_IN_USE) + 1
/** A key word: the canonical page on twenty-seven bits — 134,217,728 packed instances —, the level
 *  in the five above, as many as `EVICT_LEVELS` tells apart. */
export const KEY_PAGE_BITS = 27
export const KEY_PAGE_MAX = 2 ** KEY_PAGE_BITS
const keyWord = (page: number, level: number) =>
  ((Math.min(EVICT_LEVELS - 1, level) << KEY_PAGE_BITS) | page) >>> 0
const keyLevel = (word: number) => word >>> KEY_PAGE_BITS
/**
 * The CONTENT KEYS OF A PACKING, one per page address (`pageAddress`) in packing order, and their
 * GROUPS: a group of the compiled structure is one group whatever placement holds it, and a cluster
 * nothing replaces is a group of its own. A group lists the groups that replace its outputs — each
 * once — in `parentStart[g]` to `parentStart[g + 1]`. Placement `w`'s pages read records from
 * `pageBase + recordShift[w]` (`layout.ts`): one record serves every placement of its primitive, and
 * so does its key — no word per page.
 *
 * The keys are made as the roots are placed, one at a time (`place`), a root appended in place
 * (`appendDagRoots`) continuing where the packing stopped: the page array of a root already placed
 * names its keys and groups again, once; the first of another brings its own, behind the live ones.
 * `flush` writes what was made since the last, into the cold table's words, and names what it wrote.
 */
export function createContentKeys() {
  const keyOf = new Map<string, number>(),
    written = new Map<DagRoot['pages'], Set<number>>(),
    /** The page arrays whose groups are made. */
    groupIds = new Map<DagRoot['pages'], true>(),
    /** The group of its own of each key whose cluster nothing replaces. */
    alone = new Map<number, number>(),
    keyWords: number[] = [],
    keyGroups: number[] = [],
    parentStart: number[] = [0],
    parents: number[] = [],
    /** The records' keys, as pairs: the record, its key. */
    recordKeys: number[] = [],
    touched = new Set<number>()
  let groupCount = 0,
    sent = { records: 0, groups: 0, edges: 0 }
  /**
   * The groups of `root`'s array, placed for the first time: each page's group — its structure's, or
   * its key's own — and the groups that replace each one's outputs. `ctx` makes a group, finds or
   * records the group of a key's own by its address, and is told each page's group: the same walk
   * counts what an array would add (`mostGroups`) and adds it (`addGroups`).
   */
  const walkGroups = (
    root: DagRoot,
    ctx: {
      fresh(): number
      aloneOf(address: string): number | undefined
      setAlone(address: string, group: number): void
      page(p: number, group: number): void
    },
  ) => {
    const s = root.structure,
      ids = new Int32Array(s?.groupCount ?? 0).fill(-1),
      parentsOf = new Map<number, number[]>()
    const groupOf = (p: number) => {
      const owner = s?.owners[p] ?? -1
      if (owner >= 0) {
        if (ids[owner] < 0) ids[owner] = ctx.fresh()
        return ids[owner]
      }
      const address = pageAddress(root.pages[p])
      let g = ctx.aloneOf(address)
      if (g === undefined) {
        g = ctx.fresh()
        ctx.setAlone(address, g)
      }
      return g
    }
    for (let p = 0; p < root.pages.length; p++) ctx.page(p, groupOf(p))
    if (s)
      for (let owner = 0; owner < s.groupCount; owner++) {
        if (ids[owner] < 0) continue
        const into = parentsOf.get(ids[owner]) ?? parentsOf.set(ids[owner], []).get(ids[owner])!
        for (let i = s.outputOffsets[owner]; i < s.outputOffsets[owner + 1]; i++) {
          const parent = groupOf(s.outputs[i])
          if (!into.includes(parent)) into.push(parent)
        }
      }
    return parentsOf
  }
  /** The groups of an array placed for the first time, and the groups that replace them. */
  const addGroups = (root: DagRoot) => {
    groupIds.set(root.pages, true)
    const pending = walkGroups(root, {
      fresh: () => groupCount++,
      aloneOf: (address) => alone.get(keyOf.get(address)!),
      setAlone: (address, group) => alone.set(keyOf.get(address)!, group),
      page(p, group) {
        const k = keyOf.get(pageAddress(root.pages[p]))!
        if (keyGroups[k] === undefined) {
          keyGroups[k] = group
          touched.add(k)
        }
      },
    })
    // Their parents behind the groups held: each group's list is complete once its array is placed.
    for (let g = parentStart.length - 1; g < groupCount; g++) {
      parents.push(...(pending.get(g) ?? []))
      parentStart.push(parents.length)
    }
  }
  return {
    /** The keys held. */
    get count() {
      return keyOf.size
    },
    /** The groups held, and the parent edges between them. */
    get groups() {
      return groupCount
    },
    get edges() {
      return parents.length
    },
    /** Whether placing `root`'s pages would name an address no key holds yet: how many. */
    newKeys(pages: DagRoot['pages']) {
      const fresh = new Set<string>()
      for (const rec of pages) {
        const address = pageAddress(rec)
        if (!keyOf.has(address)) fresh.add(address)
      }
      return fresh.size
    },
    /** The groups and edges placing `root` would add: none for an array placed already. The same
     *  walk as the placement's, over the groups held and none made. */
    mostGroups(root: DagRoot) {
      if (groupIds.has(root.pages)) return { groups: 0, edges: 0 }
      let made = 0
      const aloneHere = new Map<string, number>()
      const parentsOf = walkGroups(root, {
        fresh: () => made++,
        aloneOf: (address) => {
          const k = keyOf.get(address)
          return k === undefined ? aloneHere.get(address) : (alone.get(k) ?? aloneHere.get(address))
        },
        setAlone: (address, group) => aloneHere.set(address, group),
        page: () => {},
      })
      let edges = 0
      for (const list of parentsOf.values()) edges += list.length
      return { groups: made, edges }
    },
    /** Placement of `root`: `pageBase` its first page, `recordBase` the first of its records. */
    place(root: DagRoot, pageBase: number, recordBase: number) {
      // A page array placed again on the records it already has names the same keys: once each.
      let bases = written.get(root.pages)
      if (!bases) written.set(root.pages, (bases = new Set()))
      if (bases.has(recordBase)) return
      bases.add(recordBase)
      root.pages.forEach((rec, p) => {
        const address = pageAddress(rec),
          level = Math.max(0, Math.trunc(rec.level ?? 0))
        let k = keyOf.get(address)
        if (k === undefined) {
          keyOf.set(address, (k = keyOf.size))
          keyWords[k] = keyWord(pageBase + p, level)
          touched.add(k)
        } else if (level > keyLevel(keyWords[k])) {
          keyWords[k] = keyWord(canonicalPage(keyWords[k]), level)
          touched.add(k)
        }
        recordKeys.push(recordBase + p, k)
      })
      if (!groupIds.has(root.pages)) addGroups(root)
    },
    /**
     * Writes what `place` made since the last `flush` into `words`: the records' keys, the words and
     * groups of the keys made or moved, the groups' parent starts and the edges. `at` names where
     * each table lies, `groupCapacity` the groups the parent starts have room for. What it wrote:
     * the keys, the groups `[from, to)` whose starts were written, and the edges.
     */
    flush(
      words: Uint32Array,
      at: {
        recordKey: number
        keyWord: number
        keyGroup: number
        groupParent: number
        groupCapacity: number
      },
    ) {
      for (let i = sent.records; i < recordKeys.length; i += 2)
        words[at.recordKey + recordKeys[i]] = recordKeys[i + 1]
      for (const k of touched) {
        words[at.keyWord + k] = keyWords[k]
        words[at.keyGroup + k] = keyGroups[k]
      }
      for (let g = sent.groups; g < groupCount; g++)
        words[at.groupParent + g + 1] = parentStart[g + 1]
      const edgeAt = at.groupParent + at.groupCapacity + 1
      for (let e = sent.edges; e < parents.length; e++) words[edgeAt + e] = parents[e]
      const wrote = {
        keys: [...touched],
        groups: [sent.groups, groupCount] as const,
        edges: [sent.edges, parents.length] as const,
      }
      touched.clear()
      sent = { records: recordKeys.length, groups: groupCount, edges: parents.length }
      return wrote
    },
  }
}

export type ContentKeys = ReturnType<typeof createContentKeys>

/** The page a key word names: the one the queue lists for its key. */
export const canonicalPage = (word: number) => word & (KEY_PAGE_MAX - 1)
