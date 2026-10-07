import { loadUnpaged } from '../../core/positions.ts'
import { prepareDeformationGeometry } from '../../../deformation/prepare.ts'
import { prepareWebgpuBlend } from '../../blend/prepare.ts'
import { createTransparentTable } from '../../transparent/table.ts'
import { prepareBlendResources } from '../../blend/resources.ts'
import { createTransparentCompaction } from '../../transparent/compact.ts'
import { VOLUME_WORDS, createVolumeBuffer } from '../../transparent/transmission.ts'
import { prepareGpuCut } from './cut.ts'
import { grantFrameTargets } from './targetGrant.ts'
import { throwIfStopped } from '../io/lost.ts'
import { prepareWebgpuTextures, takeMaterialTextures } from './textures.ts'
import { wantsFeedback } from './feedbackVariant.ts'
import { wantsEmissiveAo } from './emissiveAoLayer.ts'
import { prepareWebgpuVisibility } from './visibility.ts'
import { prepareDirectLights, prepareShadowPipelines } from './lights.ts'
import { grantWebgpuPagesCache } from './cache.ts'
import { type WebgpuPagesRuntime } from '../runtime.ts'
import type { loadImpostorCode } from '../../../impostor/code.ts'
import { pipelinesSettled } from '../../../lighting/deferred/compileLedger.ts'
import { askFramePipelines } from '../../frame/framePipelines.ts'
import { createShadeCensus } from '../../visibility/shadeCensus.ts'

/** A step of prepare: refused once the backend closed or the device was lost
 *  (`preparePages.ts`). */
export type PrepareStep = <T>(name: string, work: () => Promise<T>) => Promise<T>

/** The vertices no quantized page covers, the transparent table and its compaction. */
export async function prepareGeometryAndBlend(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  step: PrepareStep,
) {
  const { gpu, diag, blendState } = rt,
    { allPages, blendCopies, scene } = rt.setup,
    { packedPages, selectionRoots, rows } = rt.layout
  // Only a cluster no quantized page covers reads its primitive's vertices, from the float vertex
  // pool (`../../core/geometryPool.ts`): they are loaded, and rank sync starts over from them.
  await loadUnpaged(allPages, blendCopies)
  rows.rowsRevision++
  // 16 bytes: it also stands in for the cluster spans (`array<vec4u>`) of a scene without them.
  gpu.zeroUv = gpuDevice.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  gpuDevice.queue.writeBuffer(gpu.zeroUv, 0, new Float32Array([0, 0, 0, 0]))
  blendState.transmissive = prepareWebgpuBlend(gpuDevice, blendCopies, gpu, blendState, scene)
  blendState.volumePacked = new Float32Array(blendState.transmissive * VOLUME_WORDS)
  gpu.volumeBuffer = createVolumeBuffer(gpuDevice, blendState.transmissive)
  // The transparent draw order is the scene's, settled here once: an image only picks survivors.
  const table = createTransparentTable(selectionRoots, packedPages, blendState.blendGpu)
  blendState.table = table
  for (let i = 0; i < blendState.table.pagedItems.length; i++)
    blendState.table.pagedItems[i].pagedIndex = i
  blendState.compaction = await step('transparent compaction', () =>
    createTransparentCompaction(gpuDevice, table),
  )
  // Transparent clusters are compacted on the GPU alone, from the GPU cut's mask (#1483).
  if (table.length && !blendState.compaction?.encode)
    throw new Error('WEBGPU_TRANSPARENT_COMPACTION_UNAVAILABLE')
  diag.engineDiagnostic('transparent-clusters', 'Transparent cluster table', {
    version: 1,
    items: blendState.table.pagedItems.length,
    clusters: blendState.table.length,
    maxVertexWords: blendState.table.maxVertexWords,
    gpuCompaction: !!blendState.compaction?.encode,
    transmissiveMeshes: blendState.transmissive,
  })
}

/** The deformation geometry, the cards, the cache, the targets and the material programs: a
 *  material step refused fails the image, said once. */
export async function prepareMaterials(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  step: PrepareStep,
  started: { impostorCode: ReturnType<typeof loadImpostorCode>; reflectionMips: Promise<unknown> },
) {
  const { gpu, vis, diag, blendState } = rt,
    { allPages } = rt.setup
  throwIfStopped(rt)
  // A geometry the device refuses fails the image, told with the material steps below.
  const geometryFailure = await prepareDeformationGeometry(rt, gpuDevice).then(
    () => undefined,
    (error: unknown) => ({ error }),
  )
  // Card pipelines the device refuses are told once: no code then, every root keeps its clusters.
  const cards = await started.impostorCode
  gpu.impostorCode = (await cards?.prepareImpostorPipelines(gpuDevice, diag.diagnosticFailure))
    ? cards
    : undefined
  await grantWebgpuPagesCache(rt, gpuDevice)
  // The textures the scene wears, counted before its targets: one that wears none makes no feedback
  // target, and its pipelines write none (`feedbackVariant.ts`).
  const census = takeMaterialTextures(rt)
  vis.writesFeedback = wantsFeedback(rt)
  // Nor an emission-and-occlusion layer for a scene none of whose surfaces emits or occludes: the
  // census of the surfaces its opaque pages wear, on their geometry, says (`shadeCensus.ts`).
  vis.shadeCensus = createShadeCensus(allPages, vis.geometryBlocks, vis)
  vis.writesEmissiveAo = wantsEmissiveAo(rt)
  await started.reflectionMips
  await grantFrameTargets(rt, gpuDevice)
  // A refused deformation import is a geometry failure, told below: no compute without its code.
  const deformationCode = vis.deformationCode
  vis.deformationCompute =
    deformationCode && (allPages.some((page) => page.deformationOutput) || !!vis.wholeDeformation)
      ? await deformationCode.createDeformationCompute(gpuDevice)
      : undefined
  try {
    if (geometryFailure) throw geometryFailure.error
    await step('textures', () => prepareWebgpuTextures(rt, gpuDevice, census))
    await step('blend resources', () => prepareBlendResources(rt, gpuDevice))
    await step('visibility programs', () => prepareWebgpuVisibility(rt, gpuDevice))
  } catch (error) {
    throwIfStopped(rt) // A close or a loss is no material failure.
    diag.diagnosticFailure('material-pipeline-failed', error)
    throw error
  }
  if (blendState.blendGpu.length && !vis.blendPipelines)
    throw new Error('WEBGPU_BLEND_PIPELINE_UNAVAILABLE')
}

/** The frame's pipelines asked, the lights, the cut, the cover, then every compile settled. */
export async function finishPreparation(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  step: PrepareStep,
) {
  const { gpu, run, context, diag, capabilities, services } = rt
  // What the first frame binds, asked as a frame entry asks it (`askFramePipelines`): compiled
  // beside the steps below, awaited at the end.
  askFramePipelines(rt)
  await step('direct lights', () => prepareDirectLights(rt, gpuDevice))
  await step('shadow pipelines', () => prepareShadowPipelines(rt, gpuDevice))
  await prepareGpuCut(rt, gpuDevice, step)
  await step('coverage bootstrap', () => services.bootstrapState.ensure())
  // Last, the lit program of the first step; one that failed is said, and lets the unlit view by.
  await gpu.deferred?.litReady
  // And every compile the steps above started or asked: no first frame compiles one, nor is held.
  await pipelinesSettled(gpuDevice)
  diag.engineDiagnostic('render-capabilities', 'Render paths ready', {
    surfaceVersion: gpu.surfaces?.version ?? null,
    deferredLighting: !!gpu.deferred,
    directLightTiles: !!rt.lights.tiles,
    shadowRaster: !!rt.lights.pageLayout,
    shadowUnavailable: rt.lights.shadowReason,
    bounceProxy: !!context.readSceneProxy,
    bounceWanted: rt.bounce.wanted,
    imageReadbackDuringRender: false,
    gpuSelection: !!run.gpuSelection,
    temporalAntialiasing: !!gpu.temporal,
    // No vector target is rasterised: the temporal pass derives them from the visibility buffer and
    // the placement's previous pose.
    motionVectors: gpu.temporal ? 'derived' : false,
    unsupported: [...capabilities.unsupported],
  })
}
