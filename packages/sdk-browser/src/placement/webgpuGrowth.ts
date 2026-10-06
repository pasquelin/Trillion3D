/**
 * THE WEBGPU PATH GROWS AN INSTANCE BUFFER IN PLACE (`growth.ts`), within the page table it opened
 * with. The new rows' roots and pages are appended to every list the session reads by rank — the
 * cut's roots, the packed catalogue, the per-page residency arrays, the placement worlds, the
 * temporal pass's previous poses, the shadow mobility, the root boxes —, each page with the pool
 * slot its address already holds: no slot is uploaded, no texture tile moved, no residency lost.
 *
 * A growth whose pages ask more rows than the page table holds grows the table in place after them
 * (`growTables.ts`): until it is granted, a page that finds no row is drawn by its nearest resident
 * ancestor, as on a table the device bounds. The GPU cut, the transparent table and the forward
 * copies lay their own tables out at open: a growth they read is refused, and the owner
 * opens the session again.
 */
import { countRootCopies } from '../webgpu/pages/prepare/layout.ts'
import { growWebgpuTables, tableRowsFor } from '../webgpu/pages/prepare/growTables.ts'
import { postPackedBases } from '../page/selection/placements.ts'
import { reserveRootBoxes } from '../math/batchBoxes.ts'
import { mainViewGpu, viewGpu } from '../webgpu/pages/state/view.ts'
import { forgetRootsByMesh } from '../webgpu/pages/render/movedNode.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { growRowRoots } from './growth.ts'
import { placedBy, type PlacementRows } from './rows.ts'

/** Whether the session grows each of `from` in place, asked before any is: whatever the rows, as
 *  its tables grow after them. */
export function webgpuGrowsInPlace(rt: WebgpuPagesRuntime, from: readonly PlacementRows[]) {
  const { layout, run, gpu, setup, blendState } = rt
  if (!gpu.device || run.lost || run.gpuSelection) return false
  for (const buffer of from) {
    if (placedBy(setup.blendCopies, buffer) || placedBy(blendState.blendGpu, buffer)) return false
    const template = layout.selectionRoots.find((root) => root.placement?.rows === buffer)
    if (template?.pages[0]?.transparent || template?.pages.some((page) => page.deformationOutput))
      return false
  }
  return true
}

/**
 * Steps 1 to 3 of the contract (`growth.ts`) on a growth `webgpuGrowsInPlace` took: the roots of
 * `from` read `to`, and each new row's parked root joins the lists at the next rank, its pages at
 * the end of the catalogue.
 */
export function growWebgpuPlacements(
  rt: WebgpuPagesRuntime,
  from: PlacementRows,
  to: PlacementRows,
) {
  const { layout, setup, services, run } = rt,
    { selectionRoots, packedPages, rows } = layout
  const first = packedPages.length,
    grown = selectionRoots.length
  for (const { item: root } of growRowRoots(selectionRoots, from, to)) {
    selectionRoots.push(root)
    setup.roots.push(root)
  }
  // The new rows read their primitive's own shared records: nothing is stored per page,
  // the placement tables rewritten in place say which root each new packed rank belongs to, and
  // the pool's copies count each primitive page once by its new placements.
  const added = selectionRoots.slice(grown)
  if (!added.some((root) => root.pages.length)) return
  countRootCopies(layout.copies, added)
  postPackedBases(selectionRoots, layout.placement) // in place: readers hold this object
  layout.opaquePageCount += packedPages.length - first
  rows.addPages(first)
  const worlds = new Float32Array(selectionRoots.length * 16)
  worlds.set(layout.worldUpdates)
  layout.worldUpdates = worlds
  rt.lights.mobility.ensure(
    selectionRoots.length,
    rows.casterSlots,
    (rank) => selectionRoots[rank].world.elements,
  )
  mainViewGpu(rt).temporal?.motion.grow()
  for (const view of rt.views.persistent) viewGpu(rt, view).temporal?.motion.grow()
  services.heldResidency.track(selectionRoots)
  forgetRootsByMesh(selectionRoots)
  reserveBoxes(rt)
  // More rows than the table holds: it grows after them, the image going on meanwhile.
  const asked = tableRowsFor(rt, setup.cap)
  if (asked.drawSlots > layout.drawSlots || asked.blendSlots > rows.casterSlots - rows.blendFirst)
    growWebgpuTables(rt, setup.cap).catch((error) =>
      rt.diag.diagnosticFailure('page-tables-growth-failed', error),
    )
  // New sources to watch, and every world walked again at the next image.
  run.gate.sceneChanged()
}

/** The root boxes' batch for the longer list: the one held does not play (`transformRootBoxes`),
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
