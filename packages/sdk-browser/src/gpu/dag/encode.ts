import { SELECTION_WORKGROUP as WORKGROUP } from '../core/selection.ts'
import type { createDagResources } from './resources.ts'
import { dispatchGrid, groupWidth } from './shader/gridWgsl.ts'
import { DAG_ARGS } from './shader/armWgsl.ts'
import { differenceGroups } from './shader/differenceWgsl.ts'

/** The cut's resources, as it encodes them. */
export type DagView = NonNullable<Awaited<ReturnType<typeof createDagResources>>>

const DAG_PASS: GPUComputePassDescriptor = { label: 'Trillion3D DAG selection' }

/**
 * Cut kernels, encoded in order, in ONE compute pass. Each dispatch waits for the previous — the
 * GPU empties its queue and caches between two —, and that wait is attributed to no kernel: it is
 * the number of dispatches that fixes it, not their size. So only what the dependencies actually
 * require remains: prepare carries thresholds, planes and block counts in one go, the live list's
 * group count holds as additions come, and the mask itself counts the drawn of its block.
 *
 * Three lists have no bound the layout knows — the previous frame's drawn journal, the candidates,
 * the live clusters —, so the kernels that walk them dispatch indirectly, on a group count the
 * kernel that filled the list wrote in `work`. WebGPU refuses, in one dispatch, an argument
 * buffer that a group its pipeline uses binds writable, and `work` is: the arming kernel copies
 * the counts into `dispatchArgs`, which only its own group binds (`shader/armWgsl.ts`), as a
 * dispatch of the same pass: arming by a copy outside a pass would cut it in three, and a pass
 * behind an off-pass copy costs about seventeen times a dispatch in the open pass (the measurement
 * next to `hierarchyLevelSizes`, `hierarchy.ts`).
 *
 * Not that the three lists have no upper bound: `pageCount` is one for all. It is COARSE,
 * 1,959,792 for 21,955 useful on the twelve-instance bench, when a level's stage hugs its queue:
 * an armed count is traded against threads, and the trade only pays if the bound is tight.
 */
export function encodeDagKernels(encoder: GPUCommandEncoder, resources: DagView, differ = false) {
  // A DIAGNOSTIC variant alone re-encodes the cut. The repeat PRECEDES the cut that counts: each
  // kernel restarts from the clear, the final state is therefore that of a single run, and the
  // frame delta measures what the repeat actually cost — waits between dispatches included, which
  // no pass envelope reports.
  if (resources.repeat) {
    encodeOnce(encoder, resources, resources.repeat === 'head', true)
    encodeOnce(encoder, resources, false, false, differ)
    return
  }
  encodeOnce(encoder, resources, false, true, differ)
}

/**
 * The cut's difference against the snapshot last copied, then this one kept in its place
 * (`shader/differenceWgsl.ts`): what a dispatch that copies a snapshot encodes before the copy,
 * in the cut's last pass when it cuts. Flat dispatches, bounded by the list: their
 * lengths are the GPU's, and an arming copy would cut the pass.
 */
function encodeDifference(pass: GPUComputePassEncoder, resources: DagView) {
  const width = groupWidth(resources.device?.limits),
    groups = differenceGroups(resources.listCap)
  pass.setPipeline(resources.differencePipeline)
  pass.dispatchWorkgroups(...dispatchGrid(groups, width))
  pass.setPipeline(resources.keepPipeline)
  pass.dispatchWorkgroups(...dispatchGrid(groups, width))
}

/** A dispatch that copies the snapshot in hand without cutting: its difference in a pass of its
 *  own, on the bind group every range shares `out` and `work` in. */
export function encodeDagDifference(encoder: GPUCommandEncoder, resources: DagView) {
  const pass = encoder.beginComputePass(DAG_PASS)
  pass.setBindGroup(0, resources.ranges[0].bindGroup)
  encodeDifference(pass, resources)
  pass.end()
}

function encodeOnce(
  encoder: GPUCommandEncoder,
  resources: DagView,
  headOnly: boolean,
  clear: boolean,
  differ = false,
) {
  const {
    residentCut,
    blockCount,
    levelSizes,
    dispatchArgs,
    ranges,
    preparePipeline,
    clearDrawnPipeline,
    rootLevelPipeline,
    levelPipelines,
    wantedPipeline,
    maskPipeline,
    drawPrefixPipeline,
    drawScatterPipeline,
    requestSortPipeline,
    evictPipeline,
  } = resources
  // Flat dispatches run in rows of the device's width (`shader/gridWgsl.ts`).
  const width = groupWidth(resources.device?.limits)
  const pass = encoder.beginComputePass(DAG_PASS)
  // Previous frame's drawn pages, and they alone, take their flag back to zero: no more walk of
  // every flag, and the prepare that follows clears the journal.
  if (clear) {
    arm(pass, resources)
    pass.setPipeline(clearDrawnPipeline)
    pass.dispatchWorkgroupsIndirect(dispatchArgs, DAG_ARGS.drawn)
  } else pass.setBindGroup(0, ranges[0].bindGroup)
  // The first range's dispatch also resets the block counts.
  perRange(pass, ranges, preparePipeline, width, 0, 1, blockCount)
  // The whole descent in THIS pass: dispatches of the same pass run in order and see what the
  // previous ones wrote — prepare and pass 0 already depended on that.
  //
  // Pass 0 starts from one root per primitive: each range's count of primitives and NOT
  // `levelSizes[0]`, which would not always bound it: `dagPrepare` puts one entry per primitive,
  // missing root included — pass 0 reads it there and rejects it —, where stage zero only counts
  // roots that exist. A primitive whose caller supplies an empty hierarchy would make the two
  // diverge. Each range reads its own roots; a deeper level mixes them, so each range walks the
  // level's whole queue and keeps its own primitives' nodes.
  perRange(pass, ranges, rootLevelPipeline, width, 0, 1)
  // Each following level reads only the nodes the previous one kept, and fills the next of the
  // three queues — the one a level earlier cleared. The dispatched count is that of its stage's
  // nodes, an upper bound the layout knows, never more than its queue holds.
  for (let level = 1; level < levelSizes.length; level++) {
    const pipeline = levelPipelines[level % levelPipelines.length]
    perRange(pass, ranges, pipeline, width, Math.min(levelSizes[level], resources.nodeCount))
  }
  // Pages of kept leaves, and they alone: a page under a rejected node is not read.
  arm(pass, resources)
  perRangeIndirect(pass, ranges, wantedPipeline, dispatchArgs, DAG_ARGS.cand)
  if (headOnly) {
    pass.end()
    return
  }
  arm(pass, resources)
  // These kernels visit only live clusters, those `dagWanted` has just listed: their verdict is
  // the previous one, it is not spoken on those it said nothing about.
  perRangeIndirect(pass, ranges, maskPipeline, dispatchArgs, DAG_ARGS.live)
  // The drawable-page list is compacted here, in increasing order: the snapshot
  // reports not one flag per page but the count alone and its ranks.
  // Then the camera's requests, staged by `dagWanted`, go into the snapshot sorted by rank: one
  // workgroup, in the same pass (`shader/snapshotWgsl.ts`).
  // Last, once every page this cut uses is stamped, the eviction queue (`shader/evictWgsl.ts`).
  if (residentCut) {
    pass.setPipeline(drawPrefixPipeline)
    pass.dispatchWorkgroups(1)
    pass.setPipeline(drawScatterPipeline)
    pass.dispatchWorkgroupsIndirect(dispatchArgs, DAG_ARGS.live)
  }
  pass.setPipeline(requestSortPipeline)
  pass.dispatchWorkgroups(1)
  if (residentCut) {
    pass.setPipeline(evictPipeline)
    pass.dispatchWorkgroups(1)
  }
  if (differ) encodeDifference(pass, resources)
  pass.end()
}

/**
 * Every list's argument copied from `work` (`shader/armWgsl.ts`), then the first range's group
 * back in place: the kernels that follow bind it, and a range's own when there are several
 * (`perRange`).
 */
function arm(pass: GPUComputePassEncoder, { armPipeline, armGroup, ranges }: DagView) {
  pass.setPipeline(armPipeline)
  pass.setBindGroup(0, armGroup)
  pass.dispatchWorkgroups(1)
  pass.setBindGroup(0, ranges[0].bindGroup)
}

/**
 * The kernels that read a primitive's words run once per range of `frames`, each under its
 * range's bind group, on its range's primitives (`frameRanges.ts`): `threads`, plus `perPrimitive`
 * per primitive of the range, at least `firstFloor` on the first, in rows of `width` workgroups.
 * One range: the commands of before.
 */
function perRange(
  pass: GPUComputePassEncoder,
  ranges: DagView['ranges'],
  pipeline: GPUComputePipeline,
  width: number,
  threads: number,
  perPrimitive = 0,
  firstFloor = 0,
) {
  pass.setPipeline(pipeline)
  for (let r = 0; r < ranges.length; r++) {
    if (ranges.length > 1) pass.setBindGroup(0, ranges[r].bindGroup)
    const count = Math.max(threads + perPrimitive * ranges[r].count, r ? 0 : firstFloor)
    const [x, y] = dispatchGrid(Math.max(1, Math.ceil(count / WORKGROUP)), width)
    pass.dispatchWorkgroups(x, y)
  }
}

/** A list kernel once per range, each indirect on the armed record at `offset` of `args`. */
function perRangeIndirect(
  pass: GPUComputePassEncoder,
  ranges: DagView['ranges'],
  pipeline: GPUComputePipeline,
  args: GPUBuffer,
  offset: number,
) {
  pass.setPipeline(pipeline)
  for (let r = 0; r < ranges.length; r++) {
    if (ranges.length > 1) pass.setBindGroup(0, ranges[r].bindGroup)
    pass.dispatchWorkgroupsIndirect(args, offset)
  }
}
