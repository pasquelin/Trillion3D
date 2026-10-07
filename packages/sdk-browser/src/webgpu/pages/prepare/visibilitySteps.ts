import { createWebgpuBlendPipelines } from '../../blend/pipelines.ts'
import { ensureWebgpuShadeBindings } from '../../core/shadeBindings.ts'
import type { createWebgpuVisibilityShaders } from '../../visibility/shaders.ts'
import {
  createWebgpuCoplanarLayerPipelines,
  createWebgpuVisibilityRasterPipelines,
} from '../../visibility/pipelines.ts'
import { createWebgpuShadePipelines } from '../../visibility/shadePipelines.ts'
import { createShadeCache } from '../../visibility/shadeCache.ts'
import { depthLayerUnits } from '../../../../../sdk-core/src/index.ts'
import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts'
import { SURFACE_BYTES_PER_PIXEL, SURFACE_FORMATS } from '../../../scene/surfaceBuffer.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { isCancelled } from '../../../engine/common.ts'
import { families } from '../../../host/families.ts'
import { blendWritesShare } from './asIsShareTarget.ts'
import { blendContext } from './contractLight.ts'

type Shaders = Awaited<ReturnType<typeof createWebgpuVisibilityShaders>>
type Variant = WebgpuPagesRuntime['context']['diagnosticGpuVariant']

/** The blend pipelines; a refusal leaves the blends without a pipeline and says why. */
export async function prepareBlendPipelines(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { vis, diag, blendState } = rt
  try {
    const built = await createWebgpuBlendPipelines(
      gpuDevice,
      blendState.blendGpu,
      rt.context.diagnosticGpuVariant,
      vis.writesFeedback,
      undefined,
      blendWritesShare(rt),
      blendContext(rt),
    )
    vis.blendBindGroupLayout = built.blendBindGroupLayout
    vis.blendPipelines = built.blendPipelines
    blendState.water = built.water
    // A refused water pass leaves blends in place and reports the reason.
    if (built.waterRefused) diag.diagnosticFailure('water-pass-refused', built.waterRefused)
  } catch (error) {
    diag.diagnosticFailure('forward-material-pipeline-failed', error)
    vis.blendBindGroupLayout = undefined
    vis.blendPipelines = undefined
    blendState.water = undefined
  }
}

/** The visibility raster's pipelines, refused by name. */
export async function prepareRasterPipelines(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  shaders: Shaders,
  variant: Variant,
) {
  const { vis } = rt
  const rasterPipelines = await createWebgpuVisibilityRasterPipelines(
    gpuDevice,
    shaders.visModule,
    shaders.visBindGroupLayout,
    variant,
  ).catch((error: unknown) => {
    if (isCancelled(rt.signal)) throw error
    throw new Error(`WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE: ${String(error)}`)
  })
  ;({
    visPipelineBack: vis.visPipelineBack,
    visPipelineNone: vis.visPipelineNone,
    visPipelineFront: vis.visPipelineFront,
    visHizRestBack: vis.visHizRestBack,
    visHizRestNone: vis.visHizRestNone,
    visHizRestFront: vis.visHizRestFront,
  } = rasterPipelines)
}

/** The coplanar layers' pipelines, when the scene carries layers; a refusal draws one layer. */
export async function prepareLayerPipelines(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  shaders: Shaders,
  variant: Variant,
) {
  const { vis, diag } = rt
  vis.visLayerPipelines.length = 0
  if (vis.drawLayerSlots <= 1) return
  try {
    vis.visLayerPipelines = await createWebgpuCoplanarLayerPipelines(
      gpuDevice,
      shaders.visModule,
      shaders.visBindGroupLayout,
      vis.drawLayerSlots,
      variant,
    )
    diag.engineDiagnostic('coplanar-layers-ready', 'Coplanar layers ready', {
      layers: vis.drawLayerSlots - 1,
      pipelines: vis.visLayerPipelines.length,
      biasUnitsPerLayer: depthLayerUnits(1),
    })
  } catch (error) {
    diag.diagnosticFailure('coplanar-layer-pipelines-failed', error)
    vis.visLayerPipelines = []
    vis.drawLayerSlots = 1
  }
}

/** Each resolve class of the census (`preparePages.ts`), read now that the atlases are laid out,
 *  gets its pipeline, plus a direct single-class path; the census is taken again at a frame entry
 *  once what it reads moved (`../../frame/framePipelines.ts`). */
export async function prepareShadeClasses(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  shaders: Shaders,
  variant: Variant,
) {
  const { vis, diag } = rt
  const classes = vis.shadeCensus!.keys
  // The frame's cache first: its passes decide what the class pipelines read of it.
  vis.shadeCache ??= await createShadeCache(gpuDevice)
  ;({
    shadeBindGroupLayout: vis.shadeBindGroupLayout,
    shadeClasses: vis.shadeClasses,
    materialTiles: vis.materialTiles,
  } = await createWebgpuShadePipelines(
    gpuDevice,
    shaders.shadeModule,
    classes,
    variant,
    vis.writesFeedback,
    undefined,
    vis.writesEmissiveAo,
    vis.shadeCache.constants,
  ))
  diag.engineDiagnostic('material-classes-ready', 'Resolve classes and their pipelines', {
    classes: classes.length,
    keys: classes,
  })
  return classes
}

/** The page table and the shade bindings in place; the visibility pass refused by name without
 *  its texture, its bindings, its classes or its raster. */
export async function bindShade(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  shaders: Shaders,
  classes: Awaited<ReturnType<typeof prepareShadeClasses>>,
) {
  const { vis, diag } = rt
  if (!vis.pageTable)
    vis.pageTable = gpuDevice.createBuffer({
      size: PAGE_INFO_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  ensureWebgpuShadeBindings(rt, gpuDevice)
  const ab = shaders.shadeWithoutFeedback && (await families.diagnostics.load()) // a view's
  if (ab) await ab.prepareFeedbackAb(rt, gpuDevice, shaders.shadeWithoutFeedback!, classes)
  // The engine draws through the visibility pass alone (#1483): without it nothing draws.
  if (!vis.visTexture || !vis.shadeBindGroup || !vis.shadeClasses || !vis.visPipelineBack)
    throw new Error('WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE')
  diag.engineDiagnostic('material-surfaces-ready', 'Surfaces and lighting split', {
    surfaceVersion: 1,
    formats: SURFACE_FORMATS,
    bytesPerPixel: SURFACE_BYTES_PER_PIXEL,
    lighting: 'HDR',
    globalIllumination: false,
    motionVectors: false,
  })
}
