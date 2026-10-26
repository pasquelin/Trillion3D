import { PAGE_INFO_STRIDE, VIS_MAX_PAGES } from '../../visibility/types.ts'
import { createBinStages, createGpuBins } from '../../visibility/bins/bins.ts'
import { createGpuDecode } from '../../visibility/decode/decode.ts'
import { createClusterMeasure } from '../../geometry/dag/info/measure.ts'
import { constructGpuResources } from '../../gpu/core/deviceLedger.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { pageTableBuffer } from './pageTable.ts'
import { uploadPlacementTables } from './placementTables.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The decode and the stages of the bins asked, off the thread, at the frame's entry: the frame
 *  waits for them (`PreparedPipeline.ask`), and the measure of the clusters' edges with them. */
export function askVisibleStages(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis } = rt
  vis.gpuDecode ??= createGpuDecode(device)
  if (!vis.binStages || vis.binStages.layerSlots !== vis.drawLayerSlots)
    vis.binStages = createBinStages(device, vis.drawLayerSlots)
  vis.clusterMeasure ??= createClusterMeasure(device)
  vis.clusterMeasure.ask()
}

/**
 * THE TABLES SIZED BY THE CUT'S LIST OF VISIBLE CLUSTERS, brought to its room before the frame
 * reads them (`GpuSelection.visibleCap`, `../../geometry/dag/visible/visibleGrowth.ts`): the decoded
 * clusters the passes bind whole (`WebgpuVisState.pageTable`), the bins and the work buffer
 * (`../../visibility/bins/bins.ts`), the raster's lists — each a record for each cluster the list
 * holds room for —, and the stages of the bins for the layers the session draws. A table of another
 * size is made anew beside the one it replaces, which is retired: the commands of the frame about
 * to be encoded name the new one alone, since this runs first. The decode's pipelines, the placements'
 * records the decode reads and the measure of the clusters' edges follow here too. False while the
 * frame has no cut, or its records are not in place.
 */
export function followVisibleTables(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, run, setup } = rt,
    cut = run.gpuSelection
  if (!cut) return false
  const cap = cut.visibleCap
  if (cap > VIS_MAX_PAGES)
    throw new Error(
      `VISIBILITY_ID_RANGE: ${cap} visible clusters exceed the ${VIS_MAX_PAGES} a visibility identifier addresses`,
    )
  askVisibleStages(rt, device)
  const bytes = Math.max(PAGE_INFO_STRIDE, cap * PAGE_INFO_STRIDE)
  if (!vis.pageTable || vis.pageTable.size !== bytes) {
    if (vis.pageTable) retire(device, vis.pageTable)
    vis.pageTable = constructGpuResources(device, () => pageTableBuffer(device, bytes))
  }
  const stages = vis.binStages!
  if (!vis.gpuBins || vis.gpuBins.cap !== cap || vis.gpuBins.slots !== stages.slots) {
    const old = vis.gpuBins
    if (old) retire(device, { destroy: () => old.dispose() })
    vis.gpuBins = constructGpuResources(device, () =>
      createGpuBins(device, stages, cap, setup.maxCorners),
    )
  }
  const raster = vis.gpuRaster
  if (raster && raster.capacity !== cap)
    constructGpuResources(device, () => raster.growLists(device, cap)).commit()
  return uploadPlacementTables(rt, device)
}

/** The clusters whose records the residency wrote since the last image measured, their longest edges
 *  in the cut's table before it reads them (`../../geometry/dag/info/measure.ts`). */
export function encodeClusterMeasure(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { vis, run, gpu } = rt,
    cut = run.gpuSelection
  if (!vis.clusterMeasure?.pending || !cut || !gpu.cache || !vis.concatPos) return
  vis.clusterMeasure.encode(encoder, {
    indices: gpu.cache.buffer,
    positions: vis.concatPos,
    info: cut.info,
    edges: cut.edges,
  })
}
