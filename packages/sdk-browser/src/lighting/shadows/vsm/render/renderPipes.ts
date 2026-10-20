/**
 * THE RASTER'S PIPES AND CONTEXT (`renderPass.ts`): its candidates and chunk kernels, its render
 * pipeline on the shadow page group — described once a device and raster text —, its dummy target,
 * and the context of a set that holds them with its lists.
 */
import { preparedPipeline, type PreparedPipeline } from '../../../deferred/fullscreen.ts'
import { preparedPipelines } from '../../../../gpu/core/preparedPipelines.ts'
import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import { COMPUTE, computeBufferEntry } from '../../../../gpu/core/computeBindings.ts'
import { VSM_PAGE_TEXELS } from '../constants.ts'
import { vsmComputePipe } from '../passKit.ts'
import { vsmBindGroupLayoutEntries, type VsmResources } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { vsmRenderCullWgsl } from './renderCullWgsl.ts'
import { vsmRenderCandidatesWgsl } from './renderCandidatesWgsl.ts'
import {
  VSM_RENDER_RASTER_FRAGMENT_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
  VSM_RENDER_TARGET_FORMAT,
  vsmRenderRasterWgsl,
} from './renderRasterWgsl.ts'
import { vsmChunkContext, vsmChunkKernels } from '../chunks/chunkKernels.ts'
import { vsmCandidatesEntries, vsmRenderParamsEntry } from '../chunks/chunkParams.ts'
import { VSM_RENDER_EXPAND_SPECS, vsmRenderExpandWgsl } from './renderExpandWgsl.ts'
import {
  VSM_RENDER_TIERS,
  VSM_RENDER_VOXEL_TIER,
  vsmRenderTierCorners,
} from './renderParamsWgsl.ts'
import { vsmRenderVoxelWgsl } from './renderVoxelWgsl.ts'
import type { RasterTables } from './renderChunks.ts'
import type { VsmRenderContext } from './renderPass.ts'
import { VSM_PASS_PREFIX } from '../../../../diagnostic/stage/passLabels.ts'

/** What the raster's passes, pipes and lists are labelled under. */
export const RENDER_LABEL = `${VSM_PASS_PREFIX}render`

/** The tiers, lowest first: each one's expand and raster pipeline (`VSM_RENDER_TIERS`). */
const TIERS = Array.from({ length: VSM_RENDER_TIERS }, (_, t) => t)

/** The raster's compute pipes of `layout` (`vsmComputePipe`): its candidates, chunk kernels, the
 *  bin and the expand of each tier — one module, the tier an override (`vsmRenderExpandWgsl`); a
 *  voxel tier's expand is compiled the first time it is asked (`vsmEncodeChunks`), never by the
 *  prepare step (`VSM_RENDER_CORNER_TIERS`, `vsmPlan.ts`). */
export function vsmRenderComputePipes(device: GPUDevice, layout: VsmLayout) {
  const candidates = vsmComputePipe(
    device,
    `${RENDER_LABEL}.candidates`,
    vsmRenderCandidatesWgsl(),
    'vsmRenderCandidates',
    [vsmCandidatesEntries()],
  )
  const expandCode = vsmRenderExpandWgsl(layout)
  const expandGroups = [
    vsmBindGroupLayoutEntries(VSM_RENDER_EXPAND_SPECS, layout, COMPUTE),
    [
      vsmRenderParamsEntry(0),
      computeBufferEntry(1, 'read-only-storage', COMPUTE),
      computeBufferEntry(2, 'storage', COMPUTE),
      computeBufferEntry(3, 'storage', COMPUTE),
      computeBufferEntry(4, 'storage', COMPUTE),
    ],
  ]
  return {
    candidates,
    ...vsmChunkKernels(device, layout, RENDER_LABEL, vsmRenderCullWgsl(layout)),
    bin: vsmComputePipe(device, `${RENDER_LABEL}.bin`, expandCode, 'vsmRenderBin', expandGroups),
    expands: TIERS.map((t) =>
      vsmComputePipe(
        device,
        `${RENDER_LABEL}.expand${t}`,
        expandCode,
        'vsmRenderExpand',
        expandGroups,
        { VSM_RENDER_TIER: t },
      ),
    ),
  }
}

/** What a raster pipeline is made for: the raster's text of a layout and, asked the first time a
 *  table holds a voxel row, its voxel rows' text (`renderVoxelWgsl.ts`), on the shadow page group. */
interface RasterSource {
  code: string
  voxelCode: () => string
  layout: VsmLayout
  pageLayout: GPUBindGroupLayout
}

/** `make`'s pipeline, made — and its module with it — only when first prepared, asked or got: a
 *  scene that never holds a voxel row compiles none of the voxel tiers. */
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

/** The raster's render pipelines of `code`, one a tier (its corners an override) — the voxel
 *  tiers' of `voxelCode`, made later (`madeLater`) —, and their group 1's layout
 *  (`vsmRasterPipe`). */
function makeRaster(
  device: GPUDevice,
  { code, voxelCode, layout, pageLayout }: RasterSource,
): VsmRenderContext['raster'] {
  const layout1 = device.createBindGroupLayout({
    label: `${RENDER_LABEL}.raster1`,
    entries: [
      computeBufferEntry(0, 'read-only-storage', GPUShaderStage.VERTEX),
      ...vsmBindGroupLayoutEntries(VSM_RENDER_RASTER_VERTEX_SPECS, layout, GPUShaderStage.VERTEX),
      ...vsmBindGroupLayoutEntries(
        VSM_RENDER_RASTER_FRAGMENT_SPECS,
        layout,
        GPUShaderStage.FRAGMENT,
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
  const tier = (t: number, stages: GPUShaderModule) =>
    preparedPipeline(device, {
      label: `${RENDER_LABEL}.raster${t}`,
      layout: pipelineLayout,
      vertex: {
        module: stages,
        entryPoint: 'vsmRenderVs',
        constants: { VSM_RENDER_CORNERS: vsmRenderTierCorners(t) },
      },
      fragment: { module: stages, entryPoint: 'vsmRenderFs', targets: [] },
      // Each vertex emits its triangle light-facing counter-clockwise (`vsmRenderSwapped`).
      primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: 'back' },
      depthStencil: {
        format: VSM_RENDER_TARGET_FORMAT,
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })
  const tiers = TIERS.map((t) =>
    t < VSM_RENDER_VOXEL_TIER ? tier(t, module) : madeLater(() => tier(t, voxelStages())),
  )
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
): VsmRenderContext['raster'] =>
  rasters(device).of({
    code: vsmRenderRasterWgsl(layout),
    voxelCode: () => vsmRenderVoxelWgsl(layout),
    layout,
    pageLayout,
  })

/** The raster's dummy target (`context`): one page of depth. */
export const renderTarget = () => ({
  label: `${RENDER_LABEL}.dummyTarget`,
  size: [VSM_PAGE_TEXELS, VSM_PAGE_TEXELS],
  format: VSM_RENDER_TARGET_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
})

/** The raster's context of `res` on `device` over the shadow page group `pageLayout`: the one it
 *  holds, or made again — for another device, set layout or page group. */
export function vsmRenderContext(
  res: VsmResources,
  device: GPUDevice,
  pageLayout: GPUBindGroupLayout,
): VsmRenderContext {
  const existing = res.render
  if (
    existing &&
    existing.device === device &&
    existing.layout === res.layout &&
    existing.pageLayout === pageLayout
  )
    return existing
  const layout = res.layout
  // A context made again for the same device keeps its lists; its old target is freed.
  if (existing?.device === device) existing.targetTexture.destroy()
  const targetTexture = device.createTexture(renderTarget())
  const ctx: VsmRenderContext = {
    device,
    layout,
    pageLayout,
    ...vsmRenderComputePipes(device, layout),
    raster: vsmRasterPipe(device, layout, pageLayout),
    target: targetTexture.createView(),
    targetTexture,
    ...vsmChunkContext<RasterTables>(RENDER_LABEL, device, existing),
  }
  res.render = ctx
  return ctx
}
