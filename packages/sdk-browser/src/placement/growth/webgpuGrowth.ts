/**
 * THE WEBGPU PATH GROWS AN INSTANCE BUFFER IN PLACE (`growth.ts`), its GPU cut with it (#1483).
 *
 * The roots of the old buffer read the new one at once. The new rows' parked roots wait beside the
 * session while a GPU cut over every root is packed and made — the DAG's tables are laid out at
 * their size —, the running cut drawing meanwhile what it drew: the new rows are parked, nothing of
 * them is lost. Between two images (`../webgpuGrownCut.ts`) the roots join every list the session
 * reads by rank, the new cut replaces the old one with the pool's residency, and the new rows
 * follow as any written row. Only the cut's tables are made again: no page is uploaded,
 * no texture tile moved; the pool, the row cache, the textures and the lights are the session's. One
 * cut is made at a time: a growth while one is made waits for it to land, then one is made over
 * every root, the landed one released unadopted first — the device never holds the tables of
 * more than the running cut and the one made —; the row cache is sized by the view, never by
 * the placements (#1232).
 *
 * One cut is made per image however many growths it brought (`startGrownCut`, at frame entry),
 * and takes the pool's residency as it stands at the swap. That cut is packed at a grown capacity (`grownLength`, twice what the session held at least): the
 * growths after it append their roots into the room it kept, in place, O(added), no cut made
 * (`GpuSelection.appendRoots`); only one past that room packs again — a logarithmic number of
 * times.
 *
 * Rows the blend pass draws grow as the others: their copies and items read the larger buffer and
 * a copy joins per new row, the items and the table's entries made by the function that made the
 * held ones (`growBlend`). Refused, and said by name by the owner: a session without a GPU cut or
 * a device.
 */
import type { GpuSelection } from '../../gpu/core/selection.ts'
import type { ClusterRoot, PageRec } from '../../geometry/selection/types.ts'
import type { BlendCopy } from '../../geometry/cluster/blendCopyContract.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { forgetRowRoots } from '../update.ts'
import { growing } from './growthOf.ts'
import { rebindComposedWorlds } from '../compose/gpuCompose.ts'
import { rebindReaders } from '../compose/composeReaders.ts'
import { updateWebgpuPlacements } from '../webgpuPlacements.ts'
import { growRowItems, growRowRoots, rekeyRebound, type Rebound } from './growth.ts'
import { pagedBlendCopiesOf } from '../../frame/prepare/setupCatalogue.ts'
import { rebindDeformedWorlds } from '../../deformation/growth.ts'
import { type PlacementRows } from '../rows/rows.ts'

/** The rows the session follows and grows in place (`EngineSceneUpdates`). */
export const webgpuPlacementApi = (rt: WebgpuPagesRuntime) => ({
  updatePlacements: (rows: PlacementRows, from: number, to: number) =>
    void updateWebgpuPlacements(rt, rows, from, to),
  growsInPlace: () => webgpuGrowsInPlace(rt),
  growPlacements: (from: PlacementRows, to: PlacementRows) => growWebgpuPlacements(rt, from, to),
})
/** The roots waiting to join, how many of them the running cut took in place, whether a cut over
 *  them is asked, the cut being made, and the one ready — made, or the running one that took them
 *  (`inPlace`) —, until adopted. */
export type GrowthInFlight = {
  roots: ClusterRoot<PageRec>[]
  /** The blended and transmissive copies of the sources added, which join the pass once their
   *  roots hold their ranks (`growBlend`). */
  copies: BlendCopy[]
  appended: number
  asked: boolean
  /** The running cut could not take a group above an instance's root — no node in its table, or
   *  leaves with no ball (`takesParents`): the cut asked is made over the roots it holds, at a
   *  grown capacity, though no root joins (`askNodeRoom`). */
  starved?: true
  making?: Promise<void>
  ready?: { cut: GpuSelection; roots: number; inPlace?: true }
}
/** Whether the session grows the rows in place, asked before any is (`growth.ts`). */
function webgpuGrowsInPlace(rt: WebgpuPagesRuntime) {
  const { run, gpu } = rt
  return !!gpu.device && !run.lost && !!run.gpuSelection
}

/** Steps 1 and 2 of the contract on a growth `webgpuGrowsInPlace` took: every root of `from` reads
 *  `to`, and one parked root per new row waits for the cut made over all of them, asked of the next
 *  frame entry (`startGrownCut`): a burst of growths packs the DAG once. */
function growWebgpuPlacements(rt: WebgpuPagesRuntime, from: PlacementRows, to: PlacementRows) {
  const growth = growing(rt)
  const { selectionRoots } = rt.layout,
    { blendState, setup } = rt
  const rebound: Rebound = new Map(),
    rooted = growth.roots.length
  for (const root of growRowRoots([...selectionRoots, ...growth.roots], from, to, rebound))
    growth.roots.push(root)
  // The session's roots read `to` now: their row views are taken again.
  forgetRowRoots(selectionRoots)
  if (rt.compose) rebindReaders(rt.compose.readers, from, to)
  // The blended copies and the items of `from` read `to` too; a copy per new row joins the pass
  // with the root of its row, the tables keyed by a view following it.
  growRowItems(setup.blendCopies, from, to, rebound)
  growRowItems(blendState.blendGpu, from, to, rebound)
  rebindComposedWorlds(rt)
  const copies = pagedBlendCopiesOf(growth.roots.slice(rooted), setup.pagedBlendCopies)
  // The paged copies held by the view of their root's row stand on the row's new view.
  rekeyRebound(setup.pagedBlendCopies, rebound)
  rebindDeformedWorlds(rt, rebound)
  setup.blendCopies.push(...copies)
  growth.copies.push(...copies)
  if (growth.roots.length || copies.length) growth.asked = true
}

/** Roots of a source added to the session in place wait beside those a growth brought, to be
 *  taken into the cut with them, and its blended `copies` with them to join the transparent pass
 *  (`addWebgpuPlacements`). */
export function joinGrownRoots(
  rt: WebgpuPagesRuntime,
  roots: readonly ClusterRoot<PageRec>[],
  copies: readonly BlendCopy[],
) {
  const growth = growing(rt)
  growth.roots.push(...roots)
  growth.copies.push(...copies)
  if (growth.roots.length || growth.copies.length) growth.asked = true
}

/** The blended copies waiting to join the pass, taken. */
export const takeGrownCopies = (rt: WebgpuPagesRuntime) => rt.growth?.copies.splice(0) ?? []
