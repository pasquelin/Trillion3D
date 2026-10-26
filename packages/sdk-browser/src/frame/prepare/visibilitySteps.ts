import { createVoxelSteps } from '../../visibility/passes/voxelSteps.ts'
import { createWebgpuBlendPipelines, type BlendedSurface } from '../../blend/pipelines.ts'
import { ensureWebgpuShadeBindings } from '../../gpu/bind/shadeBindings.ts'
import type { createWebgpuVisibilityShaders } from '../../visibility/passes/shaders.ts'
import { createWebgpuVisibilityRasterPipelines } from '../../visibility/passes/pipelines.ts'
import { createWebgpuShadePipelines } from '../../visibility/passes/shadePipelines.ts'
import { voxelWpo } from '../../visibility/shader/wpoSets.ts'
import { createShadeBins } from '../../materials/classes/shadeBins.ts'
import { pageTableBuffer } from '../render/pageTable.ts'
import { PAGE_INFO_STRIDE } from '../../visibility/types.ts'
import { SURFACE_BYTES_PER_PIXEL, SURFACE_FORMATS } from '../../materials/surface/surfaceBuffer.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { isCancelled } from '../../session/engine/common.ts'
import { families } from '../../session/host/families.ts'
import { wantsResponsive } from './responsiveTarget.ts'
import { blendContext } from './contractLight.ts'

type Shaders = Awaited<ReturnType<typeof createWebgpuVisibilityShaders>>
type Variant = WebgpuPagesRuntime['context']['diagnosticGpuVariant']

/** The blend pipelines of `items`, the transmissive stages among them, on `layout` when the
 *  session has one; a refusal is said and builds none. */
export async function buildBlendPipelines(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  items: readonly BlendedSurface[],
  layout?: GPUBindGroupLayout,
) {
  const { vis, diag } = rt
  try {
    return await createWebgpuBlendPipelines(
      gpuDevice,
      items,
      rt.context.diagnosticGpuVariant,
      vis.writesFeedback,
      layout,
      wantsResponsive(rt),
      blendContext(rt),
    )
  } catch (error) {
    diag.diagnosticFailure('forward-material-pipeline-failed', error)
    return undefined
  }
}

/** The blend pipelines; a refusal leaves the blends without a pipeline and says why. */
export async function prepareBlendPipelines(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { vis, blendState } = rt
  const built = await buildBlendPipelines(rt, gpuDevice, blendState.blendGpu)
  vis.blendBindGroupLayout = built?.blendBindGroupLayout
  vis.blendPipelines = built?.blendPipelines
}

/** The visibility raster's pipelines, refused by name. */
export async function prepareRasterPipelines(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  shaders: Pick<Shaders, 'visModule' | 'visBindGroupLayout'>,
  variant: Variant,
) {
  const { vis } = rt
  const rasterPipelines = await createWebgpuVisibilityRasterPipelines(
    gpuDevice,
    shaders.visModule,
    shaders.visBindGroupLayout,
    variant,
    rt.setup.clipping,
    voxelWpo(vis.rasters),
  ).catch((error: unknown) => {
    if (isCancelled(rt.signal)) throw error
    throw new Error(`WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE: ${String(error)}`)
  })
  ;({
    visPipelineBack: vis.visPipelineBack,
    visPipelineNone: vis.visPipelineNone,
    visPipelineFront: vis.visPipelineFront,
  } = rasterPipelines)
}

/** Each resolve class of the census (`preparePages.ts`), read now that the atlases are laid out,
 *  gets its pipeline, and the image its shading bins; the census is taken again at a frame entry
 *  once what it reads moved (`../loop/framePipelines.ts`). */
export async function prepareShadeClasses(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  shaders: Shaders,
  variant: Variant,
) {
  const { vis, diag } = rt
  const classes = vis.shadeCensus!.keys
  vis.voxelSteps ??= createVoxelSteps(gpuDevice)
  vis.shadeModule = shaders.shadeModule
  vis.shadeBins ??= await createShadeBins(gpuDevice)
  ;({ shadeBindGroupLayout: vis.shadeBindGroupLayout, shadeClasses: vis.shadeClasses } =
    await createWebgpuShadePipelines(
      gpuDevice,
      shaders.shadeModule,
      classes,
      variant,
      vis.writesFeedback,
      undefined,
      vis.writesEmissiveAo,
      () => vis.rasters,
    ))
  diag.engineDiagnostic('material-classes-ready', 'Resolve classes and their pipelines', {
    classes: classes.length,
    keys: classes,
  })
  return classes
}

/** The decoded clusters' table and the shade bindings in place; the visibility pass refused by name without
 *  its texture, its bindings, its classes or its raster. */
export async function bindShade(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  shaders: Shaders,
  classes: Awaited<ReturnType<typeof prepareShadeClasses>>,
) {
  const { vis, diag } = rt
  // The table of decoded clusters, one record until the cut's list sizes it (`../render/visibleTables.ts`):
  // the shade group binds it.
  vis.pageTable ??= pageTableBuffer(gpuDevice, PAGE_INFO_STRIDE)
  ensureWebgpuShadeBindings(rt, gpuDevice)
  const ab = rt.context.feedbackTargetAB === true && (await families.diagnostics.load()) // a view's
  if (ab) await ab.prepareFeedbackAb(rt, gpuDevice, shaders.shadeModule, classes)
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
