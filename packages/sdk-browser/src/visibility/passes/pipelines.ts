import { validationScope } from '../../gpu/core/errorScope.ts'
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts'
import { variesVisibility, visVariantFragment } from '../../diagnostic/gpuGeometry.ts'
import { VIS_UNMASKED } from '../shader/visWgsl.ts'
import type { Clipping } from '../../gpu/core/clipDistances.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import { VIS_VOXEL_FRAGMENT, VIS_VOXEL_VERTEX, visVoxelShader } from '../shader/visVoxelWgsl.ts'
import { BIN_KIND, type BinKind } from '../bins/contract.ts'
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts'
import { DEPTH_FORMAT } from '../../scene/targetFormats.ts'
import { hardwareWorkLayout } from '../raster/bindings.ts'
import { hasWideAtomics } from '../../gpu/core/wideAtomics.ts'
import { DEPTH_COMPARE_OR_EQUAL } from '../../camera/depthConvention.ts'

/** A slot's face modes, in its bins' order (`CULL_BINS`): a mirrored placement draws in the bin
 *  of the side it shows (`visBin`), so no clockwise pipeline is made. */
const LAYER_CULLS: Array<[GPUCullMode, GPUFrontFace]> = [
  ['back', 'ccw'],
  ['none', 'ccw'],
  ['front', 'ccw'],
]
/** `run` under a validation scope; its pipelines compile off the thread, together. */
export async function scoped<T>(device: GPUDevice, run: () => Promise<T>): Promise<T> {
  const { value, error } = await validationScope(device, run)
  if (error) throw new Error(error.message)
  return value
}
/** The visibility raster's depth attachment on a device with the 64-bit atomic maximum, held
 *  read-only: no fragment is tested against it, the visibility write decides every pixel
 *  (`visWriteWgsl`), and the export writes the scene's depth (`../raster/export.ts`). A render pass
 *  needs one attachment; the raster writes none. */
const VIS_DEPTH: GPUDepthStencilState = {
  format: DEPTH_FORMAT,
  depthWriteEnabled: false,
  depthCompare: 'always',
}
/** The same, on a device without it: the hardware raster draws each triangle once, into the scene's
 *  depth attachment, the nearer fragment kept by the hardware depth test — the engine's depth is
 *  reversed, the greater winning, a tie going to the later draw (`../../camera/depthConvention.ts`)
 *  — and its identifier into a colour attachment (`VIS_ID_TARGET`). */
const VIS_DEPTH_TESTED: GPUDepthStencilState = {
  format: DEPTH_FORMAT,
  depthWriteEnabled: true,
  depthCompare: DEPTH_COMPARE_OR_EQUAL,
}
/** The identifiers' colour target of the hardware raster on a device without the 64-bit word. */
export const VIS_ID_TARGET: GPUColorTargetState = { format: 'r32uint' }

/**
 * Each pipeline's twins, by the kind of rows a slot holds (`BIN_KIND`), keyed by the pipeline
 * itself, so a twin follows its pipeline wherever it is replaced or dropped. The pipeline itself is
 * the cutout slots':
 * - an opaque slot's: the same states and stages, its mask test compiled out (`VIS_UNMASKED`): it
 *   neither reads the page nor cuts; none under a diagnostic variant of the raster stage, which
 *   imposes its one stage on every draw;
 * - a voxel slot's: the same states, the voxel module's stages (`visVoxelShader`), which trace the
 *   bricks and write their depth; the one-sided pipelines alone have one — a voxel row draws by
 *   one side (`FLAG_BACK`) —, and every variant but the one that draws no fragment keeps it: a view
 *   shows the voxels' own shape, the x-ray view the boxes. Its module is made — cutting at the
 *   view's plane where the project switch is on (`Clipping`) — the first time a frame holds a
 *   voxel row (`askVoxelTwin`): a scene without voxels compiles none.
 * A slot without its twin draws with the pipeline itself.
 */
const twins = new WeakMap<GPURenderPipeline, Array<GPURenderPipeline | undefined>>()
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
      const held = twins.get(pipeline) ?? []
      held[BIN_KIND.VOXEL] = voxel
      twins.set(pipeline, held)
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
  /** The fragment targets and the depth state of the device's write: none and the read-only depth
   *  with the 64-bit word, the identifiers and the hardware depth test without it. */
  targets: GPUColorTargetState[]
  depth: GPUDepthStencilState
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
  clipping?: Clipping,
  wpo: WpoSet = NO_WPO,
): VisBuild {
  const twins = !variesVisibility(variant),
    wide = hasWideAtomics(device)
  let voxel: GPUShaderModule | undefined
  const voxelModule = () =>
    (voxel ??= device.createShaderModule({ code: visVoxelShader(clipping, wpo, wide) }))
  return {
    ...{ device, module },
    layout: device.createPipelineLayout({
      bindGroupLayouts: wide ? [bindGroupLayout, hardwareWorkLayout(device)] : [bindGroupLayout],
    }),
    fragment: visVariantFragment(variant),
    targets: wide ? [] : [VIS_ID_TARGET],
    depth: wide ? VIS_DEPTH : VIS_DEPTH_TESTED,
    twins,
    voxelModule: visVariantFragment(variant).fragmentless ? undefined : voxelModule,
  }
}
/** A pipeline's voxel twin over `build`'s layout and the states `primitive`: the voxel module's
 *  stages `module`. */
function voxelPipeline(build: VisBuild, module: GPUShaderModule, primitive: GPUPrimitiveState) {
  return buildRenderPipeline(build.device, {
    layout: build.layout,
    vertex: { module, entryPoint: VIS_VOXEL_VERTEX },
    fragment: { module, entryPoint: VIS_VOXEL_FRAGMENT, targets: build.targets },
    primitive,
    depthStencil: build.depth,
  })
}

/** The pipeline of a face mode, both halves', and its twins (above). */
async function visPipeline(build: VisBuild, [cullMode, frontFace]: [GPUCullMode, GPUFrontFace]) {
  const { device, layout, module } = build
  const primitive: GPUPrimitiveState = { topology: 'triangle-list', cullMode, frontFace }
  const descriptor = (constants = build.fragment.constants): GPURenderPipelineDescriptor => ({
    layout,
    vertex: { module, entryPoint: 'vis_vs' },
    fragment: {
      module,
      entryPoint: build.fragment.entryPoint,
      targets: build.targets,
      ...(constants && { constants }),
    },
    primitive,
    depthStencil: build.depth,
  })
  const [pipeline, opaque] = await Promise.all([
    buildRenderPipeline(device, descriptor()),
    build.twins && buildRenderPipeline(device, descriptor(VIS_UNMASKED)),
  ])
  const held: Array<GPURenderPipeline | undefined> = []
  if (opaque) held[BIN_KIND.OPAQUE] = opaque
  twins.set(pipeline, held)
  const voxelModule = cullMode === 'none' ? undefined : build.voxelModule
  if (voxelModule) voxelRecipes.set(pipeline, () => voxelPipeline(build, voxelModule(), primitive))
  return pipeline
}

/** The visibility raster's pipelines: one per face mode, for both halves and every coplanar
 *  layer — a layer is the row's own depth units in the visibility write
 *  (`page.depthBias`), never a pipeline's. `clipping`, the way `visModule` cuts at a view's plane
 *  (the voxel slots' module cuts the same way, and moves a brick by the offsets `wpo` holds). */
export function createWebgpuVisibilityRasterPipelines(
  device: GPUDevice,
  visModule: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  variant?: DiagnosticGpuVariant,
  clipping?: Clipping,
  wpo: WpoSet = NO_WPO,
) {
  return scoped(device, async () => {
    const build = visBuild(device, visModule, bindGroupLayout, variant, clipping, wpo)
    const [back, none, front] = await Promise.all(
      LAYER_CULLS.map((cull) => visPipeline(build, cull)),
    )
    return { visPipelineBack: back, visPipelineNone: none, visPipelineFront: front }
  })
}
