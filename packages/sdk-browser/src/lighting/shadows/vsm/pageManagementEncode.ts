/**
 * Pass encoders of physical page management, in this order:
 * - `encodeVsmPageCarry`: the physical page address update, the first dispatch of
 *   the page marking's pass, which the frame opens (`vsmEncode.ts`).
 * - `encodeVsmPageMapping`: the page allocation build, after marking.
 * - `encodeVsmAfterRaster`: the post-render pass, after the shadow depth raster.
 * - `keepVsmFrame`: the page-management part of the frame data extraction: the frame just
 *   rendered becomes `prev` (`res.swapFrames()`), and the cache is available next frame; its kept
 *   tables are the occlusion's previous ones (`keepOcclusionFrame`).
 *
 * Loose shader parameters go through one uniform buffer of slots the device's `uniformStride` apart
 * (dynamic offsets) written with `queue.writeBuffer` at encode time: encode at most one frame per
 * submit. The per-page kernels
 * replay `frame.perPageBins`, built and uploaded by the page marking (`markingPass.ts`).
 *
 * Not here (other steps): the clears of the page marking (page table / flags / request flags,
 * page rect bounds, raster marks, stats), the next-map data
 * upload, the CPU side of the feedback, the depth pyramid itself.
 */
import { VSM_GROUP_WIDTH } from './constants.ts'
import {
  VSM_PM_GROUP_PARAMS,
  VSM_PM_GROUP_PER_PAGE,
  VSM_PM_GROUP_RESOURCES,
} from './physicalPagesWgsl.ts'
import { type VsmResources, vsmBindGroupEntries } from './resources.ts'
import type { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { writeChangedSlots } from '../../../gpu/core/writeChanged.ts'
import { VSM_PASS_PREFIX } from '../../../diagnostic/stage/passLabels.ts'
import { encodePoolSort } from '../../../gpu/sort/sort.ts'
import { keepOcclusionFrame } from './occlusion/occlusionPass.ts'
import { groupWidth } from '../../../gpu/dispatch/grid.ts'
import {
  SLOT_ADDRESSES,
  SLOT_MAIN,
  vsmPageManagementContext,
  type KernelName,
  type Pipe,
  type VsmPageManagementContext,
  type VsmPageManagementFrame,
} from './pageManagementPass.ts'

const MAPPING_PASS: GPUComputePassDescriptor = { label: `${VSM_PASS_PREFIX}pageMapping` }
const AFTER_RASTER_PASS: GPUComputePassDescriptor = { label: `${VSM_PASS_PREFIX}afterRaster` }

/** Group 0 of `pipe` for the current frame parity (rebuilt lazily after `swapFrames`). */
function group0(ctx: VsmPageManagementContext, res: VsmResources, pipe: Pipe) {
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

/** Writes slots [first, end) only: each encoder owns its slots, so encoders sharing a submit never
 *  clobber each other. The cache is valid when the previous frame was kept (`keepVsmFrame`). */
function writeParams(
  ctx: VsmPageManagementContext,
  res: VsmResources,
  frame: VsmPageManagementFrame,
  first: number,
  end: number,
) {
  const { slots, paramsU32: u } = ctx,
    cacheValid = res.prevFrameKept,
    { lruAllocation, fullClears } = frame.options
  for (let s = first; s < end; s++) {
    const b = s * slots.strideWords
    u[b + 0] = frame.nextMapCount ?? 0
    u[b + 1] = cacheValid ? 1 : 0
    u[b + 2] = lruAllocation ? 1 : 0
    u[b + 3] = fullClears ? 1 : 0
  }
  // What changed of the slots' structs, in one write: never the padding, never more writes than
  // the whole slots sent.
  writeChangedSlots(ctx.device, ctx.params, u, slots, first, end, 'one')
}

function bind(
  ctx: VsmPageManagementContext,
  res: VsmResources,
  pass: GPUComputePassEncoder,
  name: KernelName,
  slot: number,
) {
  const pipe = ctx.pipes[name]
  const pipeline = pipe.pipe.pipeline
  if (!pipeline) return false
  pass.setPipeline(pipeline)
  pass.setBindGroup(VSM_PM_GROUP_RESOURCES, group0(ctx, res, pipe))
  pass.setBindGroup(VSM_PM_GROUP_PARAMS, ctx.paramsGroup, ctx.slots.offset(slot))
  return true
}

/** Runs kernel `name` over `groups` groups: by default a thread a pool page, ⌈poolPages / 256⌉ —
 *  one row for the largest pool (`poolDispatch.test.ts`). */
function run(
  ctx: VsmPageManagementContext,
  res: VsmResources,
  pass: GPUComputePassEncoder,
  name: KernelName,
  slot: number,
  groups = ceilDiv(res.layout.poolPages, VSM_GROUP_WIDTH),
) {
  if (bind(ctx, res, pass, name, slot)) pass.dispatchWorkgroups(groups)
}

function runPerPage(
  ctx: VsmPageManagementContext,
  res: VsmResources,
  pass: GPUComputePassEncoder,
  name: KernelName,
) {
  if (bind(ctx, res, pass, name, SLOT_MAIN)) ctx.dispatcher.encode(pass, VSM_PM_GROUP_PER_PAGE)
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
  const ctx = vsmPageManagementContext(res, frame)
  writeParams(ctx, res, frame, SLOT_ADDRESSES, SLOT_ADDRESSES + 1)
  run(ctx, res, pass, 'carryPages', SLOT_ADDRESSES)
}

/**
 * Builds the page allocations of the frame. A page marked and not held takes the free page the pool
 * rank puts first (`freePagesWgsl.ts`): an empty page, then the one wanted longest ago, the finer
 * level first within an age step; a page this frame's marking asked for keeps its physical page and
 * is never taken.
 */
export function encodeVsmPageMapping(
  steps: ComputeRun,
  res: VsmResources,
  frame: VsmPageManagementFrame,
) {
  if (frame.mapCount === 0) return
  const ctx = vsmPageManagementContext(res, frame)
  writeParams(ctx, res, frame, SLOT_MAIN, SLOT_ADDRESSES)
  ctx.dispatcher.setBins(frame.perPageBins ?? [])
  const pass = steps.pass(MAPPING_PASS)
  // Update cached or newly invalidated pages against the new requests.
  run(ctx, res, pass, 'keepPages', SLOT_MAIN)
  // The free pages in the pool rank's order: the stages share `poolCount`'s group 0.
  bind(ctx, res, pass, 'poolCount', SLOT_MAIN)
  encodePoolSort(pass, ctx.poolSort, res.layout.poolPages, groupWidth(ctx.device.limits))
  runPerPage(ctx, res, pass, 'grantPages')
  run(ctx, res, pass, 'pageFlagPyramid', SLOT_MAIN)
  runPerPage(ctx, res, pass, 'fillCoarserFallbacks')
  run(ctx, res, pass, 'listClears', SLOT_MAIN)
  if (bind(ctx, res, pass, 'clearPages', SLOT_MAIN))
    pass.dispatchWorkgroupsIndirect(res.clearArgs, 0)
  // The feedback: the free pages left.
  run(ctx, res, pass, 'poolFeedback', SLOT_MAIN, 1)
}

/** The clears' indirect dispatch arguments set to their empty form, 1D, (16, pages, 1): before the
 *  pass that lists the pages to clear, and the one that lists the pages to merge. */
export function resetVsmClearArgs(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  frame: VsmPageManagementFrame,
) {
  if (frame.mapCount === 0) return
  encoder.copyBufferToBuffer(vsmPageManagementContext(res, frame).argsInit, 0, res.clearArgs, 0, 16)
}

/** After the render, after `resetVsmClearArgs` (the clears' list and arguments, empty again, list the
 *  pages to merge): fold the raster's dirty flags into the pages' metadata, then merge the static
 *  layer of the pages that drew it into their dynamic layer. */
export function encodeVsmAfterRaster(
  steps: ComputeRun,
  res: VsmResources,
  frame: VsmPageManagementFrame,
) {
  if (frame.mapCount === 0) return
  const ctx = vsmPageManagementContext(res, frame)
  const pass = steps.pass(AFTER_RASTER_PASS)
  run(ctx, res, pass, 'foldRasterMarks', SLOT_MAIN)
  // The static layer drawn this frame joins the dynamic one, which every reader samples.
  run(ctx, res, pass, 'selectMerges', SLOT_MAIN)
  if (bind(ctx, res, pass, 'mergePages', SLOT_MAIN))
    pass.dispatchWorkgroupsIndirect(res.clearArgs, 0)
}

/**
 * The frame data extraction, page-management part. `mapsGranted` = this frame allocated maps; without it the previous buffers are dropped.
 */
export function keepVsmFrame(res: VsmResources, { mapsGranted }: { mapsGranted: boolean }) {
  keepOcclusionFrame(res, mapsGranted)
  if (!mapsGranted) {
    res.prevFrameKept = false
    return
  }
  res.swapFrames()
  // The page requests are only extracted with caching on.
  res.prevFrameKept = res.layout.cacheEnabled
}
