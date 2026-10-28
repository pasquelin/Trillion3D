/**
 * Pass encoders of physical page management, in this order:
 * - `encodeVsmPageCarry`: the physical page address update, the first dispatch of
 *   the page marking's pass, which the frame opens (`vsmEncode.ts`).
 * - `encodeVsmPageMapping`: the page allocation build, after marking.
 * - `encodeVsmAfterRaster`: the post-render pass, after the shadow depth raster, with the prefiltered
 *   distant shadow's filters.
 * - `keepFilterableHistory`, `keepVsmFrame`: the page-management part of the frame data extraction:
 *   the prefiltered distant shadow's history is copied, the frame just rendered becomes `prev`
 *   (`res.swapFrames()`), and the cache is available next frame; its kept tables are the occlusion's
 *   previous ones (`keepOcclusionFrame`).
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
import {
  VSM_GROUP_WIDTH,
  VSM_LEVEL0_PAGES,
  VSM_PAGE_LIST,
  VSM_PAGE_TABLE_BLOCK_HEIGHT,
  VSM_PROJECTION_RECORD_BYTES,
} from './constants.ts'
import {
  VSM_FILTER_ARGS_BORDER,
  VSM_FILTER_ARGS_MERGE,
  VSM_FILTER_ARGS_SEPARABLE,
  VSM_FILTER_ARGS_SET_WORDS,
  vsmHistoryLayout,
} from './prefilteredConstants.ts'
import {
  VSM_PM_GROUP_PARAMS,
  VSM_PM_GROUP_PER_PAGE,
  VSM_PM_GROUP_RESOURCES,
} from './physicalPagesWgsl.ts'
import { type VsmResources, vsmBindGroupEntries, vsmFrameParity } from './resources.ts'
import type { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { writeChangedSlots } from '../../../gpu/core/writeChanged.ts'
import { VSM_PASS_PREFIX } from '../../../diagnostic/stage/passLabels.ts'
import { keepOcclusionFrame } from './occlusion/occlusionPass.ts'
import { keepVsmThrottle } from './throttle.ts'
import {
  SLOT_ADDRESSES,
  SLOT_APPEND_AVAILABLE,
  SLOT_APPEND_EMPTY,
  SLOT_MAIN,
  vsmPageManagementContext,
  type KernelName,
  type Pipe,
  type VsmPageManagementContext,
  type VsmPageManagementFrame,
} from './pageManagementPass.ts'

const MAPPING_PASS: GPUComputePassDescriptor = { label: `${VSM_PASS_PREFIX}pageMapping` }
const AFTER_RASTER_PASS: GPUComputePassDescriptor = { label: `${VSM_PASS_PREFIX}afterRaster` }
const FILTERABLE_PASS: GPUComputePassDescriptor = { label: `${VSM_PASS_PREFIX}filterable` }

/** Group 0 of `pipe` for the current frame parity (rebuilt lazily after `swapFrames`). */
function group0(ctx: VsmPageManagementContext, res: VsmResources, pipe: Pipe) {
  const parity = vsmFrameParity(res)
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

/** The lists the appends' slots copy from and to. */
const APPENDS: Record<number, readonly [number, number]> = {
  [SLOT_APPEND_EMPTY]: [VSM_PAGE_LIST.empty, VSM_PAGE_LIST.available],
  [SLOT_APPEND_AVAILABLE]: [VSM_PAGE_LIST.available, VSM_PAGE_LIST.requested],
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
    { lruAllocation, fullClears, skipDynamicInvalidation } = frame.options
  for (let s = first; s < end; s++) {
    const b = s * slots.strideWords
    u[b + 0] = frame.nextMapCount ?? 0
    u[b + 1] = cacheValid ? 1 : 0
    u[b + 2] = lruAllocation ? 1 : 0
    u[b + 3] = fullClears ? 1 : 0
    u[b + 4] = skipDynamicInvalidation ? 1 : 0
    const [from, to] = APPENDS[s] ?? [0, 0]
    u[b + 5] = from
    u[b + 6] = to
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

/** Runs the per-page kernel `name` over the dispatcher's bins, the suns' alone with `directional`. */
function runPerPage(
  ctx: VsmPageManagementContext,
  res: VsmResources,
  pass: GPUComputePassEncoder,
  name: KernelName,
  directional = false,
) {
  if (bind(ctx, res, pass, name, SLOT_MAIN))
    ctx.dispatcher.encode(pass, VSM_PM_GROUP_PER_PAGE, directional)
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
 * Builds the page allocations of the frame. A page marked and not held takes the last of the
 * available pages (`freePagesWgsl.ts`): an empty page, then the one left unrequested longest; a page
 * this frame's marking asked for keeps its physical page and is never taken.
 */
export function encodeVsmPageMapping(
  steps: ComputeRun,
  res: VsmResources,
  frame: VsmPageManagementFrame,
) {
  if (frame.mapCount === 0) return
  const ctx = vsmPageManagementContext(res, frame)
  writeParams(ctx, res, frame, SLOT_MAIN, SLOT_ADDRESSES)
  ctx.dispatcher.setBins(frame.perPageBins ?? [], frame.directionalBins)
  const pass = steps.pass(MAPPING_PASS)
  // The requests of the sun's levels passed on to the coarser levels, for the prefiltered distant shadow.
  if (res.filterable?.active) runPerPage(ctx, res, pass, 'propagateFilterable', true)
  // The page lists reset, then the cached or newly invalidated pages updated against the new
  // requests: the pages asked or emptied leave the LRU list.
  run(ctx, res, pass, 'initPageLists', SLOT_MAIN, 1)
  run(ctx, res, pass, 'keepPages', SLOT_MAIN)
  // The pages left in the LRU list packed into the available ones, the empty pages after them.
  run(ctx, res, pass, 'packAvailable', SLOT_MAIN, 1)
  appendPages(ctx, res, pass, SLOT_APPEND_EMPTY)
  runPerPage(ctx, res, pass, 'grantPages')
  run(ctx, res, pass, 'pageFlagPyramid', SLOT_MAIN)
  runPerPage(ctx, res, pass, 'fillCoarserFallbacks')
  // The clears' arguments set to their empty form, then the pages to clear added to them.
  run(ctx, res, pass, 'resetClearArgs', SLOT_MAIN, 1)
  run(ctx, res, pass, 'listClears', SLOT_MAIN)
  if (bind(ctx, res, pass, 'clearPages', SLOT_MAIN))
    pass.dispatchWorkgroupsIndirect(res.clearArgs, 0)
  // The feedback: the free pages left.
  run(ctx, res, pass, 'poolFeedback', SLOT_MAIN, 1)
  // The pages left, after the feedback counts them, join the requested ones: next frame's order.
  appendPages(ctx, res, pass, SLOT_APPEND_AVAILABLE)
}

/** Appends one page list to another: the entries copied by a thread each, then, in a dispatch of its
 *  own, the counts. */
function appendPages(
  ctx: VsmPageManagementContext,
  res: VsmResources,
  pass: GPUComputePassEncoder,
  slot: number,
) {
  run(ctx, res, pass, 'appendCopy', slot)
  run(ctx, res, pass, 'appendCounts', slot, 1)
}

/** The clears' indirect dispatch arguments set to their empty form, 1D, (16, pages, 1), before the
 *  pass that lists the pages to merge (the one that lists the pages to clear resets them in its
 *  pass: `resetClearArgs`). */
export function resetVsmClearArgs(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  frame: VsmPageManagementFrame,
) {
  if (frame.mapCount === 0) return
  encoder.copyBufferToBuffer(vsmPageManagementContext(res, frame).argsInit, 0, res.clearArgs, 0, 16)
}

/** The prefiltered distant shadow's buffers made ready for the frame's filters, before the pass that
 *  lists the pages they process, in a frame with a map that holds it: the indirect arguments set to
 *  their empty form, and the pools the frame writes — the separate pool of its parity and the merged
 *  one — cleared. Every page of a pool is cleared: the merge down reads the pages of the coarser levels
 *  the table maps and the dynamic layer was written, listed or not, and the history is read where the
 *  previous table says secondary, a page the selection may have left out. */
export function resetVsmFilterable(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  frame: VsmPageManagementFrame,
) {
  const { filterable } = res
  if (!filterable?.active || frame.mapCount === 0) return
  encoder.copyBufferToBuffer(filterable.argsInit, 0, filterable.args, 0, filterable.args.size)
  encoder.clearBuffer(filterable.separate[vsmFrameParity(res)])
  encoder.clearBuffer(filterable.merged)
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
  // The prefiltered distant shadow's filters, in a frame with a map that holds it.
  if (res.filterable?.active) encodeVsmFilterable(steps, res, res.filterable, ctx)
}

/** The filters' kernels, each with the set of the arguments it is dispatched by: the separable passes
 *  and the border of their pool, then — over the merged pool, the temporary one's buffer — the merge
 *  down and its border. */
const SEPARABLE_CHAIN = [
  ['filterableX', VSM_FILTER_ARGS_SEPARABLE],
  ['filterableY', VSM_FILTER_ARGS_SEPARABLE],
  ['filterableBorder', VSM_FILTER_ARGS_BORDER],
] as const satisfies readonly (readonly [KernelName, number])[]
const MERGE_CHAIN = [
  ['filterableMergeDown', VSM_FILTER_ARGS_MERGE],
  ['filterableBorderMerged', VSM_FILTER_ARGS_BORDER],
] as const satisfies readonly (readonly [KernelName, number])[]

/** Filters the pages the selection listed, in a step of the run of their own, labelled apart on a
 *  frame timed per pass. The merged pool is cleared between the separable passes, which use it as
 *  their temporary pool, and the merge down. */
function encodeVsmFilterable(
  steps: ComputeRun,
  res: VsmResources,
  filterable: NonNullable<VsmResources['filterable']>,
  ctx: VsmPageManagementContext,
) {
  const dispatch = (chain: typeof SEPARABLE_CHAIN | typeof MERGE_CHAIN) => {
    const pass = steps.pass(FILTERABLE_PASS)
    for (const [name, set] of chain)
      if (bind(ctx, res, pass, name, SLOT_MAIN))
        pass.dispatchWorkgroupsIndirect(filterable.args, set * VSM_FILTER_ARGS_SET_WORDS * 4)
  }
  dispatch(SEPARABLE_CHAIN)
  steps.apart().clearBuffer(filterable.merged)
  dispatch(MERGE_CHAIN)
}

/**
 * The prefiltered distant shadow's history for the next frame of a frame with data, where `kept` (its
 * blend asks the history): the frame's projection records of the suns' maps, from the first sun map's
 * id `sunBase` (`VsmMapIds.sunBase`), the level-0 rows of its page
 * table that hold their blocks and its receiver cover's first level, copied into the history. Before
 * `keepVsmFrame`, whose swap makes the pool the filters wrote the next frame's history.
 */
export function keepFilterableHistory(
  res: VsmResources,
  kept: boolean,
  sunBase: number,
  encoder: GPUCommandEncoder,
) {
  const { filterable } = res
  if (!filterable) return
  filterable.historyValid = kept && filterable.active
  if (!filterable.historyValid) return
  const history = vsmHistoryLayout(res.layout)
  const { projectionData, pageTable, receiverCover } = res.current
  // The suns' records from the first sun map's, as many as the map slots leave.
  const records = Math.min(res.layout.sunMapSlots, res.layout.mapSlots - sunBase)
  encoder.copyBufferToBuffer(
    projectionData,
    sunBase * VSM_PROJECTION_RECORD_BYTES,
    filterable.history,
    history.recordsWord * 4,
    records * VSM_PROJECTION_RECORD_BYTES,
  )
  // Only the rows of level 0 are read: a block row holds them first, the other levels' below.
  const rowBytes = res.layout.pageTableSize[0] * 4
  const rows = history.tableWords / (VSM_PAGE_TABLE_BLOCK_HEIGHT * res.layout.pageTableSize[0])
  for (let row = 0; row < rows; row++) {
    const at = row * VSM_PAGE_TABLE_BLOCK_HEIGHT * rowBytes
    encoder.copyBufferToBuffer(
      pageTable,
      at,
      filterable.history,
      history.tableWord * 4 + at,
      VSM_LEVEL0_PAGES * rowBytes,
    )
  }
  encoder.copyBufferToBuffer(
    receiverCover,
    0,
    filterable.history,
    history.coverWord * 4,
    history.coverWords * 4,
  )
}

/** What the frame data extraction does with the frame: `'swap'`, the frame allocated maps and becomes
 *  the previous frame; `'keep'`, it brought no data and the previous frame stays; `'drop'`, the cache
 *  is dropped and the previous frame with it. */
type VsmFrameKeep = 'keep' | 'swap' | 'drop'

/**
 * The frame data extraction, page-management part (and the compute throttle's buffers), as the
 * reference's `ExtractFrameData` does it. A frame with no new data (`'keep'`) leaves every previous
 * buffer as it is, for the first light that returns (the CPU cache keeps its previous frame alike,
 * `keepFrameForNext`): the previous frame set (`prevFrameKept`), the occlusion's kept tables
 * (`keepOcclusionFrame`), the throttle's buffers (`keepVsmThrottle`) and, in the caller, the
 * prefiltered distant shadow's history (`keepFilterableHistory` runs on the frames with data alone).
 * `'drop'` forgets the previous frame, the prefiltered history with it; `'swap'` makes the frame
 * the previous one.
 */
export function keepVsmFrame(res: VsmResources, keep: VsmFrameKeep) {
  if (keep === 'keep') return
  const swap = keep === 'swap'
  keepOcclusionFrame(res, swap)
  keepVsmThrottle(res, swap)
  if (!swap) {
    res.prevFrameKept = false
    if (res.filterable) res.filterable.historyValid = false
    return
  }
  res.swapFrames()
  // The page requests are only extracted with caching on.
  res.prevFrameKept = res.layout.cacheEnabled
}
