import { disposeWaterTargets } from '../../blend/water/waterTargets.ts'
import type { WebgpuRunState } from '../backend/state/run.ts'
import { disposeEntryCorners } from '../../blend/transparent/entryCorners.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The previous image's occluders no longer describe this one. */
export function invalidateOccluderHistory(run: WebgpuRunState) {
  run.noOccluderHistory = true
}

/** The visibility raster dropped, made again at its next image over what grew; no occluder
 *  history describes the new clusters. */
export function dropRaster(rt: Pick<WebgpuPagesRuntime, 'vis' | 'run'>) {
  rt.vis.gpuRaster?.dispose()
  rt.vis.gpuRaster = undefined
  invalidateOccluderHistory(rt.run)
}

/** A capability now served: it leaves the list of what the backend declares unsupported. */
export function grantCapability(capabilities: WebgpuPagesRuntime['capabilities'], item: string) {
  capabilities.unsupported = capabilities.unsupported.filter((entry) => entry !== item)
}

/** Releases the GPU cut, at dispose. */
export function dropGpuSelection(rt: WebgpuPagesRuntime) {
  // Origin of the resource change: the cut's tables leave.
  rt.run.gate.resourcesChanged()
  rt.run.gpuSelection?.dispose()
  rt.run.gpuSelection = undefined
}

/** The transparent occlusion test lives with the pyramid it reads: it leaves with it, and the
 *  transparent table gets all its entries back. */
function dropTransparentOcclusion(rt: WebgpuPagesRuntime) {
  rt.blendState.occlusion?.dispose()
  rt.blendState.occlusion = undefined
  disposeEntryCorners(rt.blendState.occlusionEntries)
  rt.blendState.occlusionEntries = undefined
  rt.blendState.occlusionEpoch = -1
}

function dropGpuHiz(rt: WebgpuPagesRuntime) {
  const { vis } = rt
  dropTransparentOcclusion(rt)
  vis.gpuHiz?.dispose()
  vis.gpuHiz = undefined
  invalidateOccluderHistory(rt.run)
}

/** The decode, the bins and what they read and write, which follow the cut's list of visible
 *  clusters (`../render/visibleTables.ts`), and the measure of the clusters' edges. */
function dropVisibleTables(rt: WebgpuPagesRuntime) {
  const { vis } = rt
  vis.gpuBins?.dispose()
  vis.gpuBins = undefined
  vis.binStages = undefined
  vis.gpuDecode = undefined
  vis.clusterMeasure?.dispose()
  vis.clusterMeasure = undefined
  vis.placementGpu?.buffer.destroy()
  vis.placementGpu?.outputs.destroy()
  vis.placementGpu = undefined
}

/** Releases the visibility path's GPU resources, at dispose. */
export function disposeVis(rt: WebgpuPagesRuntime) {
  const { vis } = rt
  vis.visPipelineBack = undefined
  vis.visPipelineNone = undefined
  vis.visPipelineFront = undefined
  vis.drawLayerSlots = 1
  // Their bundles hold the pipelines and groups that go.
  for (const bundles of vis.visBundles) bundles.clear()
  vis.shadeClasses = undefined
  vis.shadeCensus = undefined
  vis.shadeBins?.dispose()
  vis.shadeBins = undefined
  vis.voxelSteps?.dispose()
  vis.voxelSteps = undefined
  vis.shadeModule = undefined
  vis.shadeBindGroupLayout = undefined
  vis.visBindGroupLayout = undefined
  vis.mapsSampler = undefined
  vis.blendBindGroupLayout = undefined
  vis.blendPipelines = undefined
  // The feedback variant compiling or compiled aside goes with the pipelines it was to replace.
  vis.feedbackAside = undefined
  rt.blendState.overdraw?.dispose()
  rt.blendState.overdraw = undefined
  disposeWaterTargets(rt.blendState)
  vis.gpuRaster?.dispose()
  vis.gpuRaster = undefined
  dropVisibleTables(rt)
  dropGpuHiz(rt)
  // The pool frees its buffers and its normal atlas: the concatenated buffers only come with it.
  vis.vertexPool?.destroy()
  vis.pageTable?.destroy()
  vis.materialTable.dispose()
  vis.shadeUniform?.destroy()
  vis.visUniform?.destroy()
  vis.zeroRows?.destroy()
  vis.textures?.destroy()
  vis.textures = undefined
  vis.vertexPool = undefined
  vis.extendGeometry = undefined
  vis.concatPos =
    vis.concatUv =
    vis.concatNrm =
    vis.pageTable =
    vis.shadeUniform =
    vis.visUniform =
    vis.zeroRows =
      undefined
}
