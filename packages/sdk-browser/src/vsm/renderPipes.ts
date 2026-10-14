/**
 * THE RASTER'S PIPES AND CONTEXT (`renderPass.ts`): its candidates and chunk kernels, its render
 * pipeline on the shadow page group — described once a device and raster text —, its dummy target,
 * and the context of a set that holds them with its lists.
 */
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { preparedPipelines } from '../gpu/core/preparedPipelines.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { computeBufferEntry } from '../gpu/core/computeBindings.ts'
import { VSM_PAGE_TEXELS } from './constants.ts'
import { vsmComputePipe } from './passKit.ts'
import { vsmBindGroupLayoutEntries, type VsmResources } from './resources.ts'
import type { VsmLayout } from './layout.ts'
import { vsmRenderCandidatesWgsl, vsmRenderCullWgsl } from './renderCullWgsl.ts'
import {
  VSM_RENDER_RASTER_FRAGMENT_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
  VSM_RENDER_TARGET_FORMAT,
  vsmRenderRasterWgsl,
} from './renderRasterWgsl.ts'
import { vsmChunkContext, vsmChunkKernels } from './chunkKernels.ts'
import { vsmRenderParamsEntry } from './chunkParams.ts'
import type { RasterTables } from './renderChunks.ts'
import type { VsmRenderContext } from './renderPass.ts'
import { VSM_PASS_PREFIX } from '../stage/passLabels.ts'

/** What the raster's passes, pipes and lists are labelled under. */
export const RENDER_LABEL = `${VSM_PASS_PREFIX}render`

/** The raster's compute pipes of `layout` (`vsmComputePipe`): its candidates and chunk kernels. */
export function vsmRenderComputePipes(device: GPUDevice, layout: VsmLayout) {
  const C = GPUShaderStage.COMPUTE
  const candidates = vsmComputePipe(
    device,
    `${RENDER_LABEL}.candidates`,
    vsmRenderCandidatesWgsl(),
    'vsmRenderCandidates',
    [
      [
        vsmRenderParamsEntry(0),
        ...[1, 2, 3, 4].map((b) => computeBufferEntry(b, 'read-only-storage', C)),
        computeBufferEntry(5, 'storage', C),
        computeBufferEntry(6, 'storage', C),
      ],
    ],
  )
  return {
    candidates,
    ...vsmChunkKernels(device, layout, RENDER_LABEL, vsmRenderCullWgsl(layout)),
  }
}

/** What a raster pipeline is made for: the raster's text of a layout, on the shadow page group. */
interface RasterSource {
  code: string
  layout: VsmLayout
  pageLayout: GPUBindGroupLayout
}

/** The raster's render pipeline of `code` and its group 1's layout (`vsmRasterPipe`). */
function makeRaster(
  device: GPUDevice,
  { code, layout, pageLayout }: RasterSource,
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
  const prepared = preparedPipeline(device, {
    label: `${RENDER_LABEL}.raster`,
    layout: device.createPipelineLayout({ bindGroupLayouts: [pageLayout, layout1] }),
    vertex: { module, entryPoint: 'vsmRenderVs' },
    fragment: { module, entryPoint: 'vsmRenderFs', targets: [] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: {
      format: VSM_RENDER_TARGET_FORMAT,
      depthWriteEnabled: false,
      depthCompare: 'always',
    },
  })
  return {
    layout1,
    prepared,
    get pipeline() {
      return prepared.get()
    },
  }
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
 * one (`shadowPageLayout`, `webgpu/shadow/pageGroup.ts`, made once a device) — and its group 1's
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
  rasters(device).of({ code: vsmRenderRasterWgsl(layout), layout, pageLayout })

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
