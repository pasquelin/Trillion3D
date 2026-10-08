/**
 * A GROWTH IN PLACE JOINS, between two images (`webgpuGrowth.ts`): the waiting roots join every list
 * the session reads by rank — the cut's roots, the packed catalogue, the per-page row arrays, the
 * placement worlds, the temporal pass's previous poses, the shadow mobility, the root boxes —, the
 * cut made over them replaces the running one — or the running one took them in place —, and the
 * new rows follow their owner's writes.
 */
import { countRootCopies } from '../webgpu/pages/prepare/layout.ts'
import { growWebgpuTables, tableRowsFor } from '../webgpu/pages/prepare/growTables.ts'
import { postPackedBases } from '../page/selection/placements.ts'
import { reserveRootBoxes } from '../page/selection/batchBoxes.ts'
import { mainViewGpu, viewGpu } from '../webgpu/pages/state/view.ts'
import { markReach } from '../deformation/halfFloat.ts'
import type { GpuSelection } from '../gpu/core/selection.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { forgetRowRoots } from './update.ts'
import { updateWebgpuPlacements } from './webgpuPlacements.ts'
import { adoptCut } from '../webgpu/pages/prepare/cut.ts'
import { growthOf, heldPage } from './webgpuGrowth.ts'
import { announceGrowth } from './growthAnnounce.ts'

/**
 * At frame entry, a cut made over every root replaces the running one (step 3): the waiting roots
 * join every list read by rank, the new cut takes the pool's residency, and the new rows follow
 * their owner's writes. False when no growth is ready.
 */
export function adoptGrownCut(rt: WebgpuPagesRuntime) {
  const growth = growthOf(rt),
    ready = growth?.ready
  const { layout, setup, run } = rt,
    { selectionRoots, packedPages, rows } = layout
  if (!growth || !ready || selectionRoots.length + growth.roots.length !== ready.roots) return false
  growth.ready = undefined
  // The cut that took them in place is no longer the session's: they are asked again.
  if (ready.inPlace && ready.cut !== run.gpuSelection) {
    growth.appended = 0
    growth.asked = true
    return false
  }
  growth.appended = 0
  const added = growth.roots.splice(0),
    first = packedPages.length,
    firstRank = selectionRoots.length
  for (const root of added) {
    selectionRoots.push(root)
    setup.roots.push(root)
  }
  forgetRowRoots(selectionRoots)
  // The new rows read their primitive's own shared records (#1235); the placement tables are
  // rewritten in place, and the pool's copies count each primitive page once by its placements.
  countRootCopies(layout.copies, added)
  postPackedBases(selectionRoots, layout.placement) // in place: readers hold this object
  layout.opaquePageCount += packedPages.length - first
  rows.addPages(first)
  // The worlds the cut takes, laid out for every placement its tables hold: a growth into its room
  // keeps them, one past it lays them out once more.
  const slots = Math.max(1, selectionRoots.length, ready.cut.worldCapacity) * 16
  if (layout.worldUpdates.length !== slots) {
    const worlds = new Float32Array(slots)
    worlds.set(layout.worldUpdates.subarray(0, Math.min(slots, layout.worldUpdates.length)))
    layout.worldUpdates = worlds
  }
  rt.lights.mobility.ensure(
    selectionRoots.length,
    rows.casterSlots,
    (rank) => selectionRoots[rank].world.elements,
  )
  mainViewGpu(rt).temporal?.motion.grow()
  for (const view of rt.views.persistent) viewGpu(rt, view).temporal?.motion.grow()
  reserveBoxes(rt)
  // Taken in place, the running cut already holds them; else the cut made over them replaces it.
  if (!ready.inPlace) swapCut(rt, ready.cut, ready.moved)
  // The new rows as their owner wrote them meanwhile: parked or taken, posed, casting or not.
  for (const root of added)
    if (root.placement)
      updateWebgpuPlacements(rt, root.placement.rows, root.placement.index, root.placement.index)
  // More rows than the table holds: it grows after them, the image going on meanwhile.
  const asked = tableRowsFor(rt, setup.cap)
  if (asked.drawSlots > layout.drawSlots || asked.blendSlots > rows.casterSlots - rows.blendFirst)
    growWebgpuTables(rt, setup.cap).catch((error) =>
      rt.diag.diagnosticFailure('page-tables-growth-failed', error),
    )
  announceGrowth(rt, added, firstRank)
  return true
}

/** `cut` replaces the running cut (`adoptCut`): it holds every root's park and mark word and the
 *  pool's residency; the views drawn aside cut on it anew. The pool was listed when the cut began: the pages it `moved` since are noted again,
 *  they alone. */
function swapCut(rt: WebgpuPagesRuntime, cut: GpuSelection, moved: ReadonlySet<number>) {
  const { run, layout } = rt
  adoptCut(rt, cut)
  // Every view's cut aside was on the old tables: each makes its own anew at its next image.
  for (const view of [rt.views.main, ...rt.views.persistent]) {
    const held = view === rt.views.active ? run : view.run
    held.asideCut?.dispose()
    held.asideCut = undefined
  }
  layout.selectionRoots.forEach((root, rank) => {
    cut.parkWorld(rank, !!root.parked)
    cut.markWorld(rank, markReach(root.mark ?? 0, root.reach ?? 0))
  })
  cut.updateResidency(layout.rows.residentFlags)
  // The pool's slots taken or given back while the cut was made: a page whose held state moved.
  for (const page of moved)
    if (page < layout.packedPages.length) cut.notePool(page, heldPage(rt, page))
}

/** The root boxes' batch for the longer list: the one held no longer plays (`transformRootBoxes`),
 *  and the moved boxes are reprojected one by one, to the same bits, until the new one is ready. */
function reserveBoxes(rt: WebgpuPagesRuntime) {
  const { layout, signal } = rt
  layout.rootBoxes?.release()
  layout.rootBoxes = null
  const roots = layout.selectionRoots.length
  void reserveRootBoxes(layout.selectionRoots).then(
    (lot) => {
      if (signal.aborted || layout.rootBoxes || layout.selectionRoots.length !== roots)
        lot?.release()
      else layout.rootBoxes = lot
    },
    () => {},
  )
}
