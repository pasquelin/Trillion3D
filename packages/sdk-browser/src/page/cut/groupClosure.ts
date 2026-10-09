import type { PageRec } from '../selection/selection.ts'
import { createPageCatalogue, type PageList } from '../selection/catalogue.ts'
import type { ClusterRoot } from '../selection/types.ts'
import type { PlacementIndex } from '../selection/placements.ts'
import type { IdDelta } from '../../webgpu/cut/delta.ts'
import { createSparseInts } from './sparseInts.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'

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

/** A visitor a `closeOver` walk hands each page to. */
type Visitor = (id: number, rec: PageRec) => void

/**
 * The closure's state: holders per group and per page, the pages whose count moved in this
 * difference with whether each was held before it (`seen`: 1 no, 2 yes), the groups one
 * `closeOver` walk reached, and what a walk does — counts `step` on what it reaches, or hands each
 * page to `visitor`, naming each placement's own pages under `perInstance` rather than its
 * primitive's holder's. `holder` is the placement a shared page list is held at: the first that
 * asked, while it still places it.
 */
function createWalk(
  roots: readonly ClusterRoot<PageRec>[],
  placement: PlacementIndex,
  packedPages: PageList,
) {
  const heldPages = createSparseInts()
  return {
    roots,
    placement,
    recordOf: createPageCatalogue(packedPages).recordOf,
    heldGroups: createSparseInts(),
    heldPages,
    seen: createSparseInts(),
    walked: createSparseInts(),
    touched: [] as number[],
    delta: {
      entered: new Int32Array(8),
      exited: new Int32Array(8),
      enteredCount: 0,
      exitedCount: 0,
      has: (id: number) => heldPages.get(id) > 0,
    },
    step: 0,
    visitor: undefined as Visitor | undefined,
    perInstance: false,
    holder: new Map<readonly unknown[], number>(),
  }
}

type Walk = ReturnType<typeof createWalk>

const baseOf = (w: Walk, r: number) => w.placement.baseOfRoot[r] ?? 0

/** The placement root `r`'s pages are held at: the first that asked, while it still places them. */
function holderOf(w: Walk, r: number) {
  const pages = w.roots[r].pages,
    known = w.holder.get(pages)
  if (known !== undefined && w.roots[known]?.pages === pages) return known
  w.holder.set(pages, r)
  return r
}

function touchId(w: Walk, id: number, rec: PageRec) {
  if (w.visitor) return w.visitor(id, rec)
  if (!w.seen.get(id)) {
    w.seen.set(id, w.heldPages.get(id) > 0 ? 2 : 1)
    w.touched.push(id)
  }
  w.heldPages.add(id, w.step)
}

const touch = (w: Walk, r: number, page: number) =>
  touchId(w, baseOf(w, r) + page, w.roots[r].pages[page])

/** Group `g` of placement `r` and what it holds: its members, and each output's own group — the
 *  output itself when nothing replaces it. A counted group is walked when it is first held or
 *  last released; a visited one once per walk. */
function reach(w: Walk, r: number, g: number) {
  const s = w.roots[r].structure!,
    key = baseOf(w, r) + s.children[s.childOffsets[g]]
  if (w.visitor) {
    if (w.walked.set(key, 1)) return
  } else {
    const count = w.heldGroups.add(key, w.step)
    if (count - w.step > 0 === count > 0) return
  }
  for (let i = s.childOffsets[g]; i < s.childOffsets[g + 1]; i++) touch(w, r, s.children[i])
  for (let i = s.outputOffsets[g]; i < s.outputOffsets[g + 1]; i++) {
    const output = s.outputs[i],
      owner = s.owners[output]
    if (owner >= 0) reach(w, r, owner)
    else touch(w, r, output)
  }
}

/** A page enters through its own group, or alone when nothing replaces it, at its primitive's
 *  holder. */
function enter(w: Walk, id: number) {
  const rec = w.recordOf(id)
  if (!rec) return
  const { rootOfPacked } = w.placement
  const placed = id >= 0 && id < rootOfPacked.length ? rootOfPacked[id] : -1
  if (placed < 0 || !w.roots[placed]) return touchId(w, id, rec)
  const r = w.perInstance ? placed : holderOf(w, placed),
    page = id - baseOf(w, placed),
    owner = w.roots[r].structure?.owners[page] ?? -1
  if (owner >= 0) reach(w, r, owner)
  else touchId(w, baseOf(w, r) + page, rec)
}

/** Counts `step` on the `count` first pages of `ids` and on what they close over. */
function enterAll(w: Walk, ids: ArrayLike<number>, count: number, step: number) {
  w.step = step
  for (let i = 0; i < count; i++) enter(w, ids[i])
}

/** The difference of the pages held: each page touched that is held now and was not, or was and
 *  is not; the touched pages then forgotten. */
function settleDelta(w: Walk) {
  const { delta, touched, heldPages, seen } = w
  if (delta.entered.length < touched.length) delta.entered = resized(delta.entered, touched.length)
  if (delta.exited.length < touched.length) delta.exited = resized(delta.exited, touched.length)
  delta.enteredCount = delta.exitedCount = 0
  for (const id of touched) {
    const now = heldPages.get(id) > 0,
      before = seen.get(id) === 2
    if (now && !before) delta.entered[delta.enteredCount++] = id
    else if (!now && before) delta.exited[delta.exitedCount++] = id
  }
  seen.clear()
  touched.length = 0
}

/**
 * Every table is sparse (`./sparseInts.ts`): it holds the groups and pages the cut closes over,
 * never the placements' catalogue (#483 rule 6). A placement's pages are packed contiguously from
 * its root's packed base (`postPackedBases`, #1235), and a group is keyed by its first member's
 * packed id, which no other group shares.
 */
export function createGroupClosure(
  roots: readonly ClusterRoot<PageRec>[],
  /** The per-placement tables: the packed base of each root, the root of each packed rank (#1235). */
  placement: PlacementIndex,
  /** The packed catalogue ids resolve in. */
  packedPages: PageList = [],
  /** The counted closure names each placement's own packed ranks, as the row cache holds them
   *  (`../../webgpu/row/rowDemand.ts`), rather than its primitive's holder's. */
  instances = false,
) {
  const w = createWalk(roots, placement, packedPages)
  return {
    delta: w.delta as IdDelta,
    /** Bytes of the tables above, sized by what the cut closes over: the CPU budget holds them on
     *  WebGPU (`../../residency/memoryBudget.ts`). */
    get hostBytes() {
      return (
        w.heldGroups.byteLength +
        w.heldPages.byteLength +
        w.seen.byteLength +
        w.walked.byteLength +
        w.delta.entered.byteLength +
        w.delta.exited.byteLength
      )
    },
    /** Visits every page `ids` close over, themselves included, each group once per call:
     *  what a list rebuilt whole asks for (`../../webgpu/residency/lowerTier.ts`). `full` ends the
     *  walk early, before the next id, once the visitor takes nothing more. `instances` names each
     *  placement's own packed ranks, as the row cache holds them (`../../webgpu/row/rowDemand.ts`),
     *  rather than the ranks of the placement its primitive's records are held at. */
    closeOver(ids: ArrayLike<number>, visit: Visitor, full?: () => boolean, instances = false) {
      w.visitor = visit
      w.perInstance = instances
      for (let i = 0; i < ids.length && !full?.(); i++) enter(w, ids[i])
      w.visitor = undefined
      w.perInstance = false
      w.walked.clear()
    },
    /** Turns the cut's difference into the difference of the pages it closes over. */
    apply(cut: IdDelta) {
      // Entries first: a group one page leaves and another joins is never let go in between.
      w.perInstance = instances
      enterAll(w, cut.entered, cut.enteredCount, 1)
      enterAll(w, cut.exited, cut.exitedCount, -1)
      w.perInstance = false
      settleDelta(w)
    },
  }
}
