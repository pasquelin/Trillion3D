import type { WebgpuRunState } from './webgpuPagesStateRun.ts';
import {
  UNTEXTURED_MATERIALS,
  VIS_FEATURES,
  type WebgpuPagesRuntime,
} from './webgpuPagesRuntime.ts';

/**
 * The temporal pyramid no longer describes this image. It is reread only for a view identical to the
 * bit, so a camera move drops it; the occluder history names pages only and depends on no view.
 */
export function invalidateTemporalPyramid(run: WebgpuRunState) {
  run.temporalHizState.pyramid = undefined;
  run.temporalHizState.camera = undefined;
}

/** Neither the previous image's occluders nor its pyramid describe this one. */
export function invalidateOccluderHistory(run: WebgpuRunState) {
  run.noOccluderHistory = true;
  invalidateTemporalPyramid(run);
}

/** A capability now served: it leaves the list of what the backend declares unsupported. */
export function grantCapability(capabilities: WebgpuPagesRuntime['capabilities'], item: string) {
  capabilities.unsupported = capabilities.unsupported.filter((entry) => entry !== item);
}

export function resetHizHistory(run: WebgpuRunState) {
  invalidateOccluderHistory(run);
  run.previousHizView = undefined;
  run.temporalHizState.viewport = undefined;
}

/**
 * Fallback to the CPU cut, announced. GPU selection is dropped only on a real failure — identifier
 * capacity, send error, lost encode, failed sample — never because a wanted page has not arrived yet.
 * A bench that would measure the CPU cut while thinking it measures the GPU cut reads it in
 * `gpuSelectionFallback` and in this diagnostic, emitted once per session.
 */
export function fallbackToCpuCut(
  rt: WebgpuPagesRuntime,
  reason: string,
  details: Record<string, unknown> = {},
) {
  if (!rt.gpu.selectionFallback) {
    rt.gpu.selectionFallback = true;
    rt.diag.engineDiagnostic(
      'gpu-selection-fallback',
      'Warning: GPU selection dropped, the CPU cut now draws',
      { reason, ...details },
    );
  }
  dropGpuSelection(rt);
}

export function dropGpuSelection(rt: WebgpuPagesRuntime) {
  // Origin of the resource change: GPU selection is no longer a capability of this engine, and the
  // next image rebuilds its cut without it.
  rt.run.gate.resourcesChanged();
  rt.run.gpuSelection?.dispose();
  rt.run.gpuSelection = undefined;
  rt.capabilities.gpuDriven = false;
}

/** The partition lives with the pyramid and compaction: it writes one and reads the other. */
function dropGpuPartition(rt: WebgpuPagesRuntime) {
  // The transparent occlusion test reads the partition uniform: it leaves with it, and the
  // transparent table gets all its entries back.
  rt.blendState.occlusion?.dispose();
  rt.blendState.occlusion = undefined;
  rt.blendState.occlusionEpoch = -1;
  rt.vis.gpuPartition?.dispose();
  rt.vis.gpuPartition = undefined;
  rt.run.occluderHistoryEpoch = -1;
}

export function dropGpuHiz(rt: WebgpuPagesRuntime) {
  const { vis } = rt;
  dropGpuPartition(rt);
  vis.gpuHiz?.dispose();
  vis.gpuHiz = undefined;
  vis.visHizBindGroup = undefined;
  vis.visHizRestBack = undefined;
  vis.visHizRestNone = undefined;
  vis.visHizRestFront = undefined;
  resetHizHistory(rt.run);
}

function dropGpuDraw(rt: WebgpuPagesRuntime) {
  dropGpuPartition(rt);
  // Compaction of the tested half names only the draw-compaction buffers.
  rt.vis.gpuRestCompact?.dispose();
  rt.vis.gpuRestCompact = undefined;
  rt.vis.gpuDraw?.dispose();
  rt.vis.gpuDraw = undefined;
  if (!rt.capabilities.unsupported.includes('indirect draw'))
    rt.capabilities.unsupported.push('indirect draw');
}

/**
 * Bind groups that name the shared draw resources — page-pool buffer, page table, tile pools,
 * uniforms —: one of them just changed identity, they are rebuilt next image. Shadow-region groups
 * are indexed by the identity of what they hold and rebuild themselves.
 */
export function dropPoolBindGroups(rt: Pick<WebgpuPagesRuntime, 'vis' | 'gpu' | 'blendState'>) {
  const { vis, gpu, blendState } = rt;
  vis.visBindGroup = undefined;
  vis.visHizBindGroup = undefined;
  vis.shadeBindGroup = undefined;
  vis.visSlotGroups.fill(undefined);
  vis.rasterGroups.fill(undefined);
  gpu.bindGroups.clear();
  for (const item of blendState.blendGpu) item.group = undefined;
  blendState.pagedGroup = undefined;
}

export function dropVis(rt: WebgpuPagesRuntime) {
  const { vis, capabilities } = rt,
    { rows, drawSlots } = rt.layout;
  // Origin of the resource change: the visibility buffer is no longer a capability.
  rt.run.gate.resourcesChanged();
  vis.visEnabled = false;
  vis.visPipelineBack = undefined;
  vis.visPipelineBackCw = undefined;
  vis.visPipelineNone = undefined;
  vis.visPipelineFront = undefined;
  vis.visPipelineFrontCw = undefined;
  vis.visLayerPipelines.length = 0;
  vis.drawLayerSlots = 1;
  vis.shadePipeline = undefined;
  vis.shadeBindGroupLayout = undefined;
  vis.visBindGroupLayout = undefined;
  vis.mapsSampler = undefined;
  vis.blendBindGroupLayout = undefined;
  vis.pipelineBlendTextured = undefined;
  vis.pipelineBlendFront = undefined;
  vis.pipelineBlendBack = undefined;
  dropPoolBindGroups(rt);
  rt.blendState.overdraw?.dispose();
  rt.blendState.overdraw = undefined;
  vis.gpuRaster?.dispose();
  vis.gpuRaster = undefined;
  dropGpuDraw(rt);
  dropGpuHiz(rt);
  vis.concatPos?.destroy();
  vis.concatUv?.destroy();
  vis.concatNrm?.destroy();
  vis.pageTable?.destroy();
  vis.shadeUniform?.destroy();
  vis.visUniform?.destroy();
  vis.zeroFlags?.destroy();
  vis.textures?.destroy();
  vis.textures = undefined;
  vis.visSlotGroups.fill(undefined);
  vis.rasterGroups.fill(undefined);
  vis.concatPos =
    vis.concatUv =
    vis.concatNrm =
    vis.pageTable =
    vis.shadeUniform =
    vis.visUniform =
    vis.zeroFlags =
      undefined;
  rows.pageTableFloats = undefined;
  rows.pageTableInts = undefined;
  rows.rowPageIndex.fill(-1);
  rows.rowOffsetWords.fill(-1);
  rows.rowEpoch.fill(0);
  rows.rowCount = 0;
  rows.rowsRevision++;
  rows.dirtyFrom = drawSlots;
  rows.dirtyTo = -1;
  rows.candidateCount = 0;
  rows.packedCount = 0;
  rows.rowsChanged = true;
  capabilities.materials = UNTEXTURED_MATERIALS;
  for (const item of VIS_FEATURES)
    if (!capabilities.unsupported.includes(item)) capabilities.unsupported.push(item);
}
