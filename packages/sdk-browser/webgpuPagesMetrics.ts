import { dropGpuSelection, dropVis } from './webgpuPagesDrops.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

export function metricsOf(rt: WebgpuPagesRuntime) {
  const { run, gpu, vis, timing, blendState, services } = rt;
  const stats = gpu.cache?.stats();
  let vertexBytes = 0;
  for (const buffer of gpu.positionBuffers.values()) vertexBytes += buffer.size;
  vertexBytes +=
    (vis.concatPos?.size ?? 0) + (vis.concatUv?.size ?? 0) + (vis.concatNrm?.size ?? 0);
  for (const item of blendState.blendGpu)
    vertexBytes +=
      item.index.size +
      (item.uv?.size ?? 0) +
      (item.normal?.size ?? 0) +
      (item.diagnosticBuffer?.size ?? 0);
  const pending = run.gpuFrameActive && !run.gpuMetricsReady;
  return {
    coverageReady: services.bootstrapState.ready,
    coverageBudgetLimited: run.coverageBudgetLimited,
    clusters: pending ? null : run.visible,
    selectedTriangles: run.selectedTriangles,
    uncoveredTriangles: run.uncoveredTriangles,
    residentPages: run.gpuFrameActive ? (stats?.residentPages ?? 0) : run.drawn.length,
    cacheEvictions: stats?.evictions ?? 0,
    geometryAllocationBytes: (stats?.allocatedBytes ?? 0) + vertexBytes,
    frustumRejected: run.frustumRejected,
    lodLevel: run.lodLevel,
    submittedTriangles: pending ? null : run.submittedTriangles,
    totalSubmittedTriangles: pending ? null : run.submittedTriangles,
    transparentMeshes: blendState.visibleBlend.length,
    transparentFrustumRejected: run.blendFrustumRejected,
    transparentDrawCalls: run.blendDrawCalls,
    transparentSubmittedTriangles: run.blendSubmittedTriangles,
    textureUploaded: rt.texturePump.uploaded,
    texturePending: vis.textureJobs.length,
    textureSkipped: rt.texturePump.skipped,
    cpuSubmitMs: timing.lastSubmitMs,
    gpuPassMs: timing.lastGpuPassMs,
    gpuFrameMs: timing.lastGpuFrameMs,
    gpuHostGapMs: timing.lastGpuHostGapMs,
    vramBytes: null,
    drawCalls: run.gpuDrawCalls,
  };
}

/** Releases every GPU resource and the scene; the trace queue is drained before the promise settles. */
export function disposeWebgpuPages(
  rt: WebgpuPagesRuntime,
  onGpuError: (event: GPUUncapturedErrorEvent) => void,
) {
  const { run, gpu, vis, capture, timing, blendState, services } = rt,
    { gpuDevice, scene, pagedBlendCopies } = rt.setup;
  gpuDevice?.removeEventListener?.('uncapturederror', onGpuError);
  run.lost = true;
  services.residency.quietPending();
  timing.gpuTiming?.dispose();
  dropGpuSelection(rt);
  dropVis(rt);
  vis.visTexture?.destroy();
  vis.visTexture = undefined;
  vis.visView = undefined;
  for (const buffer of gpu.positionBuffers.values()) buffer.destroy();
  for (const item of blendState.blendGpu) {
    item.index.destroy();
    item.uv?.destroy();
    item.normal?.destroy();
    item.diagnosticBuffer?.destroy();
  }
  blendState.blendGpu.length = 0;
  blendState.pagedBlendGpu.clear();
  pagedBlendCopies.clear();
  blendState.blendCuts.clear();
  blendState.blendDrawnPages.length = 0;
  blendState.visibleBlend.length = 0;
  gpu.uniformBuffer?.destroy();
  gpu.uniformBuffer = undefined;
  gpu.colorTexture?.destroy();
  gpu.depthTexture?.destroy();
  gpu.hdrTexture?.destroy();
  gpu.surfaces?.dispose();
  capture.surfaceCapture?.dispose();
  gpu.deferred?.dispose();
  gpu.lights?.dispose();
  gpu.presenter?.dispose();
  gpu.synchronousCapture?.dispose();
  gpu.canvasTexture?.dispose();
  gpu.blitMaterial?.dispose();
  gpu.blit?.geometry.dispose();
  const closing = gpu.cache?.dispose();
  gpu.cache = undefined;
  scene.clear();
  rt.diag.drainTraceNow();
  return Promise.resolve(closing).then(() => {});
}
