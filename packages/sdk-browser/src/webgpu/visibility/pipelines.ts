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

const LAYER_CULLS: Array<[GPUCullMode, GPUFrontFace]> = [
  ['back', 'ccw'],
  ['none', 'ccw'],
  ['front', 'ccw'],
  ['back', 'cw'],
  ['front', 'cw'],
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
/** The visibility raster's targets: the identifiers, and the pyramid's level 0 when `hiz`. Every
 *  raster drawing into the visibility pass — clusters and impostor cards — uses these. */
const VIS_TARGETS: GPUColorTargetState[] = [{ format: 'r32uint' }]
const VIS_HIZ_TARGETS: GPUColorTargetState[] = [{ format: 'r32uint' }, { format: 'r32float' }]
export const visTargets = (hiz: boolean) => (hiz ? VIS_HIZ_TARGETS : VIS_TARGETS)
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
  hiz: boolean
  targets: GPUColorTargetState[]
  fragment: string
  opaque: string | undefined
}
function visBuild(
  device: GPUDevice,
  module: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  hiz: boolean,
  variant?: DiagnosticGpuVariant,
): VisBuild {
  const twins = !variesVisibility(variant)
  return {
    ...{ device, module, hiz, targets: visTargets(hiz) },
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    fragment: visVariantFragment(hiz, variant),
    opaque: twins ? visOpaqueFragment(hiz) : undefined,
  }
}
/** The occluder (`rest` false) or tested pipeline of a face mode, and an occluder's twin. */
async function visPipeline(
  build: VisBuild,
  rest: boolean,
  [cullMode, frontFace]: [GPUCullMode, GPUFrontFace],
  depthStencil = VIS_DEPTH,
) {
  const { device, layout, module, targets } = build
  const descriptor = (entryPoint: string): GPURenderPipelineDescriptor => ({
    layout,
    vertex: { module, entryPoint: rest && build.hiz ? 'vis_hiz_vs' : 'vis_vs' },
    fragment: { module, entryPoint, targets },
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

export function createWebgpuVisibilityRasterPipelines(
  device: GPUDevice,
  visModule: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  hiz: boolean,
  variant?: DiagnosticGpuVariant,
) {
  const build = visBuild(device, visModule, bindGroupLayout, hiz, variant)
  const [back, none, front, backCw, frontCw] = LAYER_CULLS
  return scoped(device, async () => {
    const rest = (cull: [GPUCullMode, GPUFrontFace]) =>
      hiz ? visPipeline(build, true, cull) : Promise.resolve(undefined)
    const [occluders, tested] = await Promise.all([
      Promise.all(
        [back, backCw, none, front, frontCw].map((cull) => visPipeline(build, false, cull)),
      ),
      Promise.all([back, none, front].map(rest)),
    ])
    const [occBack, occBackCw, occNone, occFront, occFrontCw] = occluders,
      [restBack, restNone, restFront] = tested
    return {
      visPipelineBack: occBack,
      visPipelineBackCw: occBackCw,
      visPipelineNone: occNone,
      visPipelineFront: occFront,
      visPipelineFrontCw: occFrontCw,
      visHizRestBack: restBack,
      visHizRestNone: restNone,
      visHizRestFront: restFront,
    }
  })
}
/**
 * Pipelines of the coplanar layers above 0. A layer is only an integer depth bias on the same
 * pipeline: same module, same state, same draw order. Targets and inputs follow those layer 0 kept,
 * Hi-Z included, so both passes write the same attachments. `layerSlots` of 1 creates nothing.
 */
export function createWebgpuCoplanarLayerPipelines(
  device: GPUDevice,
  visModule: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  hiz: boolean,
  layerSlots: number,
  variant?: DiagnosticGpuVariant,
) {
  const build = visBuild(device, visModule, bindGroupLayout, hiz, variant)
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
