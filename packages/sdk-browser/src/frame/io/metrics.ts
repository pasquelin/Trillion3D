import { releaseScreenSpaceTracing } from '../../lighting/screenSpaceTracing/stage.ts'
import { disposeSampledLights } from '../../lighting/manyLightsSampled/frame.ts'
import { disposeSampledVolumes } from '../../lighting/manyLightsSampled/volumeFrame.ts'
import { disposeSampledHair } from '../../lighting/manyLightsSampled/hairFrame.ts'
import { DEFORMATION_PASS } from '../../deformation/pass.ts'
import { releaseLightProfiles } from '../../lighting/lightProfile/frame.ts'
import { releaseAmbientCubemap } from '../../lighting/deferred/ambientCubemapFrame.ts'
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
import { ambientOcclusionMetrics } from '../../lighting/ao/frame.ts'
import { toneTableMetrics } from '../../lighting/toneLut.ts'
import { vsmFrameMetrics } from '../../lighting/shadows/vsm/frame/vsmStats.ts'
import { releaseEngineVsm } from '../../lighting/shadows/vsm/frame/engineVsm.ts'
import { releaseShadowCasters } from '../../lighting/shadows/casters/release.ts'
import { disposeViewPasses, releaseWebgpuView, useWebgpuView } from '../backend/state/viewSwitch.ts'
import type { WebgpuView } from '../backend/state/view.ts'
import { transparentCounts } from '../backend/state/transparentCounts.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { bounceState } from '../backend/state/bounce.ts'
import { viewTargetBytes } from '../backend/state/gpu.ts'
import { releaseIndirectWords } from '../../lighting/bounce/screen/indirectWords.ts'
import { releaseIrradianceField } from '../../lighting/bounce/irradianceField/cache.ts'
import { releaseTranslucencyCache } from '../../lighting/translucencyGi/cache.ts'
import { disposeDistanceFields } from '../../lighting/distanceField/frame.ts'
import { disposeHairStrands } from '../../hair/frame.ts'
import { disposeSurfaceCache, surfaceCacheMetrics } from '../../lighting/surfaceCache/frame.ts'
import { disposeVolumetricLightmap } from '../../lighting/volumetricLightmap/frame.ts'
import { disposeSkyModule } from '../render/encodeCloudsSky.ts'
import { releaseUnlitLights } from '../render/captureLights.ts'
import { disposeSampledDebug } from '../../lighting/manyLightsSampled/debug/frame.ts'
import { disposeSubsurfaceDebug } from '../../lighting/subsurface/visualize.ts'
import { disposeHzbOcclusion } from '../../visibility/hzbOcclusion/hzbOcclusion.ts'

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

/** What the lit image's passes publish of themselves: the reflections', the ambient occlusion's and the tone table's. */
function imagePassMetricsOf(gpu: WebgpuPagesRuntime['gpu']) {
  return {
    reflections: gpu.reflection?.census.metrics() ?? null,
    ambientOcclusion: ambientOcclusionMetrics(gpu.ambientOcclusion) ?? null,
    toneTable: toneTableMetrics(gpu.deferred?.toneLut) ?? null,
  }
}

const isDeformation = (pass: { name: string }) => pass.name === DEFORMATION_PASS

function frameMetricsOf(rt: WebgpuPagesRuntime) {
  const { run, gpu, vis, timing, services, lights } = rt
  const stats = gpu.cache?.stats()
  const vertexBytes = vertexBytesOf(vis)
  const pending = !run.gpuMetricsReady
  const blend = transparentCounts(rt)
  const deformation = timing.lastGpuPassMs?.passes.find(isDeformation)
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
    gpuTimer: timing.gpuTiming?.stats() ?? null,
    tessellationLoss: vis.gpuRaster?.tessellation?.losses.stats() ?? null,
    gpuDeviceLost: run.lostCause ?? null,
    vramBytes: null,
    ...ledgerMetricsOf(gpu),
    ...poolMetricsOf(rt),
    drawCalls: run.gpuDrawCalls,
    voxelStepsMean: steps?.mean ?? null,
    voxelStepsMax: steps?.max ?? null,
    lightsActive: lights.lightsActive,
    bounce: bounceState(rt.bounce),
    surfaceCache: surfaceCacheMetrics(rt),
    ...imagePassMetricsOf(gpu),
    ...directLightTimings(timing.lastGpuPassMs),
    ...lights.tiles?.poolMetrics(),
  }
}

/** The passes that make the image after the lighting resolve, released: the sampled lights, the
 *  screen-space tracing, the deferred resolve, every view's own passes (`disposeViewPasses`), the
 *  guides, the particles, the frame difference and the atmosphere. */
function disposeImagePasses(gpu: WebgpuPagesRuntime['gpu']) {
  if (gpu.device) {
    disposeSampledLights(gpu.device)
    disposeSampledVolumes(gpu.device)
    disposeSampledHair(gpu.device)
  }
  releaseScreenSpaceTracing(gpu)
  gpu.deferred?.dispose()
  disposeViewPasses(gpu)
  gpu.guides?.dispose()
  gpu.guides = undefined
  gpu.particles?.dispose()
  gpu.particles = undefined
  gpu.frameDifference?.dispose()
  gpu.frameDifference = undefined
  gpu.atmosphere?.dispose()
  gpu.atmosphere = undefined
}

/** The cut's resources: rays, fields, deformation, the GPU selection, the visibility and the targets. */
function disposeCut(rt: WebgpuPagesRuntime) {
  const { timing } = rt
  rt.rays?.dispose()
  rt.rays = undefined
  disposeDistanceFields(rt)
  disposeHairStrands(rt)
  disposeSurfaceCache(rt)
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
}

/** The blend state's tables, rows and resources. */
function disposeBlend(rt: WebgpuPagesRuntime) {
  const { blendState } = rt,
    { pagedBlendCopies } = rt.setup
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
}

/** The image passes, the sky, the light tiles and shadows, the bounce, the roots and the light buffer. */
function disposeLighting(rt: WebgpuPagesRuntime) {
  const { gpu } = rt
  disposeImagePasses(gpu)
  disposeSampledDebug(rt)
  disposeSubsurfaceDebug(rt)
  disposeSkyModule(rt)
  rt.lights.tiles?.dispose()
  releaseEngineVsm(rt.lights)
  releaseShadowCasters(rt.lights)
  rt.bounce.probes?.dispose()
  rt.bounce.probes = undefined
  releaseTranslucencyCache(rt.bounce)
  releaseIrradianceField(rt.bounce)
  releaseIndirectWords(gpu)
  rt.bounce.screen?.dispose()
  rt.bounce.screen = undefined
  rt.compose?.gpu?.dispose()
  disposeRootWorlds(rt)
  disposeRootBoxes(rt)
  disposeHzbOcclusion(rt)
  disposeTreeLeaves(rt)
  releaseUnlitLights(rt)
  releaseLightProfiles(rt)
  releaseAmbientCubemap(rt)
  rt.lights.buffer?.destroy()
}

/** Releases the resources of `view` and frees at once what its passes retired (its temporal history, its screen probes): the view's
 *  last image was submitted or read, and no image being encoded names them, so they wait for no later frame's submit — which a page
 *  that draws no more never makes. */
export function releaseViewNow(rt: WebgpuPagesRuntime, view: WebgpuView) {
  releaseWebgpuView(rt, view)
  if (rt.gpu.device) destroyRetired(rt.gpu.device)
}

/** Releases every GPU resource; the trace queue is drained before the promise settles. */
export function disposeWebgpuPages(rt: WebgpuPagesRuntime) {
  const { gpu, capture, services } = rt,
    device = gpu.device
  // Disposed, it presents nothing any more: the same withdrawal as a loss, surface included.
  markWebgpuLost(rt)
  // The main view's resources are released below; a capture under way releases its own view.
  for (const view of rt.views.persistent.splice(0)) releaseViewNow(rt, view)
  useWebgpuView(rt, rt.views.main)
  rt.run.gate.release()
  services.residency.quietPending()
  disposeCut(rt)
  disposeBlend(rt)
  gpu.zeroUv = undefined
  capture.surfaceCapture?.dispose()
  disposeLighting(rt)
  const closing = gpu.cache?.dispose()
  gpu.cache = undefined
  // The session submits nothing more: what it retired goes now, as after a frame's submit.
  if (device) destroyRetired(device)
  rt.diag.drainTraceNow()
  return Promise.resolve(closing).then(() => {})
}
