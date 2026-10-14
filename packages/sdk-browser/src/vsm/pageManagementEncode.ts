/**
 * Pass encoders of physical page management, in this order:
 * - `encodeVsmPageCarry`: the physical page address update, the first dispatch of
 *   the page marking's pass, which the frame opens (`vsmEncode.ts`).
 * - `encodeVsmPageMapping`: the page allocation build, after marking.
 * - `encodeVsmAfterRaster`: the post-render pass, after the shadow depth raster.
 * - `keepVsmFrame`: the page-management part of the frame data extraction: the frame just
 *   rendered becomes `prev` (`res.swapFrames()`), and the cache is available next frame.
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
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { writeChangedSlots } from '../gpu/core/writeChanged.ts'
import { VSM_PASS_PREFIX } from '../stage/passLabels.ts'
import { encodePoolSort } from '../gpu/pool/sort.ts'
import { groupWidth } from '../gpu/dispatch/grid.ts'
import {
  SLOT_ADDRESSES,
  SLOT_MAIN,
  vsmPageManagementContext,
  type KernelName,
  type Pipe,
  type VsmPageManagementContext,
  type VsmPageManagementFrame,
} from './pageManagementPass.ts'

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
    cacheValid = res.prevFrameKept
  for (let s = first; s < end; s++) {
    const b = s * slots.strideWords
    u[b + 0] = frame.nextMapCount ?? 0
    u[b + 1] = cacheValid ? 1 : 0
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
  pass.setPipeline(pipe.pipe.pipeline)
  pass.setBindGroup(VSM_PM_GROUP_RESOURCES, group0(ctx, res, pipe))
  pass.setBindGroup(VSM_PM_GROUP_PARAMS, ctx.paramsGroup, ctx.slots.offset(slot))
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
  bind(ctx, res, pass, name, slot)
  pass.dispatchWorkgroups(groups)
}

function runPerPage(
  ctx: VsmPageManagementContext,
  res: VsmResources,
  pass: GPUComputePassEncoder,
  name: KernelName,
) {
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
  encoder: GPUCommandEncoder,
  res: VsmResources,
  frame: VsmPageManagementFrame,
) {
  if (frame.mapCount === 0) return
  const ctx = vsmPageManagementContext(res, frame)
  writeParams(ctx, res, frame, SLOT_MAIN, SLOT_ADDRESSES)
  ctx.dispatcher.setBins(frame.perPageBins ?? [])
  // The indirect dispatch args, 1D, in (16, pages, 1) form.
  encoder.copyBufferToBuffer(ctx.argsInit, 0, res.clearArgs, 0, 16)

  const pass = encoder.beginComputePass({ label: `${VSM_PASS_PREFIX}pageMapping` })
  // Update cached or newly invalidated pages against the new requests.
  run(ctx, res, pass, 'keepPages', SLOT_MAIN)
  // The free pages in the pool rank's order: the stages share `poolCount`'s group 0.
  bind(ctx, res, pass, 'poolCount', SLOT_MAIN)
  encodePoolSort(pass, ctx.poolSort, res.layout.poolPages, groupWidth(ctx.device.limits))
  runPerPage(ctx, res, pass, 'grantPages')
  run(ctx, res, pass, 'pageFlagPyramid', SLOT_MAIN)
  if (frame.fullMapCount > 0) runPerPage(ctx, res, pass, 'fillCoarserFallbacks')
  run(ctx, res, pass, 'listClears', SLOT_MAIN)
  bind(ctx, res, pass, 'clearPages', SLOT_MAIN)
  pass.dispatchWorkgroupsIndirect(res.clearArgs, 0)
  // The feedback: the free pages left.
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
  const ctx = vsmPageManagementContext(res, frame)
  // The indirect dispatch args: merge set in (16, pages, 1) form, filter set (0, 1, 1).
  encoder.copyBufferToBuffer(ctx.argsInit, 16, res.mergeArgs, 0, 32)
  // The tile depths' pages in (16, pages, 1) form.
  encoder.copyBufferToBuffer(ctx.argsInit, 0, res.tileArgs, 0, 16)
  const pass = encoder.beginComputePass({ label: `${VSM_PASS_PREFIX}afterRaster` })
  run(ctx, res, pass, 'foldRasterMarks', SLOT_MAIN)
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
