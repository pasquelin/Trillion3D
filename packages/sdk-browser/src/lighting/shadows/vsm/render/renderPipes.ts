/**
 * THE RASTER'S PIPES AND CONTEXT (`renderPass.ts`): its candidates, views, cull, bin and argument
 * kernels, its render pipeline on the shadow page group — described once a device and raster text —,
 * its dummy target, and the context of a set that holds them with its lists.
 */
import { NO_RASTERS, type GraphRasters } from '../../../../materials/graph/graphRasters.ts'
import { shadowMasks } from '../../../../visibility/shader/maskSets.ts'
import { shadowWpo, voxelWpo } from '../../../../visibility/shader/wpoSets.ts'
import { preparedPipeline, type PreparedPipeline } from '../../../deferred/fullscreen.ts'
import { preparedPipelines } from '../../../../gpu/core/preparedPipelines.ts'
import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import { COMPUTE, computeBufferEntry } from '../../../../gpu/core/computeBindings.ts'
import {
  createWebgpuBindIdentity,
  heldGroup,
  type HeldGroup,
  type WebgpuBindIdentity,
} from '../../../../gpu/bind/bindIdentity.ts'
import type { UniformSlots } from '../../../../session/memory/pools.ts'
import { vsmComputePipe } from '../passKit.ts'
import { vsmOcclusionEntries } from '../occlusion/occlusionPass.ts'
import {
  vsmBindGroupLayoutEntries,
  vsmFrameSetHeld,
  type VsmPerFrameSet,
  type VsmResources,
} from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { VSM_RENDER_CULL_SPECS, vsmRenderCullWgsl } from './renderCullWgsl.ts'
import { VSM_RENDER_BIN_SPECS, vsmRenderBinWgsl } from './renderBinWgsl.ts'
import { VSM_RENDER_VIEWS_SPECS, vsmRenderViewsWgsl } from './renderViewsWgsl.ts'
import {
  VSM_RENDER_CASTERS_DONE_ENTRY,
  VSM_RENDER_CASTERS_ENTRY,
  VSM_RENDER_CASTERS_POST_DONE_ENTRY,
  vsmRenderCandidatesWgsl,
  vsmRenderCastersDoneWgsl,
} from './renderCandidatesWgsl.ts'
import {
  VSM_RENDER_RASTER_FRAGMENT_SPECS,
  VSM_RENDER_RASTER_SHARED_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
  VSM_RENDER_TARGET_FORMAT,
  VSM_RENDER_TARGET_TEXELS,
  vsmRenderRasterWgsl,
} from './renderRasterWgsl.ts'
import {
  VSM_RENDER_ARGS_WGSL,
  VSM_RENDER_FAMILY,
  VSM_RENDER_SOFTWARE_BIN,
  vsmRenderTierCorners,
  vsmRenderTierFamily,
} from './renderParamsWgsl.ts'
import {
  vsmCandidatesEntries,
  vsmCastersDoneEntries,
  vsmCandidatesWorldEntries,
  vsmRenderParamSlots,
  vsmRenderParamsEntry,
} from './renderParams.ts'
import { vsmRenderVoxelWgsl } from './renderVoxelWgsl.ts'
import {
  VSM_RENDER_SOFTWARE_ENTRY,
  VSM_RENDER_SOFTWARE_SPECS,
  VSM_RENDER_SOFTWARE_STATIC_ENTRY,
  vsmRenderSoftwareWgsl,
} from './renderSoftwareWgsl.ts'
import { shadowPageComputeEntries } from '../../casters/pageGroup.ts'
import { hasSubgroups } from '../../../../gpu/core/subgroups.ts'
import type { RasterTables, RenderListGroups } from './renderEncode.ts'
import type { VsmListName } from './renderLists.ts'
import { VSM_PASS_PREFIX } from '../../../../diagnostic/stage/passLabels.ts'

/** What the raster's passes, pipes and lists are labelled under. */
export const RENDER_LABEL = `${VSM_PASS_PREFIX}render`

/** The tiers, lowest first, each one's raster pipeline: those before the software bin. */
const TIERS = Array.from({ length: VSM_RENDER_SOFTWARE_BIN }, (_, t) => t)

const storage = (binding: number) => computeBufferEntry(binding, 'storage', COMPUTE)
const read = (binding: number) => computeBufferEntry(binding, 'read-only-storage', COMPUTE)

/** The cull's four kernels of `layout` (`vsmComputePipe`): with no test, the occlusion's first, second
 *  and post culls. `throttled`, the family that also counts the clusters it draws in each map for the
 *  compute throttle (`../throttle.ts`), made when a throttled frame asks it: the bindings are the same,
 *  so the groups of one family bind to the other's pipes. */
export function vsmRenderCullPipes(device: GPUDevice, layout: VsmLayout, throttled = false) {
  const code = vsmRenderCullWgsl(layout, throttled),
    suffix = throttled ? 'Throttled' : ''
  const groups = [
    vsmBindGroupLayoutEntries(VSM_RENDER_CULL_SPECS, COMPUTE),
    [vsmRenderParamsEntry(0), read(1), read(2), storage(3), storage(4)],
  ]
  // The cull with no test reaches the occlusion's group through the cull of a view, as the two
  // others do: it binds the blank one (`noOcclusionGroup`).
  const pipe = (name: string, entryPoint: string) =>
    vsmComputePipe(device, `${RENDER_LABEL}.${name}${suffix}`, code, entryPoint, [
      ...groups,
      vsmOcclusionEntries(),
    ])
  return {
    cull: pipe('cull', 'vsmRenderCull'),
    cullFirst: pipe('cullFirst', 'vsmRenderCullFirst'),
    cullSecond: pipe('cullSecond', 'vsmRenderCullSecond'),
    cullPost: pipe('cullPost', 'vsmRenderCullPost'),
  }
}
export type VsmRenderCullPipes = ReturnType<typeof vsmRenderCullPipes>

/** The raster's compute pipes of `layout` (`vsmComputePipe`): its candidates and their closing
 *  kernel, the views, the cull, the bin and the argument kernels; their groups' layouts. Pipes are
 *  made once a device and source, read where they are bound. */
export function vsmRenderComputePipes(device: GPUDevice, layout: VsmLayout) {
  const P = vsmRenderParamsEntry
  const pipe = (
    name: string,
    code: string,
    entryPoint: string,
    groups: GPUBindGroupLayoutEntry[][],
  ) => vsmComputePipe(device, `${RENDER_LABEL}.${name}`, code, entryPoint, groups)
  const castersCode = vsmRenderCandidatesWgsl()
  const castersGroups = [vsmCandidatesEntries(), vsmCandidatesWorldEntries()]
  const doneCode = vsmRenderCastersDoneWgsl()
  const doneGroups = [vsmCastersDoneEntries()]
  const argsGroups = [[P(0), storage(1), storage(2), storage(3)]]
  return {
    candidates: pipe('candidates', castersCode, VSM_RENDER_CASTERS_ENTRY, castersGroups),
    candidatesDone: pipe('candidatesDone', doneCode, VSM_RENDER_CASTERS_DONE_ENTRY, doneGroups),
    candidatesPostDone: pipe(
      'candidatesPostDone',
      doneCode,
      VSM_RENDER_CASTERS_POST_DONE_ENTRY,
      doneGroups,
    ),
    views: pipe('views', vsmRenderViewsWgsl(layout), 'vsmRenderViews', [
      vsmBindGroupLayoutEntries(VSM_RENDER_VIEWS_SPECS, COMPUTE),
      [P(0), storage(1), storage(2), read(3)],
    ]),
    ...vsmRenderCullPipes(device, layout),
    bin: pipe('bin', vsmRenderBinWgsl(layout), 'vsmRenderBin', [
      vsmBindGroupLayoutEntries(VSM_RENDER_BIN_SPECS, COMPUTE),
      [P(0), storage(1), read(2), storage(3)],
    ]),
    args: {
      cull: pipe('args', VSM_RENDER_ARGS_WGSL, 'vsmRenderArgsCull', argsGroups),
      bin: pipe('args', VSM_RENDER_ARGS_WGSL, 'vsmRenderArgsBin', argsGroups),
      second: pipe('args', VSM_RENDER_ARGS_WGSL, 'vsmRenderArgsSecond', argsGroups),
    },
  }
}
type VsmRenderKernels = ReturnType<typeof vsmRenderComputePipes>

/** What a raster pipeline is made for: the raster's text of a layout and, asked the first time a
 *  table holds a voxel row, its voxel rows' text (`renderVoxelWgsl.ts`), on the shadow page group. */
interface RasterSource {
  code: string
  voxelCode: () => string
  pageLayout: GPUBindGroupLayout
}

/** `make`'s pipeline, made — and its module with it — only when first prepared, asked or got: a
 *  scene that never holds a voxel row compiles none of its tiers. */
function madeLater(
  make: () => PreparedPipeline<GPURenderPipeline>,
): PreparedPipeline<GPURenderPipeline> {
  let made: PreparedPipeline<GPURenderPipeline> | undefined
  const of = () => (made ??= make())
  const later: PreparedPipeline<GPURenderPipeline> = {
    prepare: () => of().prepare(),
    ask() {
      of().ask()
      return later
    },
    get ready() {
      return made?.ready ?? false
    },
    get: () => of().get(),
  }
  return later
}

/** The raster's render pipelines of `code`, one a tier (its corners an override): the one-sided
 *  rows' tiers cull the back faces, the two-sided rows' cull none, the voxel tiers', of
 *  `voxelCode`, made later (`madeLater`), cull the back faces. And their group 1's layout
 *  (`vsmRasterPipe`). */
function makeRaster(
  device: GPUDevice,
  { code, voxelCode, pageLayout }: RasterSource,
): VsmRenderContext['raster'] {
  const layout1 = device.createBindGroupLayout({
    label: `${RENDER_LABEL}.raster1`,
    entries: [
      computeBufferEntry(0, 'read-only-storage', GPUShaderStage.VERTEX),
      ...vsmBindGroupLayoutEntries(VSM_RENDER_RASTER_VERTEX_SPECS, GPUShaderStage.VERTEX),
      ...vsmBindGroupLayoutEntries(VSM_RENDER_RASTER_FRAGMENT_SPECS, GPUShaderStage.FRAGMENT),
      ...vsmBindGroupLayoutEntries(
        VSM_RENDER_RASTER_SHARED_SPECS,
        GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      ),
    ],
  })
  const module = device.createShaderModule({ label: `${RENDER_LABEL}.raster`, code })
  let voxelModule: GPUShaderModule | undefined
  const voxelStages = () =>
    (voxelModule ??= device.createShaderModule({
      label: `${RENDER_LABEL}.rasterVoxel`,
      code: voxelCode(),
    }))
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [pageLayout, layout1] })
  const tier = (t: number, stages: GPUShaderModule, cullMode: GPUCullMode) =>
    preparedPipeline(device, {
      label: `${RENDER_LABEL}.raster${t}`,
      layout: pipelineLayout,
      vertex: {
        module: stages,
        entryPoint: 'vsmRenderVs',
        constants: { VSM_RENDER_CORNERS: vsmRenderTierCorners(t) },
      },
      fragment: { module: stages, entryPoint: 'vsmRenderFs', targets: [] },
      // Each vertex emits its triangle light-facing counter-clockwise (`vsmRenderSwapped`); a
      // two-sided row's tier culls none.
      primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode },
      depthStencil: {
        format: VSM_RENDER_TARGET_FORMAT,
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })
  const tiers = TIERS.map((t) => {
    switch (vsmRenderTierFamily(t)) {
      case VSM_RENDER_FAMILY.oneSided:
        return tier(t, module, 'back')
      case VSM_RENDER_FAMILY.twoSided:
        return tier(t, module, 'none')
      default:
        return madeLater(() => tier(t, voxelStages(), 'back'))
    }
  })
  return { layout1, tiers }
}

/** Each device's raster pipelines, by the raster's text, made once a device. */
const rasters = oncePerDevice((device: GPUDevice) =>
  preparedPipelines(
    (source: RasterSource) => makeRaster(device, source),
    ({ code }) => code,
  ),
)

/**
 * The raster's render pipeline for `layout` on the shadow page group `pageLayout` — the device's
 * one (`shadowPageLayout`, `lighting/shadows/casters/pageGroup.ts`, made once a device) — and its group 1's
 * layout: described once a device and raster text, compiled the engine's one way
 * (`preparedPipeline`) — by the prepare step for the set the casting lights are first granted
 * (`prepareVsmPipelines`), at once by a frame that binds it unprepared. `pipeline` is read where
 * it is bound.
 */
export const vsmRasterPipe = (
  device: GPUDevice,
  layout: VsmLayout,
  pageLayout: GPUBindGroupLayout,
  held: GraphRasters = NO_RASTERS,
): VsmRenderContext['raster'] =>
  rasters(device).of({
    code: vsmRenderRasterWgsl(layout, shadowMasks(held), shadowWpo(held)),
    voxelCode: () => vsmRenderVoxelWgsl(layout, voxelWpo(held)),
    pageLayout,
  })

/** The software half's pipes (`renderSoftwareWgsl.ts`) for `layout` and the session's graphs
 *  (`held`): every record into slice 0, the static layer's into the static slice; group 0 the page
 *  rows' compute twin (`shadowPageComputeLayout`), group 1 the sorted records, the VSM resources of
 *  `VSM_RENDER_SOFTWARE_SPECS` and the parameters. */
export function vsmSoftwarePipes(
  device: GPUDevice,
  layout: VsmLayout,
  held: GraphRasters = NO_RASTERS,
) {
  const code = vsmRenderSoftwareWgsl(
    layout,
    shadowMasks(held),
    shadowWpo(held),
    hasSubgroups(device),
  )
  const groups = [
    shadowPageComputeEntries(device),
    [
      computeBufferEntry(0, 'read-only-storage', COMPUTE),
      ...vsmBindGroupLayoutEntries(VSM_RENDER_SOFTWARE_SPECS, COMPUTE),
      vsmRenderParamsEntry(4),
    ],
  ]
  const pipe = (entry: string) =>
    vsmComputePipe(device, `${RENDER_LABEL}.${entry}`, code, entry, groups)
  return {
    all: pipe(VSM_RENDER_SOFTWARE_ENTRY),
    static: pipe(VSM_RENDER_SOFTWARE_STATIC_ENTRY),
  }
}

/** The raster's dummy target (`context`): one window of depth. */
export const renderTarget = () => ({
  label: `${RENDER_LABEL}.dummyTarget`,
  size: [VSM_RENDER_TARGET_TEXELS, VSM_RENDER_TARGET_TEXELS],
  format: VSM_RENDER_TARGET_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
})

/** The raster's context on a device: its kernels and pipelines, its lists and their groups. */
export interface VsmRenderContext extends VsmRenderKernels {
  device: GPUDevice
  layout: VsmLayout
  pageLayout: GPUBindGroupLayout
  /** The throttled cull family, made the first frame that asks it (`renderCulls`). */
  throttledCulls?: VsmRenderCullPipes
  /** The session's graph outputs the raster's module is made with (`VsmRenderScene.rasters`). */
  held: GraphRasters
  /** The software half's pipes (`vsmSoftwarePipes`). */
  software: ReturnType<typeof vsmSoftwarePipes>
  raster: {
    layout1: GPUBindGroupLayout
    /** The raster pipeline of each tier, lowest first, the voxel tiers last — made the first time
     *  a table holds a voxel row —; read where it is bound. */
    tiers: PreparedPipeline<GPURenderPipeline>[]
  }
  target: GPUTextureView
  targetTexture: GPUTexture
  /** Its lists, by name (`vsmEnsureLists`). */
  buffers: Partial<Record<VsmListName, GPUBuffer>>
  /** The view passes' parameter slots (`vsmRenderParamSlots`). */
  slots: UniformSlots
  /** Each view pass's labels — its compute and raster passes, and the occlusion's second ones — and
   *  parameter offset, made once a context. */
  passes: {
    pass: (p: number) => {
      cull: GPUComputePassDescriptor
      raster: string
      second: GPUComputePassDescriptor
      rasterSecond: string
      offset: number[]
    }
  }
  /** The scene's rows and the lists the list groups bound when made. */
  bound: WebgpuBindIdentity
  /** The groups over the scene's rows and the lists, made again when one of them moved. */
  groups?: RenderListGroups
  /** The groups over the tables of a frame set (`res.current`, the two in turn). */
  tables: VsmPerFrameSet<RasterTables>
  /** The candidates' group over the camera cut's world switch (`vsmWorldGroup`). */
  world: HeldGroup
}

/** The pass labels of the raster and view pass `p`'s parameter offset in `slots`: made once for
 *  every frame. */
function renderPasses(slots: UniformSlots): VsmRenderContext['passes'] {
  const held: ReturnType<VsmRenderContext['passes']['pass']>[] = []
  return {
    pass: (p) =>
      (held[p] ??= {
        cull: { label: `${RENDER_LABEL}.cull ${p}` },
        raster: `${RENDER_LABEL}.raster ${p}`,
        second: { label: `${RENDER_LABEL}.cullSecond ${p}` },
        rasterSecond: `${RENDER_LABEL}.rasterSecond ${p}`,
        offset: slots.offset(p),
      }),
  }
}

/** Frees what a context holds on the device: its lists and its dummy target. */
export function vsmReleaseContext(ctx: VsmRenderContext) {
  for (const buffer of Object.values(ctx.buffers)) buffer?.destroy()
  ctx.targetTexture.destroy()
}

/** The cull family a frame runs: the throttled one where the compute throttle counts, else the
 *  plain one the context holds. */
export const renderCulls = (ctx: VsmRenderContext, throttled: boolean): VsmRenderCullPipes =>
  throttled ? (ctx.throttledCulls ??= vsmRenderCullPipes(ctx.device, ctx.layout, true)) : ctx

/** The raster's context of `res` on `device` over the shadow page group `pageLayout`: the one it
 *  holds, or made again — for another device, set layout or page group, or other graph outputs
 *  (`held`: the session's cutouts and offsets the raster is made with). */
export function vsmRenderContext(
  res: VsmResources,
  device: GPUDevice,
  pageLayout: GPUBindGroupLayout,
  held: GraphRasters = NO_RASTERS,
): VsmRenderContext {
  const existing = res.render
  if (
    existing &&
    existing.device === device &&
    existing.layout === res.layout &&
    existing.pageLayout === pageLayout &&
    existing.held === held
  )
    return existing
  const layout = res.layout
  // A context made again for the same device keeps its lists; its old target is freed.
  if (existing?.device === device) existing.targetTexture.destroy()
  const targetTexture = device.createTexture(renderTarget())
  const slots = vsmRenderParamSlots(device.limits)
  const ctx: VsmRenderContext = {
    device,
    layout,
    pageLayout,
    ...vsmRenderComputePipes(device, layout),
    held,
    raster: vsmRasterPipe(device, layout, pageLayout, held),
    software: vsmSoftwarePipes(device, layout, held),
    target: targetTexture.createView(),
    targetTexture,
    buffers: existing?.device === device ? existing.buffers : {},
    slots,
    passes: renderPasses(slots),
    bound: createWebgpuBindIdentity(),
    tables: vsmFrameSetHeld<RasterTables>(),
    world: heldGroup(),
  }
  res.render = ctx
  return ctx
}
