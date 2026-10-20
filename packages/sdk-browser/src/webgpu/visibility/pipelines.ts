import { depthLayerUnits } from '../../../../sdk-core/src/lod/depthLayer.ts'
import { DEPTH_COMPARE } from '../../camera/depthConvention.ts'
import { validationScope } from '../../gpu/core/errorScope.ts'
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts'
import { variesVisibility, visVariantFragment } from '../../diagnostic/gpuGeometry.ts'
import { VIS_UNMASKED } from '../../visibility/shader/visWgsl.ts'
import {
  VIS_VOXEL_FRAGMENT,
  VIS_VOXEL_VERTEX,
  visVoxelShader,
} from '../../visibility/shader/visVoxelWgsl.ts'
import { BIN_KIND, type BinKind } from '../../gpu/draw/contract.ts'
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
 *  one occlusion path). Every raster drawing into the visibility pass uses these. */
export const VIS_TARGETS: GPUColorTargetState[] = [{ format: 'r32uint' }, { format: 'r32float' }]
/** The visibility raster's depth: written, tested as every opaque raster. */
export const VIS_DEPTH: GPUDepthStencilState = {
  format: DEPTH_FORMAT,
  depthWriteEnabled: true,
  depthCompare: DEPTH_COMPARE,
}

/**
 * Each pipeline's twins, by the kind of rows a slot holds (`BIN_KIND`), keyed by the pipeline
 * itself, so a twin follows its pipeline wherever it is replaced or dropped:
 * - an opaque slot's: the same states and stages, its mask test compiled out (`VIS_UNMASKED`): it
 *   neither reads the page nor discards; none under a diagnostic variant of the raster stage,
 *   which imposes its one stage on every draw;
 * - a voxel slot's: the same states, the voxel module's stages (`visVoxelShader`), which trace the
 *   bricks and write their depth; layer 0's one-sided pipelines alone have one — a voxel row
 *   draws on layer 0, by one side (`rowSide`) —, and every variant but the one that draws no
 *   fragment keeps it: a view shows the voxels' own shape, the x-ray view the boxes. It is made
 *   — its module with it — the first time a frame holds a voxel row (`askVoxelTwin`): a scene
 *   without voxels compiles none.
 * A slot without its twin draws with the pipeline itself.
 */
const twins = new WeakMap<GPURenderPipeline, Partial<Record<BinKind, GPURenderPipeline>>>()
export const twinOf = (pipeline: GPURenderPipeline, kind: BinKind) => twins.get(pipeline)?.[kind]
/** Each pipeline's voxel twin still to make, once asked (`askVoxelTwin`). */
const voxelRecipes = new WeakMap<GPURenderPipeline, () => Promise<GPURenderPipeline>>()
/** Voxel twins made so far: a slot walk keyed on it draws them once they land (`drawVis`). */
let voxelTwinsMade = 0
export const voxelTwinCount = () => voxelTwinsMade
/** `pipeline`'s voxel twin, its compile started the first time it is asked: none until it lands. */
export function askVoxelTwin(pipeline: GPURenderPipeline) {
  const made = twinOf(pipeline, BIN_KIND.VOXEL)
  const recipe = voxelRecipes.get(pipeline)
  if (made || !recipe) return made
  voxelRecipes.delete(pipeline)
  // A refused compile leaves the slot undrawn, as the scene's other refusals do.
  recipe().then(
    (voxel) => {
      twins.set(pipeline, { ...twins.get(pipeline), [BIN_KIND.VOXEL]: voxel })
      voxelTwinsMade++
    },
    () => undefined,
  )
  return undefined
}

/** What every visibility pipeline of one build shares. */
type VisBuild = {
  device: GPUDevice
  layout: GPUPipelineLayout
  module: GPUShaderModule
  fragment: ReturnType<typeof visVariantFragment>
  twins: boolean
  /** The voxel slots' module, made the first time one is asked; none under the variant that
   *  draws no fragment. */
  voxelModule?: () => GPUShaderModule
}
function visBuild(
  device: GPUDevice,
  module: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  variant?: DiagnosticGpuVariant,
): VisBuild {
  const twins = !variesVisibility(variant)
  let voxel: GPUShaderModule | undefined
  const voxelModule = () => (voxel ??= device.createShaderModule({ code: visVoxelShader() }))
  return {
    ...{ device, module },
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    fragment: visVariantFragment(variant),
    twins,
    voxelModule: visVariantFragment(variant).fragmentless ? undefined : voxelModule,
  }
}
/** The pipeline of a face mode, both halves', and its twins (above). */
async function visPipeline(
  build: VisBuild,
  [cullMode, frontFace]: [GPUCullMode, GPUFrontFace],
  depthStencil = VIS_DEPTH,
) {
  const { device, layout, module } = build
  const primitive: GPUPrimitiveState = { topology: 'triangle-list', cullMode, frontFace }
  const descriptor = (constants = build.fragment.constants): GPURenderPipelineDescriptor => ({
    layout,
    vertex: { module, entryPoint: 'vis_vs' },
    fragment: {
      module,
      entryPoint: build.fragment.entryPoint,
      targets: VIS_TARGETS,
      ...(constants && { constants }),
    },
    primitive,
    depthStencil,
  })
  const [pipeline, opaque] = await Promise.all([
    buildRenderPipeline(device, descriptor()),
    build.twins && buildRenderPipeline(device, descriptor(VIS_UNMASKED)),
  ])
  twins.set(pipeline, opaque ? { [BIN_KIND.OPAQUE]: opaque } : {})
  const voxelModule = cullMode === 'none' || depthStencil.depthBias ? undefined : build.voxelModule
  if (voxelModule)
    voxelRecipes.set(pipeline, () => {
      const stages = voxelModule()
      return buildRenderPipeline(device, {
        layout,
        vertex: { module: stages, entryPoint: VIS_VOXEL_VERTEX },
        fragment: { module: stages, entryPoint: VIS_VOXEL_FRAGMENT, targets: VIS_TARGETS },
        primitive,
        depthStencil,
      })
    })
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
