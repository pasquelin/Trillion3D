import { DEFORMATION_PASS } from '../../../deformation/compute.ts';
import { dropGpuSelection, dropVis } from './drops.ts';
import { releaseTargets } from '../prepare/targets.ts';
import { dropBlendBuffers } from '../../blend/buffers.ts';
import { disposeBlendResources } from '../../blend/resources.ts';
import { directLightTimings } from '../../../stage/mapping.ts';
import { taaSampledRank } from '../../../taa/frame.ts';
import { gpuDeviceLedgerOf } from '../../../gpu/core/deviceLedger.ts';
import { markWebgpuLost } from './lost.ts';
import { disposeStaticLayer } from '../state/lights.ts';
import { shadowPoolHeld } from '../../shadow/memoryGrant.ts';
import { lightCutMetrics } from '../../shadow/casters.ts';
import { shadowWorkMetrics } from '../../shadow/work.ts';
import { shadowCpuMetrics } from '../../shadow/cpuSteps.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { releaseWebgpuView, useWebgpuView } from '../state/viewSwitch.ts';

/** Geometry bytes: the cached allocation total plus the three concatenated visibility buffers. */
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
  const ledger = gpuDeviceLedgerOf(gpu.device)?.snapshot();
  const pending = run.gpuFrameActive && !run.gpuMetricsReady;
  const poolHeld = lights.shadows?.texture ? shadowPoolHeld(lights) : null;
  // What the occlusion test dropped, from the path that ran it: the GPU's last sampled counts, or
  // the CPU oracle's where no GPU test runs; `null` when neither counted, never an unmeasured 0.
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
    uncoveredTriangles: null,
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
    ...(vis.textures?.metrics() ?? {}),
    cpuSubmitMs: timing.lastSubmitMs,
    gpuPassMs: timing.lastGpuPassMs,
    gpuDeformationMs:
      timing.lastGpuPassMs?.passes.find((pass) => pass.name === DEFORMATION_PASS)?.gpuMs ?? null,
    gpuFrameMs: timing.lastGpuFrameMs,
    gpuHostGapMs: timing.lastGpuHostGapMs,
    gpuDeviceLost: run.lostCause ?? null,
    vramBytes: null,
    gpuAllocatedBytes: ledger?.bytes ?? null,
    gpuAllocatedByLabel: ledger?.byLabel ?? null,
    gpuAllocationsUnknownFormat: ledger?.unknownFormats ?? null,
    gpuFrameTargetBytes: gpu.targetBytes + (gpu.effects?.bytes ?? 0) || null,
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
    shadowRenderPasses: lights.shadowRenderPasses,
    shadowLightCuts: lights.lightRuns,
    shadowPagesRequested: lights.plan.requests.counts.requested,
    shadowPagesCached: lights.plan.counts.cachedPages,
    shadowPoolPages: lights.plan.counts.poolPages,
    shadowPoolBytes: poolHeld,
    shadowPoolLayers: lights.shadows?.texture ? lights.plan.pool.layers : null,
    shadowPeakBytes: poolHeld === null ? null : Math.max(lights.memory.peakBytes, poolHeld),
    shadowResolutionBias: lights.memory.bias,
    shadowMemoryEvents: lights.memory.events,
    shadowPagesRefetched: lights.plan.pool.refetched,
    shadowCastersKept: lights.cull?.counts.counts()?.kept ?? null,
    shadowCastersHidden: lights.occlusion?.counts.counts()?.kept ?? null,
    shadowPagesDrawn: lights.shadowPages,
    shadowPagesTotal: lights.shadowPagesTotal,
    shadowPagesPending: lights.plan.counts.pendingPages,
    shadowWaitMs: lights.plan.counts.waitedMs,
    ...shadowWorkMetrics(lights),
    ...lightCutMetrics(rt),
    ...directLightTimings(timing.lastGpuPassMs),
    ...shadowCpuMetrics(timing.cpuProfile.row),
    ...lights.tiles?.poolMetrics(),
  };
}

/** Releases every GPU resource and the scene; the trace queue is drained before the promise settles. */
export function disposeWebgpuPages(rt: WebgpuPagesRuntime) {
  const { gpu, capture, timing, blendState, services } = rt,
    { scene, pagedBlendCopies } = rt.setup;
  // Disposed, it presents nothing any more: the same withdrawal as a loss, surface included.
  markWebgpuLost(rt);
  // The main view's resources are released below; a capture under way releases its own view.
  for (const view of rt.views.persistent.splice(0)) releaseWebgpuView(rt, view);
  useWebgpuView(rt, rt.views.main);
  rt.run.gate.release();
  services.residency.quietPending();
  timing.gpuTiming?.dispose();
  rt.vis.wholeDeformation?.table.destroy();
  rt.vis.wholeDeformation = undefined;
  rt.vis.deformationCompute?.dispose();
  rt.vis.deformationCompute = undefined;
  dropGpuSelection(rt);
  dropVis(rt);
  releaseTargets(rt);
  for (const buffer of gpu.positionBuffers.values()) buffer.destroy();
  dropBlendBuffers(gpu);
  gpu.vertexBytes = 0;
  blendState.compaction?.dispose();
  blendState.compaction = undefined;
  blendState.table = undefined;
  blendState.blendGpu.length = 0;
  blendState.cpuSelectedPlacements.clear();
  blendState.dirtySpans.clear();
  pagedBlendCopies.clear();
  blendState.visibleBlend.length = 0;
  disposeBlendResources(blendState);
  gpu.uniformBuffer?.destroy();
  gpu.uniformBuffer = undefined;
  gpu.volumeBuffer?.destroy();
  gpu.volumeBuffer = undefined;
  capture.surfaceCapture?.dispose();
  gpu.deferred?.dispose();
  gpu.temporal?.dispose();
  gpu.temporal = undefined;
  gpu.effects?.dispose();
  gpu.effects = undefined;
  gpu.guides?.dispose();
  gpu.guides = undefined;
  gpu.particles?.dispose();
  gpu.particles = undefined;
  rt.lights.tiles?.dispose();
  rt.lights.shadows?.dispose();
  rt.lights.pageRequests?.dispose();
  rt.lights.pageRequests = undefined;
  disposeStaticLayer(rt.lights);
  rt.lights.mobilityRows?.destroy();
  rt.lights.mobilityRows = undefined;
  rt.bounce.probes?.dispose();
  rt.bounce.probes = undefined;
  rt.sunFar.gpu?.dispose();
  rt.sunFar.gpu = undefined;
  rt.lights.cull?.dispose();
  rt.lights.movingGroups?.dispose();
  rt.lights.pageQuads = undefined;
  rt.lights.cpuCasters?.source.destroy();
  rt.lights.cpuCasters?.indirect.destroy();
  rt.lights.cpuCasters = undefined;
  rt.lights.lightCut = undefined;
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
