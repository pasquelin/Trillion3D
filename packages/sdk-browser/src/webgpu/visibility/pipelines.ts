import { depthLayerUnits } from '../../../../sdk-core/src/lod/depthLayer.ts'
import { DEPTH_COMPARE } from '../../camera/depthConvention.ts'
import { validationScope } from '../../gpu/core/errorScope.ts'
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts'
import { variesVisibility, visVariantFragment } from '../../diagnostic/gpuGeometry.ts'
import { VIS_UNMASKED } from '../../visibility/shader/visWgsl.ts'
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts'
import { DEPTH_FORMAT } from '../../scene/targetFormats.ts'

/** A slot's face modes, in its bins' order (`CULL_BINS`): a mirrored placement draws in the bin
 *  of the side it shows (`visBin`), so no clockwise pipeline is made. */
const LAYER_CULLS: Array<[GPUCullMode, GPUFrontFace]> = [
  ['back', 'ccw'],
  ['none', 'ccw'],
  ['front', 'ccw'],
]
/** A coplanar layer's pipeline of face mode `cull`, in `visLayerPipelines`. */
export const visLayerPipelineIndex = (layer: number, cull: number) =>
  (layer - 1) * LAYER_CULLS.length + cull
/** `run` under a validation scope; its pipelines compile off the thread, together. */
export async function scoped<T>(device: GPUDevice, run: () => Promise<T>): Promise<T> {
  const { value, error } = await validationScope(device, run)
  if (error) throw error
  return value
}
/** The visibility raster's targets: the identifiers, and the pyramid's level 0 (#1483: Hi-Z is the
 *  one occlusion path). Every raster drawing into the visibility pass — clusters and impostor
 *  cards — uses these. */
export const VIS_TARGETS: GPUColorTargetState[] = [{ format: 'r32uint' }, { format: 'r32float' }]
/** The visibility raster's depth: written, tested as every opaque raster. */
export const VIS_DEPTH: GPUDepthStencilState = {
  format: DEPTH_FORMAT,
  depthWriteEnabled: true,
  depthCompare: DEPTH_COMPARE,
}

/**
 * Each occluder pipeline's twin for a draw that holds no cutout row: the same states, the same
 * vertex stage and fragment stage, its mask test compiled out (`VIS_UNMASKED`): it neither reads
 * the page nor discards. Keyed by the pipeline itself, a twin follows its pipeline wherever it is replaced or
 * dropped. None under a diagnostic variant of the raster stage, which imposes its one stage on
 * every draw.
 */
const opaqueTwins = new WeakMap<GPURenderPipeline, GPURenderPipeline>()
export const opaqueTwin = (pipeline: GPURenderPipeline) => opaqueTwins.get(pipeline)

/** What every visibility pipeline of one build shares. */
type VisBuild = {
  device: GPUDevice
  layout: GPUPipelineLayout
  module: GPUShaderModule
  fragment: string
  twins: boolean
}
function visBuild(
  device: GPUDevice,
  module: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  variant?: DiagnosticGpuVariant,
): VisBuild {
  const twins = !variesVisibility(variant)
  return {
    ...{ device, module },
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    fragment: visVariantFragment(variant),
    twins,
  }
}
/** The pipeline of a face mode, both halves', and its twin. */
async function visPipeline(
  build: VisBuild,
  [cullMode, frontFace]: [GPUCullMode, GPUFrontFace],
  depthStencil = VIS_DEPTH,
) {
  const { device, layout, module } = build
  const descriptor = (constants?: Record<string, number>): GPURenderPipelineDescriptor => ({
    layout,
    vertex: { module, entryPoint: 'vis_vs' },
    fragment: {
      module,
      entryPoint: build.fragment,
      targets: VIS_TARGETS,
      ...(constants && { constants }),
    },
    primitive: { topology: 'triangle-list', cullMode, frontFace },
    depthStencil,
  })
  const [pipeline, twin] = await Promise.all([
    buildRenderPipeline(device, descriptor()),
    build.twins && buildRenderPipeline(device, descriptor(VIS_UNMASKED)),
  ])
  if (twin) opaqueTwins.set(pipeline, twin)
  return pipeline
}

/** Layer 0's pipelines: one per face mode, for both halves. */
export function createWebgpuVisibilityRasterPipelines(
  device: GPUDevice,
  visModule: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  variant?: DiagnosticGpuVariant,
) {
  const build = visBuild(device, visModule, bindGroupLayout, variant)
  return scoped(device, async () => {
    const [back, none, front] = await Promise.all(
      LAYER_CULLS.map((cull) => visPipeline(build, cull)),
    )
    return { visPipelineBack: back, visPipelineNone: none, visPipelineFront: front }
  })
}
/**
 * Pipelines of the coplanar layers above 0. A layer is only an integer depth bias on the same
 * pipeline: same module, same state, same draw order. Targets and inputs follow those layer 0 kept,
 * so both passes write the same attachments. `layerSlots` of 1 creates nothing.
 */
export function createWebgpuCoplanarLayerPipelines(
  device: GPUDevice,
  visModule: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  layerSlots: number,
  variant?: DiagnosticGpuVariant,
) {
  const build = visBuild(device, visModule, bindGroupLayout, variant)
  return scoped(device, () => {
    const pipelines: Promise<GPURenderPipeline>[] = []
    for (let layer = 1; layer < layerSlots; layer++)
      for (const cull of LAYER_CULLS)
        // Reversed depth: moving closer to the eye ADDS units.
        pipelines.push(
          visPipeline(build, cull, { ...VIS_DEPTH, depthBias: depthLayerUnits(layer) }),
        )
    return Promise.all(pipelines)
  })
}
