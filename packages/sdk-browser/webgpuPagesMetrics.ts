import { dropGpuSelection, dropVis } from './webgpuPagesDrops.ts';
import { disposeBackdrop } from './webgpuTransmission.ts';
import { dropBlendBuffers } from './webgpuBlendBuffers.ts';
import { directLightTimings } from './stageMapping.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Les octets de sommets d'une image : le total tenu à l'allocation, plus les trois tampons
 * concaténés du visbuffer. Le relevé est interrogé à chaque image et l'ensemble des pages
 * résidentes en compte des milliers : il ne les resomme plus, il lit le compteur.
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
  const { run, gpu, vis, timing, blendState, services, lights } = rt;
  const stats = gpu.cache?.stats();
  const vertexBytes = vertexBytesOf(gpu, vis);
  const pending = run.gpuFrameActive && !run.gpuMetricsReady;
  // Ce que le test d'occultation a éliminé, du chemin qui l'a fait tourner : les compteurs que la
  // carte a écrits sur la dernière image relevée, ou ceux de l'oracle processeur là où aucun test
  // GPU ne tourne. `null` quand ni l'un ni l'autre n'a compté d'image — jamais un nombre à la place
  // d'un nombre non mesuré.
  const gpuHizCounts = vis.gpuPartition?.counts();
  const [hiz, hizCountedFrame] = vis.gpuPartition
    ? [gpuHizCounts, gpuHizCounts?.frame ?? null]
    : run.cpuHizCounted
      ? [run.cpuHizCounts, run.frame]
      : [undefined, null];
  return {
    coverageReady: services.bootstrapState.ready,
    coverageBudgetLimited: run.coverageBudgetLimited,
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
    textureUploaded: rt.texturePump.uploaded,
    texturePending: vis.textureJobs.length,
    textureSkipped: rt.texturePump.skipped,
    textureInFlight: rt.texturePump.inFlight,
    textureSlicesUploaded: rt.texturePump.slices,
    textureBytesLastFrame: rt.texturePump.bytesLastPass,
    textureLevelsUploaded: rt.texturePump.levels,
    textureResidentBytes: rt.textureLedger.committed,
    textureBudgetBytes: rt.textureLedger.budget,
    textureEvictions: rt.textureLedger.evictions,
    textureAtWantedLevel: rt.texturePriority.counters.atWanted,
    textureLayers: rt.texturePriority.layers,
    textureMissingLevels: rt.texturePriority.counters.missingAverage,
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
    gpuSelectionFallback: rt.gpu.selectionFallback,
    lightsActive: lights.lightsActive,
    shadowsUpdated: lights.shadowsUpdated,
    shadowFacesDrawn: lights.shadowFaces,
    shadowDrawCalls: lights.shadowDrawCalls,
    shadowPagesDrawn: lights.shadowPages,
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
  blendState.expand?.dispose();
  blendState.expand = undefined;
  blendState.expandedBuffer?.destroy();
  blendState.expandedBuffer = undefined;
  blendState.itemBuffer?.destroy();
  blendState.itemBuffer = undefined;
  blendState.viewBuffer?.destroy();
  blendState.viewBuffer = undefined;
  blendState.argsBuffer?.destroy();
  blendState.argsBuffer = undefined;
  blendState.pagedGroup = undefined;
  gpu.uniformBuffer?.destroy();
  gpu.uniformBuffer = undefined;
  gpu.volumeBuffer?.destroy();
  gpu.volumeBuffer = undefined;
  gpu.colorTexture?.destroy();
  gpu.depthTexture?.destroy();
  gpu.hdrTexture?.destroy();
  disposeBackdrop(gpu);
  gpu.surfaces?.dispose();
  capture.surfaceCapture?.dispose();
  gpu.deferred?.dispose();
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
  rt.lights.shadowGroupsKey = [];
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
