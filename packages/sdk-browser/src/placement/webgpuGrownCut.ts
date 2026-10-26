/**
 * A GROWTH IN PLACE JOINS, between two images (`growth/webgpuGrowth.ts`): the waiting roots join every list
 * the session reads by rank — the cut's roots, the packed catalogue, the per-page cluster arrays, the
 * placement worlds and records, the temporal pass's previous poses, the shadow mobility, the root
 * boxes —, the cut made over them replaces the running one — or the running one took them in
 * place —, and the new placement rows follow their owner's writes.
 */
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'
import { blendedPagesOf } from '../frame/prepare/layout.ts'
import { postPackedBases } from '../geometry/selection/placements.ts'
import { rootMark } from '../deformation/halfFloat.ts'
import type { GpuSelection } from '../gpu/core/selection.ts'
import type { ClusterRoot, PageRec } from '../geometry/selection/types.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { forgetRowRoots } from './update.ts'
import { adoptRootedReaders } from './compose/gpuCompose.ts'
import { updateWebgpuPlacements } from './webgpuPlacements.ts'
import { adoptCut } from '../frame/prepare/cut.ts'
import { coverHeldRoots, isWorldRoot } from '../frame/prepare/worldRoot.ts'
import { takeGrownCopies } from './growth/webgpuGrowth.ts'
import { growBlend, waitsForFrontDepth, waitsForRefraction } from '../blend/growth.ts'
import { announceGrowth, replayMoves, type GrownRoots } from './growth/growthAnnounce.ts'
import { joinDeformation, placeDeformation } from '../deformation/growth.ts'
import { followPlacementMobility } from '../frame/render/followMobility.ts'

/** The worlds the cut takes laid out for `placements` placements: a growth into its room keeps
 *  them, one past it lays them out once more. */
function layOutWorlds(layout: WebgpuPagesRuntime['layout'], placements: number) {
  const slots = placements * MATRIX_VALUES
  if (layout.worldUpdates.length === slots) return
  const worlds = new Float32Array(slots)
  worlds.set(layout.worldUpdates.subarray(0, Math.min(slots, layout.worldUpdates.length)))
  layout.worldUpdates = worlds
}

/**
 * At frame entry, a cut made over every root replaces the running one (step 3): the waiting roots
 * join every list read by rank, the new cut takes the pool's residency, and the new rows follow
 * their owner's writes. False when no growth is ready.
 */
export function adoptGrownCut(rt: WebgpuPagesRuntime) {
  const growth = rt.growth,
    ready = growth?.ready
  const { layout, setup, run } = rt,
    { selectionRoots, packedPages, clusters } = layout
  if (!growth || !ready || selectionRoots.length + growth.roots.length !== ready.roots) return false
  // A refracting copy joins over the distortion's targets, asked of the frame.
  if (waitsForRefraction(rt, growth.copies)) return false
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
  // The new clusters read their primitive's own shared records (#1235); the placement tables are
  // rewritten in place, and the pool's copies follow the instances (`clusters.addPages`).
  postPackedBases(selectionRoots, layout.placement) // in place: readers hold this object
  for (const root of added) layout.blendedPageCount += blendedPagesOf(root)
  clusters.addPages(first)
  // Their records join the deformation's, before the blended items name them; the pool lays its
  // tail out for them once these exist, and the placements' records are made for them.
  const copies = takeGrownCopies(rt)
  joinDeformation(rt, added, firstRank)
  // The blended copies join the pass with the ranks their pages hold now, before the first sync of
  // the rows names them.
  joinBlend(rt, copies, added, first)
  // A row a parent composed for its readers while its root waited is the roots pass's now.
  adoptRootedReaders(rt)
  placeDeformation(rt)
  clusters.placementInfo.layOut(selectionRoots.length)
  // The worlds the cut takes, laid out for every placement its tables hold: a growth into its room
  // keeps them, one past it lays them out once more.
  layOutWorlds(layout, Math.max(1, selectionRoots.length, ready.cut.worldCapacity))
  followPlacementMobility(rt)
  // Taken in place, the running cut already holds them; else the cut made over them replaces it.
  if (!ready.inPlace) swapCut(rt, ready.cut, added, firstRank)
  // A world DAG among them is the session's (`append/webgpuAppendWorld.ts`): the roots its held cells add
  // follow the cells, as at the open.
  if (added.some(isWorldRoot)) coverHeldRoots(rt, rt.services.residencySets)
  // The new rows as their owner wrote them meanwhile: parked or taken, posed, casting or not.
  for (const root of added)
    if (root.placement)
      updateWebgpuPlacements(rt, root.placement.rows, root.placement.index, root.placement.index)
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
 *  pool's residency; the views drawn aside cut on it anew. The roots `added` behind rank `first`
 *  are those it packed beyond the running cut's. */
function swapCut(rt: WebgpuPagesRuntime, cut: GpuSelection, added: GrownRoots, first: number) {
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
    cut.markWorld(rank, rootMark(root))
  })
  // The poses named since the cut was packed — it holds them as they were then —: replayed.
  replayMoves(rt, cut, added, first)
  cut.updateResidency(layout.clusters.residency, layout.clusters.residentPages())
}
