import type { PageRec } from '../selection/selection.ts'
import { createPageCatalogue, type PageList } from '../selection/catalogue.ts'
import type { ClusterRoot } from '../selection/types.ts'
import type { PlacementIndex } from '../selection/placements.ts'
import type { IdDelta } from '../../webgpu/cut/delta.ts'
import { createSparseInts, grown } from './sparseInts.ts'

/**
 * What the cache must hold for the cut to draw what it asks for: whole groups, closed upward.
 *
 * The cut rule reads residency by group (`./readiness.ts`): a cluster is drawn once
 * every cluster of its group is resident and so, up to the roots, is every group that replaces
 * its outputs. A cut that asked only for the clusters it draws would leave the group-mates a view
 * never keeps — past the frustum, behind the cone — outside the cache, and its surface drawn one
 * level coarser forever. So each page the cut names brings its group and the groups above it.
 *
 * Held by reference count per group, so a group many cut pages share is walked once: holding a
 * group holds its members and, for each of its outputs, the output's own group — or the output
 * itself when nothing replaces it. The difference it publishes is the one of the pages held, in
 * the same shape as the cut's (`IdDelta`), so every reader downstream is unchanged.
 *
 * Every placement of a primitive shares its records (#1235), and what the cache holds is a record,
 * never an instance: so a group is held once per primitive, named at the packed ranks of the first
 * placement that asked for it, however many placements the cut selects it on (#1232). The tables
 * follow the records the cut closes over — bounded by the view's rows —, never the world's instances.
 */
export type GroupClosure = ReturnType<typeof createGroupClosure>

/**
 * Every table is sparse (`./sparseInts.ts`): it holds the groups and pages the cut closes over,
 * never the placements' catalogue (#483 rule 6). A placement's pages are packed contiguously from
 * its root's packed base (`postPackedBases`, #1235), and a group is keyed by its first member's packed id, which no
 * other group shares.
 */
export function createGroupClosure(
  roots: readonly ClusterRoot<PageRec>[],
  /** The per-placement tables: the packed base of each root, the root of each packed rank (#1235). */
  placement: PlacementIndex,
  /** The packed catalogue `forEachHeld` resolves ids in. */
  packedPages: PageList = [],
) {
  /** Holders per group and per page, and the pages whose count moved in this difference with
   *  whether each was held before it (1 no, 2 yes). */
  const heldGroups = createSparseInts(),
    heldPages = createSparseInts(),
    seen = createSparseInts(),
    touched: number[] = []
  const delta = {
    entered: new Int32Array(8),
    exited: new Int32Array(8),
    enteredCount: 0,
    exitedCount: 0,
    has: (id: number) => heldPages.get(id) > 0,
  }
  /** Groups one `closeOver` walk reached. */
  const walked = createSparseInts()
  let /** What a walk does: counts `step` on what it reaches, or hands each page to `visitor`. */
    step = 0,
    visitor: ((id: number, rec: PageRec) => void) | undefined
  const { recordOf } = createPageCatalogue(packedPages)
  const baseOf = (r: number) => placement.baseOfRoot[r] ?? 0
  /** The placement a shared page list is held at: the first that asked, while it still places it. */
  const holder = new Map<readonly unknown[], number>()
  const holderOf = (r: number) => {
    const pages = roots[r].pages,
      known = holder.get(pages)
    if (known !== undefined && roots[known]?.pages === pages) return known
    holder.set(pages, r)
    return r
  }
  const touchId = (id: number, rec: PageRec) => {
    if (visitor) return visitor(id, rec)
    if (!seen.get(id)) {
      seen.set(id, heldPages.get(id) > 0 ? 2 : 1)
      touched.push(id)
    }
    heldPages.add(id, step)
  }
  const touch = (r: number, page: number) => touchId(baseOf(r) + page, roots[r].pages[page])
  /** Group `g` of placement `r` and what it holds: its members, and each output's own group — the
   *  output itself when nothing replaces it. A counted group is walked when it is first held or
   *  last released; a visited one once per walk. */
  const reach = (r: number, g: number) => {
    const s = roots[r].structure!,
      key = baseOf(r) + s.children[s.childOffsets[g]]
    if (visitor) {
      if (walked.set(key, 1)) return
    } else {
      const count = heldGroups.add(key, step)
      if (count - step > 0 === count > 0) return
    }
    for (let i = s.childOffsets[g]; i < s.childOffsets[g + 1]; i++) touch(r, s.children[i])
    for (let i = s.outputOffsets[g]; i < s.outputOffsets[g + 1]; i++) {
      const output = s.outputs[i],
        owner = s.owners[output]
      if (owner >= 0) reach(r, owner)
      else touch(r, output)
    }
  }
  /** A page enters through its own group, or alone when nothing replaces it, at its primitive's
   *  holder. */
  const enterAs = (id: number, rec: PageRec) => {
    const placed = id >= 0 && id < placement.rootOfPacked.length ? placement.rootOfPacked[id] : -1
    if (placed < 0 || !roots[placed]) return touchId(id, rec)
    const r = holderOf(placed),
      page = id - baseOf(placed),
      owner = roots[r].structure?.owners[page] ?? -1
    if (owner >= 0) reach(r, owner)
    else touchId(baseOf(r) + page, rec)
  }
  const enter = (id: number) => {
    const rec = recordOf(id)
    if (rec) enterAs(id, rec)
  }
  const endWalk = () => {
    visitor = undefined
    walked.clear()
  }
  return {
    delta: delta as IdDelta,
    /** Bytes of the tables above, sized by what the cut closes over: the CPU budget holds them on
     *  WebGPU (`../../residency/memoryBudget.ts`). */
    get hostBytes() {
      return (
        heldGroups.byteLength +
        heldPages.byteLength +
        seen.byteLength +
        walked.byteLength +
        delta.entered.byteLength +
        delta.exited.byteLength
      )
    },
    /** Visits every page `ids` close over, themselves included, each group once per call:
     *  what a list rebuilt whole asks for (`../../webgpu/residency/lowerTier.ts`). `full` ends the
     *  walk early, before the next id, once the visitor takes nothing more. */
    closeOver(
      ids: ArrayLike<number>,
      visit: (id: number, rec: PageRec) => void,
      full?: () => boolean,
    ) {
      visitor = visit
      for (let i = 0; i < ids.length && !full?.(); i++) enter(ids[i])
      endWalk()
    },
    /** Visits every page the cut closes over now, beside its record, in no particular order. */
    forEachHeld(visit: (id: number, rec: PageRec) => void) {
      heldPages.forEach((id) => visit(id, recordOf(id)!))
    },
    /** Turns the cut's difference into the difference of the pages it closes over. */
    apply(cut: IdDelta) {
      // Entries first: a group one page leaves and another joins is never let go in between.
      step = 1
      for (let i = 0; i < cut.enteredCount; i++) enter(cut.entered[i])
      step = -1
      for (let i = 0; i < cut.exitedCount; i++) enter(cut.exited[i])
      if (delta.entered.length < touched.length)
        delta.entered = grown(delta.entered, touched.length)
      if (delta.exited.length < touched.length) delta.exited = grown(delta.exited, touched.length)
      delta.enteredCount = delta.exitedCount = 0
      for (const id of touched) {
        const now = heldPages.get(id) > 0,
          before = seen.get(id) === 2
        if (now && !before) delta.entered[delta.enteredCount++] = id
        else if (!now && before) delta.exited[delta.exitedCount++] = id
      }
      seen.clear()
      touched.length = 0
    },
  }
}
