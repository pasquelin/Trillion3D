/**
 * THE WEBGPU PATH GROWS AN INSTANCE BUFFER IN PLACE (`growth.ts`), its GPU cut with it (#1483).
 *
 * The roots of the old buffer read the new one at once. The new rows' parked roots wait beside the
 * session while a GPU cut over every root is packed and made — the DAG's tables are laid out at
 * their size —, the running cut drawing meanwhile what it drew: the new rows are parked, nothing of
 * them is lost. Between two images (`webgpuGrownCut.ts`) the roots join every list the session
 * reads by rank, the new cut replaces the old one with the pool's residency and held pages, and the
 * new rows follow as any written row. Only the cut's tables are made again: no page is uploaded,
 * no texture tile moved; the pool, the row cache, the textures and the lights are the session's. A
 * growth while one is made restarts it on every root; the row cache is sized by the view, never by
 * the placements (#1232).
 *
 * One cut is made per image however many growths it brought (`startGrownCut`, at frame entry),
 * and the pool's slots that move while it is made are logged and replayed alone at the swap. That
 * cut is packed at a grown capacity (`grownCapacity`, twice what the session held at least): the
 * growths after it append their roots into the room it kept, in place, O(added), no cut made
 * (`GpuSelection.appendRoots`); only one past that room packs again — a logarithmic number of
 * times.
 *
 * Refused, so the owner opens the session again: rows the blend pass or a deformation draws, whose
 * tables are laid out at open (`rowsGrowInPlace`), and a session without a GPU cut or a device.
 */
import { createSessionCut } from '../webgpu/pages/prepare/cut.ts'
import { loseGpuSelection } from '../webgpu/pages/io/drops.ts'
import type { GpuSelection } from '../gpu/core/selection.ts'
import type { ClusterRoot, PageRec } from '../page/selection/types.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { forgetRowRoots } from './update.ts'
import { updateWebgpuPlacements } from './webgpuPlacements.ts'
import { growRowRoots } from './growth.ts'
import { grownCapacity, placedBy, type PlacementRows } from './rows.ts'
import { dagRootCounts } from '../gpu/dag/pack.ts'

type Root = ClusterRoot<PageRec>

/** The rows the session follows and grows in place (`EngineSceneUpdates`). */
export const webgpuPlacementApi = (rt: WebgpuPagesRuntime) => ({
  updatePlacements: (rows: PlacementRows, from: number, to: number) =>
    void updateWebgpuPlacements(rt, rows, from, to),
  growsInPlace: (from: readonly PlacementRows[]) => webgpuGrowsInPlace(rt, from),
  growPlacements: (from: PlacementRows, to: PlacementRows) => growWebgpuPlacements(rt, from, to),
})
/** The roots waiting to join, how many of them the running cut took in place, whether a cut over
 *  them is asked, the cut being made, the pages the pool moved since it began, and the one ready —
 *  made, or the running one that took them (`inPlace`) —, until adopted. */
type Growth = {
  roots: Root[]
  appended: number
  made: number
  asked: boolean
  making?: Promise<void>
  moved?: Set<number>
  ready?: { cut: GpuSelection; roots: number; moved: Set<number>; inPlace?: true }
}
const growths = new WeakMap<WebgpuPagesRuntime, Growth>()
/** The growth of `rt` in flight, if one is. */
export const growthOf = (rt: WebgpuPagesRuntime) => growths.get(rt)

/** Whether rows drawn by `template` grow in place: neither the blend pass's — transparent pages,
 *  whose tables are laid out at open — nor a deformation's. */
const rowsGrowInPlace = (template: Root | undefined) =>
  !template?.pages.some((page) => page.transparent || page.deformationOutput)

/** Whether the session grows each of `from` in place, asked before any is (`growth.ts`). */
function webgpuGrowsInPlace(rt: WebgpuPagesRuntime, from: readonly PlacementRows[]) {
  const { layout, run, gpu, setup, blendState } = rt
  if (!gpu.device || run.lost || !run.gpuSelection) return false
  for (const buffer of from) {
    if (placedBy(setup.blendCopies, buffer) || placedBy(blendState.blendGpu, buffer)) return false
    if (!rowsGrowInPlace(layout.selectionRoots.find((root) => root.placement?.rows === buffer)))
      return false
  }
  return true
}

/** Steps 1 and 2 of the contract on a growth `webgpuGrowsInPlace` took: every root of `from` reads
 *  `to`, and one parked root per new row waits for the cut made over all of them, asked of the next
 *  frame entry (`startGrownCut`): a burst of growths packs the DAG once. */
function growWebgpuPlacements(rt: WebgpuPagesRuntime, from: PlacementRows, to: PlacementRows) {
  const growth = growths.get(rt) ?? { roots: [], appended: 0, made: 0, asked: false }
  growths.set(rt, growth)
  const { selectionRoots } = rt.layout
  for (const { item } of growRowRoots([...selectionRoots, ...growth.roots], from, to))
    growth.roots.push(item)
  // The session's roots read `to` now: their row views are taken again.
  forgetRowRoots(selectionRoots)
  if (growth.roots.length) growth.asked = true
}

/** At frame entry: the roots the growths since the last image brought, appended in place into the
 *  running cut's room, or a cut over every root made beside it at a grown capacity. */
export function startGrownCut(rt: WebgpuPagesRuntime) {
  const growth = growths.get(rt)
  if (!growth?.asked) return
  const cut = rt.run.gpuSelection
  // A list growing between two frames takes no root: asked again at the next frame entry, rather
  // than a whole cut packed for a growth that ends within a frame or two.
  if (cut?.growing) return
  growth.asked = false
  if (cut?.appendRoots(growth.roots.slice(growth.appended))) {
    // A cut made beside it is for fewer roots: dropped when it lands, or now if it landed unadopted.
    growth.made++
    growth.appended = growth.roots.length
    if (growth.ready && !growth.ready.inPlace) growth.ready.cut.dispose()
    const roots = rt.layout.selectionRoots.length + growth.roots.length
    growth.ready = { cut, roots, moved: new Set(), inPlace: true }
    return
  }
  growth.making = makeCut(rt, growth)
}

/** The capacity a cut over `roots` is packed at: twice the pages and placements the session held
 *  at least (`grownCapacity`), nodes in the pages' proportion. */
function grownCutCapacity(rt: WebgpuPagesRuntime, roots: readonly Root[]) {
  const needed = dagRootCounts(roots),
    pages = grownCapacity(rt.layout.packedPages.length, needed.pages)
  return {
    pages,
    nodes: Math.ceil((needed.nodes * pages) / Math.max(1, needed.pages)),
    worlds: grownCapacity(rt.layout.selectionRoots.length, needed.worlds),
  }
}

/** The GPU cut over the session's roots and those waiting, made beside the running one; a later
 *  growth makes another, and this one is dropped. The pool's slots that move meanwhile are logged
 *  (`logTouched`) and replayed alone at the swap (`webgpuGrownCut.ts`). */
async function makeCut(rt: WebgpuPagesRuntime, growth: Growth): Promise<void> {
  const made = ++growth.made,
    roots = [...rt.layout.selectionRoots, ...growth.roots],
    { rows } = rt.layout,
    moved = new Set<number>()
  growth.moved = moved
  rows.logTouched(moved)
  // The pool as it stands, in one write; what moves meanwhile follows at adoption (`swapCut`).
  const held = (page: number) => heldPage(rt, page)
  const capacity = grownCutCapacity(rt, roots)
  const { cut, refused, error } = await createSessionCut(rt, rt.gpu.device!, roots, held, capacity)
    .then((result) => ({ ...result, error: undefined as unknown }))
    .catch((failure: unknown) => ({ cut: undefined, refused: 'creation failed', error: failure }))
  if (made !== growth.made || rt.signal.aborted || rt.run.lost) return cut?.dispose()
  rows.logTouched(undefined)
  // The scene's roots no longer fit a cut this device holds: as an open would be, it is refused.
  if (!cut) return loseGpuSelection(rt, `grown cut refused: ${refused}`, error)
  // The running cut that took roots in place stays the session's until this one replaces it.
  if (!growth.ready?.inPlace) growth.ready?.cut.dispose()
  growth.ready = { cut, roots: roots.length, moved }
}

/** Whether packed page `page` — of the roots the session holds — has its bytes in the pool. */
export const heldPage = (rt: WebgpuPagesRuntime, page: number) =>
  page < rt.layout.rows.residentOffsetWords.length && rt.layout.rows.residentOffsetWords[page] >= 0
