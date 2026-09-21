import { dropGpuSelection, dropVis } from './webgpuPagesDrops.ts';
import { disposeBackdrop } from './webgpuTransmission.ts';
import { dropBlendBuffers } from './webgpuBlendBuffers.ts';
import { disposeBlendResources } from './webgpuBlendResources.ts';
import { directLightTimings } from './stageMapping.ts';
import { taaSampledRank } from './taaFrame.ts';
import { gpuDeviceLedgerOf } from './gpuDeviceLedger.ts';
import { markWebgpuLost } from './webgpuPagesLost.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Vertex bytes of an image: the total held at allocation, plus the three concatenated visbuffer
 * buffers. The sample is queried every image and resident pages number in the thousands: it no
 * longer resums them, it reads the counter.
 */
export function vertexBytesOf(
  gpu: Pick<WebgpuPagesRuntime['gpu'], 'vertexBytes'>,
  vis: Pick<WebgpuPagesRuntime['vis'], 'concatPos' | 'concatUv' | 'concatNrm'>,
) {
  return (
    gpu.vertexBytes +
    (vis.concatPos?.size ?? 0) +
    (vis.concatUv?.size ?? 0) +
    (vis.concatNrm?.size ?? 0)
  );
}

export function metricsOf(rt: WebgpuPagesRuntime) {
  const { run, gpu, vis, timing, blendState, services, lights } = rt,
    { geometryPool } = rt.setup;
  const stats = gpu.cache?.stats();
  const vertexBytes = vertexBytesOf(gpu, vis);
  const ledger = gpuDeviceLedgerOf(rt.setup.gpuDevice)?.snapshot();
  const pending = run.gpuFrameActive && !run.gpuMetricsReady;
  // What the occlusion test dropped, from the path that ran it: counts the GPU wrote on the last
  // sampled image, or the CPU oracle's where no GPU test runs. `null` when neither has counted an
  // image — never a number in place of an unmeasured number.
  const gpuHizCounts = vis.gpuPartition?.counts();
  const [hiz, hizCountedFrame] = vis.gpuPartition
    ? [gpuHizCounts, gpuHizCounts?.frame ?? null]
    : run.cpuHizCounted
      ? [run.cpuHizCounts, run.frame]
      : [undefined, null];
  return {
    coverageReady: services.bootstrapState.ready,
    coverageBudgetLimited: run.coverageBudgetLimited,
    budgetPixelError: run.budgetPixelError,
    frameHeld: run.frameHeld,
    clusters: pending ? null : run.visible,
    selectedTriangles: run.selectedTriangles,
    uncoveredTriangles: run.uncoveredTriangles,
    drawnTriangles: run.drawnTriangles,
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
    // Virtual textures: the pool, the tiles, image feedback. All `null` until prepare has built them,
    // never a zero in place of a missing pool.
    ...(vis.textures?.metrics() ?? {}),
    cpuSubmitMs: timing.lastSubmitMs,
    gpuPassMs: timing.lastGpuPassMs,
    gpuFrameMs: timing.lastGpuFrameMs,
    gpuHostGapMs: timing.lastGpuHostGapMs,
    vramBytes: null,
    // Device ledger: everything the engine allocated and has not yet destroyed, computed from the
    // descriptors. `null` until a ledger is posted, never zero.
    gpuAllocatedBytes: ledger?.bytes ?? null,
    gpuAllocatedByLabel: ledger?.byLabel ?? null,
    gpuAllocationsUnknownFormat: ledger?.unknownFormats ?? null,
    gpuFrameTargetBytes: gpu.targetBytes || null,
    geometryPoolBytes: geometryPool.budgetBytes,
    geometryPoolSlots: geometryPool.slots,
    geometryPoolAllocatedBytes: geometryPool.allocatedBytes,
    geometryPoolClamp: geometryPool.clamp,
    geometryPoolSaturated: Math.max(0, services.residencySets.keepCount - geometryPool.slots),
    texturePoolClamp: rt.setup.texturePools?.pool.clamp ?? null,
    drawCalls: run.gpuDrawCalls,
    hizTestedClusters: hiz?.tested ?? null,
    hizRejectedClusters: hiz?.rejected ?? null,
    hizOversizedClusters: hiz?.oversized ?? null,
    hizTestedTriangles: hiz?.testedTriangles ?? null,
    hizRejectedTriangles: hiz?.rejectedTriangles ?? null,
    hizOversizedTriangles: hiz?.oversizedTriangles ?? null,
    hizCountedFrame,
    cpuSelectMs: run.cpuSelectMs,
    gpuSelectionFallback: rt.gpu.selectionFallback,
    lightsActive: lights.lightsActive,
    lightsSampled: lights.lightsActive > 0 && taaSampledRank(rt) > 0,
    shadowsUpdated: lights.shadowsUpdated,
    shadowFacesDrawn: lights.shadowFaces,
    shadowDrawCalls: lights.shadowDrawCalls,
    shadowPagesDrawn: lights.shadowPages,
    shadowPagesTotal: lights.shadowPagesTotal,
    shadowPagesPending: lights.plan.counts.pendingPages,
    shadowWaitMs: lights.plan.counts.waitedMs,
    ...directLightTimings(timing.lastGpuPassMs),
  };
}

/** Releases every GPU resource and the scene; the trace queue is drained before the promise settles. */
export function disposeWebgpuPages(
  rt: WebgpuPagesRuntime,
  onGpuError: (event: GPUUncapturedErrorEvent) => void,
) {
  const { gpu, vis, capture, timing, blendState, services } = rt,
    { gpuDevice, scene, pagedBlendCopies } = rt.setup;
  gpuDevice?.removeEventListener?.('uncapturederror', onGpuError);
  // Disposed, it presents nothing any more: the same withdrawal as a loss, surface included.
  markWebgpuLost(rt);
  rt.run.gate.release();
  services.residency.quietPending();
  timing.gpuTiming?.dispose();
  dropGpuSelection(rt);
  dropVis(rt);
  vis.visTexture?.destroy();
  vis.visTexture = undefined;
  vis.visView = undefined;
  vis.materialDepthTexture?.destroy();
  vis.materialDepthTexture = undefined;
  vis.materialDepthView = undefined;
  for (const buffer of gpu.positionBuffers.values()) buffer.destroy();
  dropBlendBuffers(gpu);
  gpu.vertexBytes = 0;
  blendState.compaction?.dispose();
  blendState.compaction = undefined;
  blendState.table = undefined;
  blendState.blendGpu.length = 0;
  blendState.pagedBlendGpu.clear();
  blendState.cpuSelectedMeshes.clear();
  blendState.dirtySpans.clear();
  pagedBlendCopies.clear();
  blendState.visibleBlend.length = 0;
  disposeBlendResources(blendState);
  gpu.uniformBuffer?.destroy();
  gpu.uniformBuffer = undefined;
  gpu.volumeBuffer?.destroy();
  gpu.volumeBuffer = undefined;
  gpu.colorTexture?.destroy();
  gpu.depthTexture?.destroy();
  gpu.hdrTexture?.destroy();
  gpu.feedbackTexture?.destroy();
  disposeBackdrop(gpu);
  gpu.surfaces?.dispose();
  capture.surfaceCapture?.dispose();
  gpu.deferred?.dispose();
  gpu.temporal?.dispose();
  gpu.temporal = undefined;
  rt.lights.tiles?.dispose();
  rt.lights.shadows?.dispose();
  rt.bounce.probes?.dispose();
  rt.bounce.probes = undefined;
  rt.sunFar.gpu?.dispose();
  rt.sunFar.gpu = undefined;
  rt.lights.cull?.dispose();
  rt.lights.spheres?.buffer.destroy();
  rt.lights.spheres = undefined;
  rt.lights.shadowGroups.fill(undefined);
  rt.lights.shadowGroupsKey.length = 0;
  rt.lights.buffer?.destroy();
  rt.lights.plan.reset();
  gpu.synchronousCapture?.dispose();
  const closing = gpu.cache?.dispose();
  gpu.cache = undefined;
  scene.clear();
  rt.diag.drainTraceNow();
  return Promise.resolve(closing).then(() => {});
}
