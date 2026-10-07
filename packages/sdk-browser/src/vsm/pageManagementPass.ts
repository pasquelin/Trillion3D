/**
 * Pass encoders of physical page management, in this order:
 * - `encodeVsmPageCarry`: the physical page address update, the first dispatch of
 *   the page marking's pass, which the frame opens (`vsmEncode.ts`).
 * - `encodeVsmPageMapping`: the page allocation build, after marking.
 * - `encodeVsmAfterRaster`: the post-render pass, after the shadow depth raster.
 * - `keepVsmFrame`: the page-management part of the frame data extraction: the frame just
 *   rendered becomes `prev` (`res.swapFrames()`), and the cache is available next frame.
 *
 * Loose shader parameters go through one uniform buffer of 256-byte slots (dynamic offsets) written
 * with `queue.writeBuffer` at encode time: encode at most one frame per submit. The per-page kernels
 * replay `frame.perPageBins`, built and uploaded by the page marking (`markingPass.ts`).
 *
 * Not here (other steps): the clears of the page marking (page table / flags / request flags,
 * page rect bounds which also resets the list counters, raster marks, stats), the next-map data
 * upload, the CPU side of the feedback, the depth pyramid itself.
 */
import { VSM_GROUP_WIDTH } from './constants.ts'
import { vsmPageManagementKernels } from './pageManagementWgsl.ts'
import { vsmComputePipe, vsmDynamicUniformEntry, type VsmComputePipe } from './passKit.ts'
import type { VsmPerPageBin } from './markingPass.ts'
import {
  VSM_PER_PAGE_DISPATCHER_BYTES,
  VsmPerPageDispatcher,
  vsmPerPageDispatchEntries,
} from './perPageDispatch.ts'
import {
  VSM_PM_GROUP_PARAMS,
  VSM_PM_GROUP_PER_PAGE,
  VSM_PM_GROUP_RESOURCES,
  VSM_PM_PARAMS_BYTES,
  type VsmPmKernel,
  vsmPhysicalPageKernels,
} from './physicalPagesWgsl.ts'
import { type VsmResources, vsmBindGroupEntries, vsmBindGroupLayoutEntries } from './resources.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import type { VsmLayout } from './layout.ts'

/** Options of the page management passes. */
interface VsmPageManagementOptions {
  /** Stats permutation (one more storage buffer: eight at most in a kernel). Fixed at first use per
   *  `res`. */
  stats?: boolean
}

export interface VsmPageManagementFrame {
  device: GPUDevice
  /** Full + single-page maps this frame. Nothing runs at 0. */
  mapCount: number
  /** Full maps this frame: the mapped-mip propagation only runs when > 0. */
  fullMapCount: number
  /** This frame's per-page dispatcher bins (`VsmMarkingFrame.perPage.all`, ids already in `res.perPageIds`). */
  perPageBins?: readonly VsmPerPageBin[]
  /** Entries uploaded to `res.nextMaps`, for the page address remap. */
  nextMapCount?: number
  options?: VsmPageManagementOptions
}

const SLOT = 256
const SLOT_MAIN = 0
const SLOT_ADDRESSES = 1
const SLOT_COUNT = 2
/** Cleared indirect arguments: three 4-word sets. */
const ARGS_INIT_BYTES = 48

type Kernels = ReturnType<typeof vsmPhysicalPageKernels> &
  ReturnType<typeof vsmPageManagementKernels>
type KernelName = keyof Kernels

/** A kernel's pipe (`vsmPageManagementPipes`) and its group 0 over each frame set. */
interface Pipe {
  kernel: VsmPmKernel
  pipe: VsmComputePipe
  groups: [GPUBindGroup | undefined, GPUBindGroup | undefined]
}

interface Ctx {
  device: GPUDevice
  stats: boolean
  pipes: Record<KernelName, Pipe>
  params: GPUBuffer
  /** The CPU image of `params`, every slot at its own offset. */
  paramsU32: Uint32Array<ArrayBuffer>
  paramsGroup: GPUBindGroup
  argsInit: GPUBuffer
  dispatcher: VsmPerPageDispatcher
}

const contexts = new WeakMap<VsmResources, Ctx>()

/** Bytes a set's page management context holds on the device: its parameter slots, its per-page
 *  dispatch slots and its cleared indirect arguments. */
export const VSM_PM_CONTEXT_BYTES =
  SLOT * SLOT_COUNT + VSM_PER_PAGE_DISPATCHER_BYTES + ARGS_INIT_BYTES

/** Frees the page management context of `res`, with the set (`destroyEngineVsm`). */
export function releaseVsmPageManagement(res: VsmResources) {
  const ctx = contexts.get(res)
  if (!ctx) return
  ctx.params.destroy()
  ctx.argsInit.destroy()
  ctx.dispatcher.destroy()
  contexts.delete(res)
}
/** The tables of `res` grew (`growVsmTables`): its groups bind them again, its pipelines, state
 *  and parameters kept. */
export function rebindVsmPageManagement(res: VsmResources) {
  const ctx = contexts.get(res)
  if (!ctx) return
  for (const pipe of Object.values(ctx.pipes)) pipe.groups = [undefined, undefined]
  ctx.dispatcher.rebind(res)
}
/** The parameters' group: one dynamic slot of `VsmPmParams`. */
const paramsEntries = () => [vsmDynamicUniformEntry(0, VSM_PM_PARAMS_BYTES)]

/** Every page management kernel of `layout` and its pipe, made once a device and source
 *  (`vsmComputePipe`): its tables' group, the parameters' and, per page, the dispatch setup's. */
export function vsmPageManagementPipes(device: GPUDevice, layout: VsmLayout, stats: boolean) {
  const kernels: Kernels = {
    ...vsmPhysicalPageKernels(layout, { stats }),
    ...vsmPageManagementKernels(layout),
  }
  const pipes = {} as Record<KernelName, { kernel: VsmPmKernel; pipe: VsmComputePipe }>
  for (const name of Object.keys(kernels) as KernelName[]) {
    const kernel = kernels[name]
    const groups: GPUBindGroupLayoutEntry[][] = []
    groups[VSM_PM_GROUP_RESOURCES] = vsmBindGroupLayoutEntries(
      kernel.specs,
      layout,
      GPUShaderStage.COMPUTE,
    )
    groups[VSM_PM_GROUP_PARAMS] = paramsEntries()
    if (kernel.perPage) groups[VSM_PM_GROUP_PER_PAGE] = vsmPerPageDispatchEntries()
    const label = `vsm.pm.${kernel.label}`
    pipes[name] = {
      kernel,
      pipe: vsmComputePipe(device, label, kernel.code, kernel.entryPoint, groups),
    }
  }
  return pipes
}

function context(res: VsmResources, frame: VsmPageManagementFrame): Ctx {
  const stats = !!frame.options?.stats
  const existing = contexts.get(res)
  if (existing && existing.device === frame.device && existing.stats === stats) return existing
  const device = frame.device
  const dispatcher = new VsmPerPageDispatcher(device, res)
  // The pipes' parameter groups are made of the same entries: this one's group binds to each.
  const paramsLayout = device.createBindGroupLayout({
    label: 'vsm.pm.params',
    entries: paramsEntries(),
  })
  const params = device.createBuffer({
    label: 'vsm.pm.params',
    size: SLOT * SLOT_COUNT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const paramsGroup = device.createBindGroup({
    label: 'vsm.pm.params',
    layout: paramsLayout,
    entries: [{ binding: 0, resource: { buffer: params, offset: 0, size: VSM_PM_PARAMS_BYTES } }],
  })
  // Cleared indirect args: initialize and tile depths (16, 0, 1, 0); post-process merge (16, 0, 1, 0)
  // + filter set (0, 1, 1, 0).
  const argsInit = device.createBuffer({
    label: 'vsm.pm.argsInit',
    size: ARGS_INIT_BYTES,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(argsInit, 0, new Uint32Array([16, 0, 1, 0, 16, 0, 1, 0, 0, 1, 1, 0]))

  const pipes = {} as Record<KernelName, Pipe>
  for (const [name, made] of Object.entries(vsmPageManagementPipes(device, res.layout, stats)))
    pipes[name as KernelName] = { ...made, groups: [undefined, undefined] }
  existing?.params.destroy()
  existing?.argsInit.destroy()
  existing?.dispatcher.destroy()
  const ctx: Ctx = {
    device,
    stats,
    pipes,
    params,
    paramsU32: new Uint32Array((SLOT * SLOT_COUNT) / 4),
    paramsGroup,
    argsInit,
    dispatcher,
  }
  contexts.set(res, ctx)
  return ctx
}

/** Group 0 of `pipe` for the current frame parity (rebuilt lazily after `swapFrames`). */
function group0(ctx: Ctx, res: VsmResources, pipe: Pipe) {
  const parity = res.current === res.frames[0] ? 0 : 1
  let g = pipe.groups[parity]
  if (!g) {
    g = ctx.device.createBindGroup({
      label: `vsm.pm.${pipe.kernel.label}.${parity}`,
      layout: pipe.pipe.groups[VSM_PM_GROUP_RESOURCES],
      entries: vsmBindGroupEntries(res, pipe.kernel.specs),
    })
    pipe.groups[parity] = g
  }
  return g
}

/** Writes slots [first, end) only: each encoder owns its slots, so encoders sharing a submit never clobber each other. */
function writeParams(
  ctx: Ctx,
  frame: VsmPageManagementFrame,
  cacheValid: boolean,
  first: number,
  end: number,
) {
  const words = SLOT / 4
  const u = ctx.paramsU32
  for (let s = first; s < end; s++) {
    const b = s * words
    u[b + 0] = frame.nextMapCount ?? 0
    u[b + 1] = cacheValid ? 1 : 0
  }
  ctx.device.queue.writeBuffer(
    ctx.params,
    first * SLOT,
    u.buffer,
    first * SLOT,
    (end - first) * SLOT,
  )
}

function bind(
  ctx: Ctx,
  res: VsmResources,
  pass: GPUComputePassEncoder,
  name: KernelName,
  slot: number,
) {
  const pipe = ctx.pipes[name]
  pass.setPipeline(pipe.pipe.pipeline)
  pass.setBindGroup(VSM_PM_GROUP_RESOURCES, group0(ctx, res, pipe))
  pass.setBindGroup(VSM_PM_GROUP_PARAMS, ctx.paramsGroup, [slot * SLOT])
}

function run(
  ctx: Ctx,
  res: VsmResources,
  pass: GPUComputePassEncoder,
  name: KernelName,
  slot: number,
  groups: number,
) {
  bind(ctx, res, pass, name, slot)
  // One group, or ⌈poolPages / 256⌉: at most 512, the pool under 2¹⁷ pages — a page table entry
  // holds a physical page's row in 10 bits, 128 pages a row (`vsmPackTableEntry`).
  pass.dispatchWorkgroups(groups)
}

function runPerPage(ctx: Ctx, res: VsmResources, pass: GPUComputePassEncoder, name: KernelName) {
  bind(ctx, res, pass, name, SLOT_MAIN)
  ctx.dispatcher.encode(pass, VSM_PM_GROUP_PER_PAGE)
}

/**
 * Remaps the persistent page metadata to this frame's ids
 * (`res.nextMaps`, `frame.nextMapCount` entries), applies clipmap panning, ORs the previous request
 * flags' invalidation bits, in `pass` (the page marking's, before its clears). Needs
 * `res.current.uniforms` written for this frame.
 */
export function encodeVsmPageCarry(
  pass: GPUComputePassEncoder,
  res: VsmResources,
  frame: VsmPageManagementFrame,
) {
  if (frame.mapCount === 0 && !frame.nextMapCount) return
  const ctx = context(res, frame)
  const cacheValid = res.prevFrameKept
  writeParams(ctx, frame, cacheValid, SLOT_ADDRESSES, SLOT_ADDRESSES + 1)
  run(ctx, res, pass, 'carryPages', SLOT_ADDRESSES, ceilDiv(res.layout.poolPages, VSM_GROUP_WIDTH))
}

/**
 * Builds the page allocations of the frame. A page marked and not held takes an empty physical page
 * first, then the one wanted least recently among those holding cached data; a page this frame's
 * marking asked for keeps its physical page and is never taken.
 */
export function encodeVsmPageMapping(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  frame: VsmPageManagementFrame,
) {
  if (frame.mapCount === 0) return
  const ctx = context(res, frame)
  const cacheValid = res.prevFrameKept
  writeParams(ctx, frame, cacheValid, SLOT_MAIN, SLOT_ADDRESSES)
  ctx.dispatcher.setBins(frame.perPageBins ?? [])
  const maxGroups = ceilDiv(res.layout.poolPages, VSM_GROUP_WIDTH)
  // The indirect dispatch args, 1D, in (16, pages, 1) form.
  encoder.copyBufferToBuffer(ctx.argsInit, 0, res.clearArgs, 0, 16)

  const pass = encoder.beginComputePass({ label: 'vsm.pageMapping' })
  // Update cached or newly invalidated pages against the new requests.
  run(ctx, res, pass, 'sortPool', SLOT_MAIN, maxGroups)
  // The available pages compacted, the newly empty ones at their end: allocated before the pages
  // holding cached data.
  run(ctx, res, pass, 'packFreePages', SLOT_MAIN, 1)
  runPerPage(ctx, res, pass, 'grantPages')
  run(ctx, res, pass, 'pageFlagPyramid', SLOT_MAIN, maxGroups)
  if (frame.fullMapCount > 0) runPerPage(ctx, res, pass, 'fillCoarserFallbacks')
  run(ctx, res, pass, 'listClears', SLOT_MAIN, maxGroups)
  bind(ctx, res, pass, 'clearPages', SLOT_MAIN)
  pass.dispatchWorkgroupsIndirect(res.clearArgs, 0)
  // The feedback, then the remaining available pages back into the sorted list for next frame.
  run(ctx, res, pass, 'poolFeedback', SLOT_MAIN, 1)
  pass.end()
}

/** After the render: fold dirty flags, merge static into dynamic; then, where slice 0 changed,
 *  the pages' tile depths the sun's rays test (their selection and dispatch). */
export function encodeVsmAfterRaster(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  frame: VsmPageManagementFrame,
) {
  if (frame.mapCount === 0) return
  const ctx = context(res, frame)
  const maxGroups = ceilDiv(res.layout.poolPages, VSM_GROUP_WIDTH)
  // The indirect dispatch args: merge set in (16, pages, 1) form, filter set (0, 1, 1).
  encoder.copyBufferToBuffer(ctx.argsInit, 16, res.mergeArgs, 0, 32)
  // The tile depths' pages in (16, pages, 1) form.
  encoder.copyBufferToBuffer(ctx.argsInit, 0, res.tileArgs, 0, 16)
  const pass = encoder.beginComputePass({ label: 'vsm.afterRaster' })
  run(ctx, res, pass, 'foldRasterMarks', SLOT_MAIN, maxGroups)
  bind(ctx, res, pass, 'mergeStatic', SLOT_MAIN)
  pass.dispatchWorkgroupsIndirect(res.mergeArgs, 0)
  bind(ctx, res, pass, 'tileDepthsBuild', SLOT_MAIN)
  pass.dispatchWorkgroupsIndirect(res.tileArgs, 0)
  pass.end()
}

/**
 * The frame data extraction, page-management part. `mapsGranted` = this frame allocated maps; without it the previous buffers are dropped.
 */
export function keepVsmFrame(res: VsmResources, { mapsGranted }: { mapsGranted: boolean }) {
  if (!mapsGranted) {
    res.prevFrameKept = false
    return
  }
  res.swapFrames()
  // The physical page lists and the page requests are only extracted with caching on.
  res.prevFrameKept = res.layout.staticSlice !== 0
}
