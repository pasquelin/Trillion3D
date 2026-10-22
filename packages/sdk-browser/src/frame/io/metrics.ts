import { DEFORMATION_PASS } from '../../deformation/pass.ts'
import { disposeRowWords } from '../../placement/rows/rowWordsGpu.ts'
import { disposeRootWorlds } from '../../placement/roots/rootWorlds.ts'
import { disposeRootBoxes } from '../../placement/roots/rootBoxes.ts'
import { disposeTreeLeaves } from '../../placement/tree/treeLeaves.ts'
import { disposeVis, dropGpuSelection } from './drops.ts'
import { releaseTargets } from '../prepare/targets.ts'
import { disposeBlendResources } from '../../blend/resources.ts'
import { directLightTimings, passOwnMs } from '../../diagnostic/stage/mapping.ts'
import { gpuDeviceLedgerOf } from '../../gpu/core/deviceLedger.ts'
import { markWebgpuLost } from './lost.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { vsmFrameMetrics } from '../../lighting/shadows/vsm/frame/vsmStats.ts'
import { destroyEngineVsm } from '../../lighting/shadows/vsm/frame/engineVsm.ts'
import { releaseWebgpuView, useWebgpuView } from '../backend/state/viewSwitch.ts'
import { transparentCounts } from '../backend/state/transparentCounts.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { bounceState } from '../backend/state/bounce.ts'
import { viewTargetBytes } from '../backend/state/gpu.ts'
import { disposeFogVolume } from '../render/encodeFogVolume.ts'
import { disposeDistanceFields } from '../../lighting/distanceField/frame.ts'
import { disposeVolumetricLightmap } from '../../lighting/volumetricLightmap/frame.ts'
import { disposeLightShafts } from '../../modules/sky/lightShafts/frame.ts'
import { disposeCloudView } from '../../modules/sky/clouds/viewTargets.ts'
import { disposeSkyModule } from '../render/encodeCloudsSky.ts'
import { releaseUnlitLights } from '../render/captureLights.ts'

/** Geometry bytes beside the page pool: the float pool's three lists. */
export function vertexBytesOf(
  vis: Pick<WebgpuPagesRuntime['vis'], 'concatPos' | 'concatUv' | 'vertexPool'>,
) {
  const normals = vis.vertexPool?.normalBytes ?? 0 // the pool's normal atlas
  return (vis.concatPos?.size ?? 0) + (vis.concatUv?.size ?? 0) + normals
}

export function metricsOf(rt: WebgpuPagesRuntime) {
  return Object.assign(frameMetricsOf(rt), vsmFrameMetrics(rt, rt.timing.lastGpuPassMs))
}

/** The geometry pool's size, slots and pressure, and the texture pool's clamp. */
function poolMetricsOf(rt: WebgpuPagesRuntime) {
  const { geometryPool, texturePools } = rt.setup
  return {
    geometryPoolBytes: geometryPool.budgetBytes,
    geometryPoolSlots: geometryPool.slots,
    geometryPoolAllocatedBytes: geometryPool.allocatedBytes,
    geometryPoolClamp: geometryPool.clamp,
    geometryPoolSaturated: Math.max(0, rt.services.residencySets.keepCount - geometryPool.slots),
    texturePoolClamp: texturePools?.pool.clamp ?? null,
  }
}

/** What the device's ledger counts: the bytes allocated, in all and by label, the allocations of a
 *  format it does not know, and the view targets' bytes. */
function ledgerMetricsOf(gpu: WebgpuPagesRuntime['gpu']) {
  const ledger = gpuDeviceLedgerOf(gpu.device)?.snapshot()
  return {
    gpuAllocatedBytes: ledger?.bytes ?? null,
    gpuAllocatedByLabel: ledger?.byLabel ?? null,
    gpuAllocationsUnknownFormat: ledger?.unknownFormats ?? null,
    gpuFrameTargetBytes: viewTargetBytes(gpu) || null,
  }
}

function frameMetricsOf(rt: WebgpuPagesRuntime) {
  const { run, gpu, vis, timing, services, lights } = rt
  const stats = gpu.cache?.stats()
  const vertexBytes = vertexBytesOf(vis)
  const pending = !run.gpuMetricsReady
  const blend = transparentCounts(rt)
  const deformation = timing.lastGpuPassMs?.passes.find((pass) => pass.name === DEFORMATION_PASS)
  // The voxel trace's steps: the GPU's last sampled counts; `null` when it counted nothing, never
  // an unmeasured 0.
  const steps = vis.voxelSteps?.stats()
  return {
    coverageReady: services.bootstrapState.ready,
    coverageBudgetLimited: run.coverageBudgetLimited,
    frameHeld: run.frameHeld,
    // The display's cadence, from the clock the render-scale budget reads (`frame/scale/scaleControl.ts`).
    rafIntervalMs: rt.views.main.scale.frameIntervalMs,
    displayRefreshMs: rt.views.main.scale.refreshMs,
    // The size every pass up to the temporal resolve drew this image at (`drawFrameAt`).
    renderWidth: gpu.targetSize[0],
    renderHeight: gpu.targetSize[1],
    clusters: pending ? null : run.visible,
    selectedTriangles: run.selectedTriangles,
    uncoveredTriangles: null,
    // The cut's drawn list is taken after both its occlusion passes: what it selected is drawn.
    drawnTriangles: run.selectedTriangles,
    residentPages: stats?.residentPages ?? 0,
    cacheEvictions: stats?.evictions ?? 0,
    geometryAllocationBytes: (stats?.allocatedBytes ?? 0) + vertexBytes,
    frustumRejected: run.frustumRejected,
    occluded: run.occluded,
    postHidden: run.postHidden,
    lodLevel: run.lodLevel,
    submittedTriangles: pending ? null : run.submittedTriangles,
    totalSubmittedTriangles: pending ? null : run.submittedTriangles,
    transparentMeshes: blend.visibleMeshes,
    transparentFrustumRejected: blend.frustumRejected,
    transparentDrawCalls: blend.drawCalls,
    transparentSubmittedTriangles: blend.submittedTriangles,
    ...(vis.textures?.metrics() ?? {}),
    cpuSubmitMs: timing.lastSubmitMs,
    gpuPassMs: timing.lastGpuPassMs,
    gpuDeformationMs: deformation ? passOwnMs(deformation) : null,
    gpuFrameMs: timing.lastGpuFrameMs,
    gpuHostGapMs: timing.lastGpuHostGapMs,
    gpuIdleMs: timing.lastGpuIdleMs,
    gpuDeviceLost: run.lostCause ?? null,
    vramBytes: null,
    ...ledgerMetricsOf(gpu),
    ...poolMetricsOf(rt),
    drawCalls: run.gpuDrawCalls,
    voxelStepsMean: steps?.mean ?? null,
    voxelStepsMax: steps?.max ?? null,
    lightsActive: lights.lightsActive,
    bounce: bounceState(rt.bounce),
    reflections: gpu.reflection?.census.metrics() ?? null,
    ...directLightTimings(timing.lastGpuPassMs),
    ...lights.tiles?.poolMetrics(),
  }
}

/** The passes that make the image after the lighting resolve, released: the deferred resolve, the
 *  temporal pass, the velocity stage, the exposure, the finishing, the effects, the guides, the
 *  particles, the frame difference and the atmosphere. */
function disposeImagePasses(gpu: WebgpuPagesRuntime['gpu']) {
  gpu.deferred?.dispose()
  gpu.temporal?.dispose()
  gpu.temporal = undefined
  gpu.velocity?.dispose()
  gpu.velocity = undefined
  gpu.exposure?.dispose()
  gpu.exposure = undefined
  gpu.finish?.dispose()
  gpu.finish = undefined
  gpu.effects?.dispose()
  gpu.effects = undefined
  gpu.screenProbes?.dispose()
  gpu.screenProbes = undefined
  gpu.ambientOcclusion?.dispose()
  gpu.ambientOcclusion = undefined
  gpu.guides?.dispose()
  gpu.guides = undefined
  gpu.particles?.dispose()
  gpu.particles = undefined
  gpu.frameDifference?.dispose()
  gpu.frameDifference = undefined
  gpu.atmosphere?.dispose()
  gpu.atmosphere = undefined
  disposeFogVolume(gpu)
  disposeLightShafts(gpu)
  disposeCloudView(gpu)
}

/** Releases every GPU resource and the scene; the trace queue is drained before the promise settles. */
export function disposeWebgpuPages(rt: WebgpuPagesRuntime) {
  const { gpu, capture, timing, blendState, services } = rt,
    { scene, pagedBlendCopies } = rt.setup,
    device = gpu.device
  // Disposed, it presents nothing any more: the same withdrawal as a loss, surface included.
  markWebgpuLost(rt)
  // The main view's resources are released below; a capture under way releases its own view.
  for (const view of rt.views.persistent.splice(0)) releaseWebgpuView(rt, view)
  useWebgpuView(rt, rt.views.main)
  rt.run.gate.release()
  services.residency.quietPending()
  rt.rays?.dispose()
  rt.rays = undefined
  disposeDistanceFields(rt)
  disposeVolumetricLightmap(rt)
  timing.gpuTiming?.dispose()
  rt.vis.pooledDeformation?.table.destroy()
  rt.vis.pooledDeformation = undefined
  rt.vis.deformationCompute?.dispose()
  rt.vis.deformationCompute = undefined
  dropGpuSelection(rt)
  // A cut a growth made beside the running one, never adopted, goes with it.
  if (rt.growth?.ready && !rt.growth.ready.inPlace) rt.growth.ready.cut.dispose()
  rt.growth = undefined
  disposeVis(rt)
  releaseTargets(rt)
  blendState.compaction?.dispose()
  blendState.compaction = undefined
  blendState.table = undefined
  // Its rows no longer read by a blend item (`PlacementRows.blended`).
  for (const { placement } of blendState.blendGpu) if (placement) delete placement.rows.blended
  blendState.blendGpu.length = 0
  blendState.dirtySpans.clear()
  pagedBlendCopies.clear()
  blendState.visibleBlend.length = 0
  disposeBlendResources(blendState)
  blendState.kernels = undefined
  gpu.zeroUv = undefined
  capture.surfaceCapture?.dispose()
  disposeImagePasses(gpu)
  disposeSkyModule(rt)
  rt.lights.tiles?.dispose()
  if (rt.lights.vsm) destroyEngineVsm(rt.lights.vsm)
  rt.lights.vsm = undefined
  rt.lights.mobilityRows?.destroy()
  rt.lights.rowLods?.buffer.destroy()
  rt.lights.mobilityRows = rt.lights.rowLods = undefined
  rt.bounce.probes?.dispose()
  rt.bounce.probes = undefined
  rt.bounce.screen?.dispose()
  rt.bounce.screen = undefined
  rt.lights.spheres?.buffer.destroy()
  rt.lights.casts?.buffer.destroy()
  rt.lights.casts = undefined
  rt.compose?.gpu?.dispose()
  disposeRowWords(rt)
  disposeRootWorlds(rt)
  disposeRootBoxes(rt)
  disposeTreeLeaves(rt)
  rt.lights.spheres = undefined
  releaseUnlitLights(rt)
  rt.lights.buffer?.destroy()
  const closing = gpu.cache?.dispose()
  gpu.cache = undefined
  scene.clear()
  // The session submits nothing more: what it retired goes now, as after a frame's submit.
  if (device) destroyRetired(device)
  rt.diag.drainTraceNow()
  return Promise.resolve(closing).then(() => {})
}
