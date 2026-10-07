import type { WebgpuRunState } from '../state/run.ts'
import { markWebgpuLost } from './lost.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** The previous image's occluders no longer describe this one. */
export function invalidateOccluderHistory(run: WebgpuRunState) {
  run.noOccluderHistory = true
}

/** A capability now served: it leaves the list of what the backend declares unsupported. */
export function grantCapability(capabilities: WebgpuPagesRuntime['capabilities'], item: string) {
  capabilities.unsupported = capabilities.unsupported.filter((entry) => entry !== item)
}

function resetHizHistory(run: WebgpuRunState) {
  invalidateOccluderHistory(run)
  run.previousHizView = undefined
}

/**
 * The GPU cut failed — a readback the device could not map, a send or an encode it refused. It is
 * the engine's one cut (#1483): nothing else draws, so the device is declared lost as for any error
 * of its own (`./lost.ts`), and the host opens the session again on a new one.
 */
export function loseGpuSelection(rt: WebgpuPagesRuntime, reason: string, error?: unknown) {
  const message = error === undefined ? reason : `${reason}: ${String(error)}`
  markWebgpuLost(rt, { reason: 'gpu-selection', message })
}

/** Releases the GPU cut, at dispose. */
export function dropGpuSelection(rt: WebgpuPagesRuntime) {
  // Origin of the resource change: the cut's tables leave.
  rt.run.gate.resourcesChanged()
  rt.run.gpuSelection?.dispose()
  rt.run.gpuSelection = undefined
}

/** The partition lives with the pyramid and compaction: it writes one and reads the other. */
function dropGpuPartition(rt: WebgpuPagesRuntime) {
  // The transparent occlusion test reads the partition uniform: it leaves with it, and the
  // transparent table gets all its entries back.
  rt.blendState.occlusion?.dispose()
  rt.blendState.occlusion = undefined
  rt.blendState.occlusionEpoch = -1
  rt.vis.gpuPartition?.dispose()
  rt.vis.gpuPartition = undefined
}

function dropGpuHiz(rt: WebgpuPagesRuntime) {
  const { vis } = rt
  dropGpuPartition(rt)
  vis.gpuHiz?.dispose()
  vis.gpuHiz = undefined
  vis.visHizRestBack = undefined
  vis.visHizRestNone = undefined
  vis.visHizRestFront = undefined
  resetHizHistory(rt.run)
}

function dropGpuDraw(rt: WebgpuPagesRuntime) {
  dropGpuPartition(rt)
  // Compaction of the tested half names only the draw-compaction buffers.
  rt.vis.gpuRestCompact?.dispose()
  rt.vis.gpuRestCompact = undefined
  rt.vis.gpuDraw?.dispose()
  rt.vis.gpuDraw = undefined
}

/** Releases the visibility path's GPU resources, at dispose. */
export function disposeVis(rt: WebgpuPagesRuntime) {
  const { vis } = rt,
    { rows } = rt.layout
  vis.visPipelineBack = undefined
  vis.visPipelineNone = undefined
  vis.visPipelineFront = undefined
  vis.visLayerPipelines.length = 0
  vis.drawLayerSlots = 1
  // Their bundles hold the pipelines and groups that go.
  for (const bundles of vis.visBundles) bundles.clear()
  vis.shadeBundles.clear()
  vis.shadeClasses = undefined
  vis.shadeCensus = undefined
  vis.materialTiles?.dispose()
  vis.materialTiles = undefined
  vis.shadeCache?.dispose()
  vis.shadeCache = undefined
  vis.shadeBindGroupLayout = undefined
  vis.visBindGroupLayout = undefined
  vis.mapsSampler = undefined
  vis.blendBindGroupLayout = undefined
  vis.blendPipelines = undefined
  rt.blendState.water?.frame.dispose()
  rt.blendState.water = undefined
  // The feedback variant compiling or compiled aside goes with the pipelines it was to replace.
  vis.feedbackAside?.set?.water?.frame.dispose()
  vis.feedbackAside = undefined
  rt.blendState.overdraw?.dispose()
  rt.blendState.overdraw = undefined
  vis.gpuRaster?.dispose()
  vis.gpuRaster = undefined
  dropGpuDraw(rt)
  dropGpuHiz(rt)
  // The pool frees its buffers and its normal atlas; without one, the buffers alone.
  if (vis.vertexPool) vis.vertexPool.destroy()
  else {
    vis.concatPos?.destroy()
    vis.concatUv?.destroy()
  }
  vis.pageTable?.destroy()
  vis.physicalTable.dispose()
  vis.shadeUniform?.destroy()
  vis.visUniform?.destroy()
  vis.zeroFlags?.destroy()
  vis.textures?.destroy()
  vis.textures = undefined
  vis.vertexPool = undefined
  vis.concatPos =
    vis.concatUv =
    vis.concatNrm =
    vis.pageTable =
    vis.shadeUniform =
    vis.visUniform =
    vis.zeroFlags =
      undefined
  rows.pageTableFloats = undefined
  rows.pageTableInts = undefined
}
