import type { WebgpuRunState } from './webgpuPagesStateRun.ts';
import {
  UNTEXTURED_MATERIALS,
  VIS_FEATURES,
  type WebgpuPagesRuntime,
} from './webgpuPagesRuntime.ts';

/** The previous image no longer describes this one: neither its occluders nor its temporal pyramid. */
export function invalidateOccluderHistory(run: WebgpuRunState) {
  run.noOccluderHistory = true;
  run.temporalHizState.pyramid = undefined;
  run.temporalHizState.camera = undefined;
}

export function resetHizHistory(run: WebgpuRunState) {
  invalidateOccluderHistory(run);
  run.previousHizView = undefined;
  run.temporalHizState.viewport = undefined;
}

export function dropGpuSelection(rt: WebgpuPagesRuntime) {
  rt.run.gpuSelection?.dispose();
  rt.run.gpuSelection = undefined;
  rt.capabilities.gpuDriven = false;
}

export function dropGpuHiz(rt: WebgpuPagesRuntime) {
  const { vis } = rt;
  vis.gpuHiz?.dispose();
  vis.gpuHiz = undefined;
  vis.visHizBindGroup = undefined;
  vis.visHizRestBack = undefined;
  vis.visHizRestBackCw = undefined;
  vis.visHizRestNone = undefined;
  vis.visHizRestFront = undefined;
  vis.visHizRestFrontCw = undefined;
  resetHizHistory(rt.run);
}

function dropGpuDraw(rt: WebgpuPagesRuntime) {
  rt.vis.gpuDraw?.dispose();
  rt.vis.gpuDraw = undefined;
  if (!rt.capabilities.unsupported.includes('indirect draw'))
    rt.capabilities.unsupported.push('indirect draw');
}

export function dropVis(rt: WebgpuPagesRuntime) {
  const { vis, capabilities } = rt,
    { rows, drawSlots } = rt.layout;
  vis.visEnabled = false;
  vis.visPipelineBack = undefined;
  vis.visPipelineBackCw = undefined;
  vis.visPipelineNone = undefined;
  vis.visPipelineFront = undefined;
  vis.visPipelineFrontCw = undefined;
  vis.visLayerPipelines.length = 0;
  vis.drawLayerSlots = 1;
  vis.shadePipeline = undefined;
  vis.shadeBindGroup = undefined;
  vis.shadeBindGroupLayout = undefined;
  vis.visBindGroupLayout = undefined;
  vis.visBindGroup = undefined;
  vis.visHizBindGroup = undefined;
  vis.mapsSampler = undefined;
  vis.blendBindGroupLayout = undefined;
  vis.pipelineBlendTextured = undefined;
  vis.pipelineBlendFront = undefined;
  vis.pipelineBlendBack = undefined;
  for (const item of rt.blendState.blendGpu) item.group = undefined;
  vis.gpuSmall?.dispose();
  vis.gpuSmall = undefined;
  dropGpuDraw(rt);
  dropGpuHiz(rt);
  vis.concatPos?.destroy();
  vis.concatUv?.destroy();
  vis.concatNrm?.destroy();
  vis.pageTable?.destroy();
  vis.shadeUniform?.destroy();
  vis.visUniform?.destroy();
  vis.zeroFlags?.destroy();
  vis.colorAtlas?.destroy();
  vis.dataAtlas?.destroy();
  vis.materialScales?.destroy();
  vis.materialScales = undefined;
  vis.visSlotGroups.fill(undefined);
  vis.smallGroups.fill(undefined);
  vis.concatPos =
    vis.concatUv =
    vis.concatNrm =
    vis.pageTable =
    vis.shadeUniform =
    vis.visUniform =
    vis.zeroFlags =
    vis.colorAtlas =
    vis.dataAtlas =
      undefined;
  vis.slots?.destroy();
  vis.slots = undefined;
  vis.slotPyramids = [];
  rows.pageTableFloats = undefined;
  rows.pageTableInts = undefined;
  rows.rowPageIndex.fill(-1);
  rows.rowOffsetWords.fill(-1);
  rows.rowEpoch.fill(0);
  rows.rowCount = 0;
  rows.dirtyFrom = drawSlots;
  rows.dirtyTo = -1;
  rows.candidateCount = 0;
  rows.packedCount = 0;
  rows.rowsChanged = true;
  rt.layout.hizProjection.invalidate();
  capabilities.materials = UNTEXTURED_MATERIALS;
  vis.textureJobs.length = 0;
  for (const item of VIS_FEATURES)
    if (!capabilities.unsupported.includes(item)) capabilities.unsupported.push(item);
}
