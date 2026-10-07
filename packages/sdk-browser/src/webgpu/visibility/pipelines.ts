import { depthLayerUnits } from '../../../../sdk-core/src/index.ts'
import { DEPTH_COMPARE } from '../../camera/depthConvention.ts'
import { validationScope } from '../../gpu/core/errorScope.ts'
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts'
import {
  variesVisibility,
  visOpaqueFragment,
  visVariantFragment,
} from '../../diagnostic/gpuGeometry.ts'
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts'

/** A slot's face modes, in its bins' order (`CULL_BINS`): a reflected placement draws in the bin
 *  of the side it shows (`visBin`), so no clockwise pipeline is made. */
const LAYER_CULLS: Array<[GPUCullMode, GPUFrontFace]> = [
  ['back', 'ccw'],
  ['none', 'ccw'],
  ['front', 'ccw'],
]
const VIS_LAYER_CULLS = LAYER_CULLS.length
const VIS_LAYER_PIPELINES = VIS_LAYER_CULLS * 2
export const visLayerPipelineIndex = (layer: number, rest: boolean, cull: number) =>
  (layer - 1) * VIS_LAYER_PIPELINES + (rest ? VIS_LAYER_CULLS : 0) + cull
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
  format: 'depth32float',
  depthWriteEnabled: true,
  depthCompare: DEPTH_COMPARE,
}

/**
 * Each occluder pipeline's twin for a draw that holds no cutout row: the same states, the same
 * vertex stage, the fragment stage `visOpaqueFragment` names, which neither reads the page nor
 * discards. Keyed by the pipeline itself, a twin follows its pipeline wherever it is replaced or
 * dropped. A tested pipeline (`vis_hiz_vs`) has none: the tested half draws with the occluders'
 * once compacted. Nor under a diagnostic variant of the raster stage, which imposes its one stage
 * on every draw.
 */
const opaqueTwins = new WeakMap<GPURenderPipeline, GPURenderPipeline>()
export const opaqueTwin = (pipeline: GPURenderPipeline) => opaqueTwins.get(pipeline)

/** What every visibility pipeline of one build shares. */
type VisBuild = {
  device: GPUDevice
  layout: GPUPipelineLayout
  module: GPUShaderModule
  fragment: string
  opaque: string | undefined
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
    opaque: twins ? visOpaqueFragment() : undefined,
  }
}
/** The occluder (`rest` false) or tested pipeline of a face mode, and an occluder's twin. */
async function visPipeline(
  build: VisBuild,
  rest: boolean,
  [cullMode, frontFace]: [GPUCullMode, GPUFrontFace],
  depthStencil = VIS_DEPTH,
) {
  const { device, layout, module } = build
  const descriptor = (entryPoint: string): GPURenderPipelineDescriptor => ({
    layout,
    vertex: { module, entryPoint: rest ? 'vis_hiz_vs' : 'vis_vs' },
    fragment: { module, entryPoint, targets: VIS_TARGETS },
    primitive: { topology: 'triangle-list', cullMode, frontFace },
    depthStencil,
  })
  const opaque = !rest && build.opaque
  const [pipeline, twin] = await Promise.all([
    buildRenderPipeline(device, descriptor(build.fragment)),
    opaque && buildRenderPipeline(device, descriptor(opaque)),
  ])
  if (twin) opaqueTwins.set(pipeline, twin)
  return pipeline
}

/** Layer 0's pipelines: the occluders' three face modes, then their Hi-Z-tested twins. */
export function createWebgpuVisibilityRasterPipelines(
  device: GPUDevice,
  visModule: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  variant?: DiagnosticGpuVariant,
) {
  const build = visBuild(device, visModule, bindGroupLayout, variant)
  return scoped(device, async () => {
    const [occluders, tested] = await Promise.all(
      [false, true].map((rest) =>
        Promise.all(LAYER_CULLS.map((cull) => visPipeline(build, rest, cull))),
      ),
    )
    return {
      visPipelineBack: occluders[0],
      visPipelineNone: occluders[1],
      visPipelineFront: occluders[2],
      visHizRestBack: tested[0],
      visHizRestNone: tested[1],
      visHizRestFront: tested[2],
    }
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
      for (const rest of [false, true])
        for (const cull of LAYER_CULLS)
          // Reversed depth: moving closer to the eye ADDS units.
          pipelines.push(
            visPipeline(build, rest, cull, { ...VIS_DEPTH, depthBias: depthLayerUnits(layer) }),
          )
    return Promise.all(pipelines)
  })
}
