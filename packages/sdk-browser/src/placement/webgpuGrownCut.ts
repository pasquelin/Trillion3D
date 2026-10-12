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
import type { ClusterRoot, PageRec } from '../page/selection/types.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { forgetRowRoots } from './update.ts'
import { updateWebgpuPlacements } from './webgpuPlacements.ts'
import { adoptCut } from '../webgpu/pages/prepare/cut.ts'
import { followWorldRoot } from '../webgpu/pages/prepare/worldRoot.ts'
import { growthOf, heldPage, takeGrownCopies } from './webgpuGrowth.ts'
import { growBlend, waitsForFrontDepth, waitsForWater } from '../webgpu/blend/growth.ts'
import { announceGrowth, replayMoves, type GrownRoots } from './growthAnnounce.ts'
import { joinDeformation, placeDeformation } from '../deformation/growth.ts'

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
  // A transmissive copy joins over the water pass's targets and classes, asked of the frame.
  if (waitsForWater(rt, growth.copies)) return false
  // A blend joins over the front depth the targets and the Hi-Z were remade to hold.
  if (waitsForFrontDepth(rt, growth.copies)) return false
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
  for (const root of added)
    if (!root.pages[0]?.transparent) layout.opaquePageCount += root.pages.length
  rows.addPages(first)
  // Their records join the deformation's, before the blended items name them; the pool lays its
  // tail out for them, and for the whole copies the items bring, once these exist.
  const copies = takeGrownCopies(rt)
  joinDeformation(rt, added, copies, firstRank)
  // The blended copies join the pass with the ranks their pages hold now, before the first sync of
  // the rows names them.
  joinBlend(rt, copies, added, first)
  placeDeformation(rt)
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
  if (!ready.inPlace) swapCut(rt, ready, added, firstRank)
  // A world DAG among them is the session's: the cells it draws far are followed.
  if (added.some((root) => 'origins' in root)) followWorldRoot(rt)
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

/** The blended `copies` join the transparent pass; one the device refuses is said once. */
function joinBlend(
  rt: WebgpuPagesRuntime,
  copies: ReturnType<typeof takeGrownCopies>,
  roots: readonly ClusterRoot<PageRec>[],
  base: number,
) {
  if (!copies.length) return
  try {
    growBlend(rt, rt.gpu.device!, copies, roots, base)
  } catch (error) {
    rt.diag.diagnosticFailure('blend-growth-failed', error)
  }
}

/** `cut` replaces the running cut (`adoptCut`): it holds every root's park and mark word and the
 *  pool's residency; the views drawn aside cut on it anew. The pool was listed when the cut began:
 *  the pages it `moved` since are noted again, they alone. The roots `added` behind rank `first`
 *  are those it packed beyond the running cut's. */
function swapCut(
  rt: WebgpuPagesRuntime,
  { cut, moved }: { cut: GpuSelection; moved: ReadonlySet<number> },
  added: GrownRoots,
  first: number,
) {
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
  // The poses named since the cut was packed — it holds them as they were then —: replayed.
  replayMoves(rt, cut, added, first)
  cut.updateResidency(layout.rows.residency, layout.rows.residentPages())
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
