import { dropGpuSelection, dropVis } from './webgpuPagesDrops.ts';
import { directLightTimings } from './stageMapping.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

export function metricsOf(rt: WebgpuPagesRuntime) {
  const { run, gpu, vis, timing, blendState, services, lights } = rt;
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
  // What the occlusion test eliminated, from the path that ran it: the GPU verdicts of the last
  // image whose flags came back, or the CPU oracle's own image where no GPU test runs. Null when
  // neither has counted one, never a number standing in for an unmeasured one.
  const gpuHizCounts = vis.gpuHiz?.counts();
  const [hiz, hizCountedFrame] = vis.gpuHiz
    ? [gpuHizCounts, gpuHizCounts?.frame ?? null]
    : run.cpuHizCounted
      ? [run.cpuHizCounts, run.frame]
      : [undefined, null];
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
    textureInFlight: rt.texturePump.inFlight,
    textureSlicesUploaded: rt.texturePump.slices,
    textureBytesLastFrame: rt.texturePump.bytesLastPass,
    textureLevelsUploaded: rt.texturePump.levels,
    // Octets calculés depuis les dimensions, les couches et les formats alloués : rien n'est mesuré
    // sur l'appareil ici, et un atlas encore absent ne vaut pas zéro mais `null`.
    textureAtlasBytesCalculated:
      vis.colorAtlas && vis.dataAtlas ? vis.colorAtlas.bytes + vis.dataAtlas.bytes : null,
    textureAtlasClassBytesCalculated:
      vis.colorAtlas && vis.dataAtlas
        ? [...vis.colorAtlas.classes, ...vis.dataAtlas.classes].map((entry) => entry.bytes)
        : null,
    textureAtlasClassesUsed: vis.colorAtlas?.used ?? null,
    cpuSubmitMs: timing.lastSubmitMs,
    gpuPassMs: timing.lastGpuPassMs,
    gpuFrameMs: timing.lastGpuFrameMs,
    gpuHostGapMs: timing.lastGpuHostGapMs,
    vramBytes: null,
    drawCalls: run.gpuDrawCalls,
    hizTestedClusters: hiz?.tested ?? null,
    hizRejectedClusters: hiz?.rejected ?? null,
    hizOversizedClusters: hiz?.oversized ?? null,
    hizTestedTriangles: hiz?.testedTriangles ?? null,
    hizRejectedTriangles: hiz?.rejectedTriangles ?? null,
    hizOversizedTriangles: hiz?.oversizedTriangles ?? null,
    hizCountedFrame,
    cpuSelectMs: run.cpuSelectMs,
    lightsActive: lights.lightsActive,
    shadowsUpdated: lights.shadowsUpdated,
    shadowFacesDrawn: lights.shadowFaces,
    shadowDrawCalls: lights.shadowDrawCalls,
    ...directLightTimings(timing.lastGpuPassMs),
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
  rt.lights.tiles?.dispose();
  rt.lights.shadows?.dispose();
  rt.lights.buffer?.destroy();
  rt.lights.plan.reset();
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
