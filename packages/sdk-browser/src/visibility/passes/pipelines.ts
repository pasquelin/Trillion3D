import { validationScope } from '../../gpu/core/errorScope.ts'
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts'
import { variesVisibility, visVariantFragment } from '../../diagnostic/gpuGeometry.ts'
import { VIS_FRAGMENT, VIS_ID_PHASE, VIS_UNMASKED } from '../shader/visWgsl.ts'
import type { Clipping } from '../../gpu/core/clipDistances.ts'
import { VIS_VOXEL_FRAGMENT, VIS_VOXEL_VERTEX, visVoxelShader } from '../shader/visVoxelWgsl.ts'
import { BIN_KIND, type BinKind } from '../draw/contract.ts'
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts'
import { DEPTH_FORMAT } from '../../scene/targetFormats.ts'
import { hardwareWorkLayout } from '../raster/bindings.ts'

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
  if (error) throw error
  return value
}
/** The visibility raster's depth attachment, held read-only: no fragment is tested against it,
 *  the visibility write decides every pixel (`VIS_WRITE_WGSL`), and the closing resolve writes it
 *  (`../raster/resolve.ts`). A render pass needs one attachment; the raster writes none. */
export const VIS_DEPTH: GPUDepthStencilState = {
  format: DEPTH_FORMAT,
  depthWriteEnabled: false,
  depthCompare: 'always',
}

/** A twin's rank: the kind of rows its slot holds and the phase of the visibility write. */
const twinRank = (kind: BinKind, ids: boolean) => 2 * kind + (ids ? 1 : 0)
/**
 * Each pipeline's twins, by the kind of rows a slot holds (`BIN_KIND`) and the phase of the
 * visibility write it draws (`ids`), keyed by the pipeline itself, so a twin follows its pipeline
 * wherever it is replaced or dropped. The pipeline itself is the cutout slots' depth phase:
 * - its identifier phase: the same states and stages, `ID_PHASE` on; the stage of the variant that
 *   draws no fragment has no phase, and draws both;
 * - an opaque slot's: the same states and stages, its mask test compiled out (`VIS_UNMASKED`): it
 *   neither reads the page nor cuts; none under a diagnostic variant of the raster stage, which
 *   imposes its one stage on every draw;
 * - a voxel slot's: the same states, the voxel module's stages (`visVoxelShader`), which trace the
 *   bricks and write their depth; the one-sided pipelines alone have one — a voxel row draws by
 *   one side (`rowSide`) —, and every variant but the one that draws no fragment keeps it: a view
 *   shows the voxels' own shape, the x-ray view the boxes. Both phases are made — their module
 *   with them, cutting at the view's plane where the project switch is on (`Clipping`) — the first
 *   time a frame holds a voxel row (`askVoxelTwin`): a scene without voxels compiles none.
 * A slot without its twin draws with the pipeline itself.
 */
const twins = new WeakMap<GPURenderPipeline, Array<GPURenderPipeline | undefined>>()
export const twinOf = (pipeline: GPURenderPipeline, kind: BinKind, ids: boolean) =>
  twins.get(pipeline)?.[twinRank(kind, ids)]
/** Each pipeline's voxel twins still to make, once asked (`askVoxelTwin`). */
const voxelRecipes = new WeakMap<GPURenderPipeline, () => Promise<GPURenderPipeline[]>>()
/** Voxel twins made so far: a slot walk keyed on it draws them once they land (`drawVis`). */
let voxelTwinsMade = 0
export const voxelTwinCount = () => voxelTwinsMade
/** `pipeline`'s voxel twins, their compile started the first time they are asked: none until both
 *  phases land. */
export function askVoxelTwin(pipeline: GPURenderPipeline) {
  const made = twinOf(pipeline, BIN_KIND.VOXEL, false)
  const recipe = voxelRecipes.get(pipeline)
  if (made || !recipe) return made
  voxelRecipes.delete(pipeline)
  // A refused compile leaves the slot undrawn, as the scene's other refusals do.
  recipe().then(
    ([depth, ids]) => {
      const held = twins.get(pipeline) ?? []
      held[twinRank(BIN_KIND.VOXEL, false)] = depth
      held[twinRank(BIN_KIND.VOXEL, true)] = ids
      twins.set(pipeline, held)
      voxelTwinsMade++
    },
    () => undefined,
  )
  return undefined
}

/** A fragment stage's constants in the phase `ids`: its own, plus `ID_PHASE` where the stage
 *  has the phase — the raster's one stage (`VIS_FRAGMENT`) or the voxel slots'. */
const phased = (constants: Record<string, number> | undefined, ids: boolean) => ({
  ...constants,
  [VIS_ID_PHASE]: ids ? 1 : 0,
})

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
  clipping?: Clipping,
): VisBuild {
  const twins = !variesVisibility(variant)
  let voxel: GPUShaderModule | undefined
  const voxelModule = () =>
    (voxel ??= device.createShaderModule({ code: visVoxelShader(clipping) }))
  return {
    ...{ device, module },
    layout: device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout, hardwareWorkLayout(device)],
    }),
    fragment: visVariantFragment(variant),
    twins,
    voxelModule: visVariantFragment(variant).fragmentless ? undefined : voxelModule,
  }
}
/** A pipeline's voxel twins over `build`'s layout and the states `primitive`: the voxel module's
 *  stages `module`, in the depth phase and the identifier phase. */
function voxelPipelines(build: VisBuild, module: GPUShaderModule, primitive: GPUPrimitiveState) {
  const voxel = (phase: boolean) =>
    buildRenderPipeline(build.device, {
      layout: build.layout,
      vertex: { module, entryPoint: VIS_VOXEL_VERTEX },
      fragment: {
        module,
        entryPoint: VIS_VOXEL_FRAGMENT,
        targets: [],
        constants: phased(undefined, phase),
      },
      primitive,
      depthStencil: VIS_DEPTH,
    })
  return Promise.all([voxel(false), voxel(true)])
}

/** The pipeline of a face mode, both halves' and both phases', and its twins (above). */
async function visPipeline(build: VisBuild, [cullMode, frontFace]: [GPUCullMode, GPUFrontFace]) {
  const { device, layout, module } = build
  const primitive: GPUPrimitiveState = { topology: 'triangle-list', cullMode, frontFace }
  const phases = build.fragment.entryPoint === VIS_FRAGMENT
  const descriptor = (
    ids: boolean,
    constants = build.fragment.constants,
  ): GPURenderPipelineDescriptor => {
    const fragmentConstants = phases ? phased(constants, ids) : constants
    return {
      layout,
      vertex: { module, entryPoint: 'vis_vs' },
      fragment: {
        module,
        entryPoint: build.fragment.entryPoint,
        targets: [],
        ...(fragmentConstants && { constants: fragmentConstants }),
      },
      primitive,
      depthStencil: VIS_DEPTH,
    }
  }
  const [pipeline, ids, opaque, opaqueIds] = await Promise.all([
    buildRenderPipeline(device, descriptor(false)),
    phases && buildRenderPipeline(device, descriptor(true)),
    build.twins && buildRenderPipeline(device, descriptor(false, VIS_UNMASKED)),
    build.twins && buildRenderPipeline(device, descriptor(true, VIS_UNMASKED)),
  ])
  const held: Array<GPURenderPipeline | undefined> = []
  held[twinRank(BIN_KIND.CUTOUT, true)] = ids || pipeline
  if (opaque && opaqueIds) {
    held[twinRank(BIN_KIND.OPAQUE, false)] = opaque
    held[twinRank(BIN_KIND.OPAQUE, true)] = opaqueIds
  }
  twins.set(pipeline, held)
  const voxelModule = cullMode === 'none' ? undefined : build.voxelModule
  if (voxelModule) voxelRecipes.set(pipeline, () => voxelPipelines(build, voxelModule(), primitive))
  return pipeline
}

/** The visibility raster's pipelines: one per face mode, for both halves, both phases and every
 *  coplanar layer — a layer is the row's own depth units in the visibility write
 *  (`page.depthBias`), never a pipeline's. `clipping`, the way `visModule` cuts at a view's plane
 *  (the voxel slots' module cuts the same way). */
export function createWebgpuVisibilityRasterPipelines(
  device: GPUDevice,
  visModule: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  variant?: DiagnosticGpuVariant,
  clipping?: Clipping,
) {
  const build = visBuild(device, visModule, bindGroupLayout, variant, clipping)
  return scoped(device, async () => {
    const [back, none, front] = await Promise.all(
      LAYER_CULLS.map((cull) => visPipeline(build, cull)),
    )
    return { visPipelineBack: back, visPipelineNone: none, visPipelineFront: front }
  })
}
