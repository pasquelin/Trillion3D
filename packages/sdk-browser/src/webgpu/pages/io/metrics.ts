import { DEFORMATION_PASS } from '../../../deformation/pass.ts'
import { dropGpuSelection, dropVis } from './drops.ts'
import { releaseTargets } from '../prepare/targets.ts'
import { dropBlendBuffers } from '../../blend/buffers.ts'
import { disposeBlendResources } from '../../blend/resources.ts'
import { directLightTimings, passOwnMs } from '../../../stage/mapping.ts'
import { taaSampledRank } from '../../../taa/frame.ts'
import { gpuDeviceLedgerOf } from '../../../gpu/core/deviceLedger.ts'
import { markWebgpuLost } from './lost.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { vsmFrameMetrics } from '../render/vsm/vsmStats.ts'
import { destroyEngineVsm } from '../render/vsm/engineVsm.ts'
import { releaseWebgpuView, useWebgpuView } from '../state/viewSwitch.ts'

/** Geometry bytes: the cached allocation total plus the three concatenated visibility buffers. */
export function vertexBytesOf(
  gpu: Pick<WebgpuPagesRuntime['gpu'], 'vertexBytes'>,
  vis: Pick<WebgpuPagesRuntime['vis'], 'concatPos' | 'concatUv' | 'vertexPool'>,
) {
  const normals = vis.vertexPool?.normalBytes ?? 0 // the pool's normal atlas (#1410)
  return gpu.vertexBytes + (vis.concatPos?.size ?? 0) + (vis.concatUv?.size ?? 0) + normals
}

export function metricsOf(rt: WebgpuPagesRuntime) {
  return Object.assign(frameMetricsOf(rt), vsmFrameMetrics(rt, rt.timing.lastGpuPassMs))
}

function frameMetricsOf(rt: WebgpuPagesRuntime) {
  const { run, gpu, vis, timing, blendState, services, lights } = rt,
    { geometryPool } = rt.setup
  const stats = gpu.cache?.stats()
  const vertexBytes = vertexBytesOf(gpu, vis)
  const ledger = gpuDeviceLedgerOf(gpu.device)?.snapshot()
  const pending = run.gpuFrameActive && !run.gpuMetricsReady
  const deformation = timing.lastGpuPassMs?.passes.find((pass) => pass.name === DEFORMATION_PASS)
  // What the occlusion test dropped, from the path that ran it: the GPU's last sampled counts, or
  // the CPU oracle's where no GPU test runs; `null` when neither counted, never an unmeasured 0.
  const gpuHizCounts = vis.gpuPartition?.counts()
  const [hiz, hizCountedFrame] = vis.gpuPartition
    ? [gpuHizCounts, gpuHizCounts?.frame ?? null]
    : run.cpuHizCounted
      ? [run.cpuHizCounts, run.frame]
      : [undefined, null]
  return {
    coverageReady: services.bootstrapState.ready,
    coverageBudgetLimited: run.coverageBudgetLimited,
    frameHeld: run.frameHeld,
    // The display's cadence, from the clock the render-scale budget reads (`frame/scaleControl.ts`).
    rafIntervalMs: rt.scale.frameIntervalMs,
    displayRefreshMs: rt.scale.refreshMs,
    // The size every pass up to the temporal resolve drew this image at (`drawFrameAt`).
    renderWidth: gpu.targetSize[0],
    renderHeight: gpu.targetSize[1],
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
    gpuDeformationMs: deformation ? passOwnMs(deformation) : null,
    gpuFrameMs: timing.lastGpuFrameMs,
    gpuHostGapMs: timing.lastGpuHostGapMs,
    gpuIdleMs: timing.lastGpuIdleMs,
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
    ...directLightTimings(timing.lastGpuPassMs),
    ...lights.tiles?.poolMetrics(),
  }
}

/** Releases every GPU resource and the scene; the trace queue is drained before the promise settles. */
export function disposeWebgpuPages(rt: WebgpuPagesRuntime) {
  const { gpu, capture, timing, blendState, services } = rt,
    { scene, pagedBlendCopies } = rt.setup
  // Disposed, it presents nothing any more: the same withdrawal as a loss, surface included.
  markWebgpuLost(rt)
  // The main view's resources are released below; a capture under way releases its own view.
  for (const view of rt.views.persistent.splice(0)) releaseWebgpuView(rt, view)
  useWebgpuView(rt, rt.views.main)
  rt.run.gate.release()
  services.residency.quietPending()
  timing.gpuTiming?.dispose()
  rt.vis.wholeDeformation?.table.destroy()
  rt.vis.wholeDeformation = undefined
  rt.vis.deformationCompute?.dispose()
  rt.vis.deformationCompute = undefined
  dropGpuSelection(rt)
  dropVis(rt)
  releaseTargets(rt)
  for (const buffer of gpu.positionBuffers.values()) buffer.destroy()
  dropBlendBuffers(gpu)
  gpu.vertexBytes = 0
  blendState.compaction?.dispose()
  blendState.compaction = undefined
  blendState.table = undefined
  blendState.blendGpu.length = 0
  blendState.cpuSelectedPlacements.clear()
  blendState.dirtySpans.clear()
  pagedBlendCopies.clear()
  blendState.visibleBlend.length = 0
  disposeBlendResources(blendState)
  gpu.uniformBuffer?.destroy()
  gpu.uniformBuffer = undefined
  gpu.volumeBuffer?.destroy()
  gpu.volumeBuffer = undefined
  capture.surfaceCapture?.dispose()
  gpu.deferred?.dispose()
  gpu.temporal?.dispose()
  gpu.temporal = undefined
  gpu.effects?.dispose()
  gpu.effects = undefined
  gpu.guides?.dispose()
  gpu.guides = undefined
  gpu.particles?.dispose()
  gpu.particles = undefined
  gpu.impostors?.pass.dispose()
  gpu.impostors = undefined
  rt.lights.tiles?.dispose()
  if (rt.lights.vsm) destroyEngineVsm(rt.lights.vsm)
  rt.lights.vsm = undefined
  rt.lights.mobilityRows?.destroy()
  rt.lights.rowLods?.buffer.destroy()
  rt.lights.mobilityRows = rt.lights.rowLods = undefined
  rt.bounce.probes?.dispose()
  rt.bounce.probes = undefined
  rt.lights.spheres?.buffer.destroy()
  rt.lights.spheres?.local?.destroy()
  rt.lights.spheres = undefined
  rt.lights.buffer?.destroy()
  gpu.synchronousCapture?.dispose()
  const closing = gpu.cache?.dispose()
  gpu.cache = undefined
  scene.clear()
  rt.diag.drainTraceNow()
  return Promise.resolve(closing).then(() => {})
}
