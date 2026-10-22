import type { DagResources } from './resources.ts'
import { dispatchRows, groupWidth, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { DAG_ARGS } from './shader/armWgsl.ts'
import { DAG_PASS, encodeDifference } from './encodeDifference.ts'
import { BLOCK_MASK_WORDS } from './shader/floorWgsl.ts'
import { OCCLUSION_GROUP } from './shader/occlusionWgsl.ts'
import type { CutPyramid } from './occlusion.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { queueZeroEntries } from './flagSections.ts'

/**
 * Cut kernels, encoded in order, in ONE compute pass for each pass of the cut: the main pass, and,
 * when its occlusion runs two, the post pass in a second, once the image's first raster pass drew
 * (`encodeDagPost`). Each dispatch waits for the previous — the
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
 * dispatch of the same pass. A copy outside the pass would cut it in three, and a pass behind an
 * off-pass copy costs about seventeen times a dispatch in the open pass (the measurement next to
 * `hierarchyLevelSizes`, `hierarchy.ts`).
 *
 * Not that the three lists have no upper bound: `pageCount` is one for all. It is COARSE,
 * 1,959,792 for 21,955 useful on the twelve-instance bench, when a level's stage hugs its queue:
 * an armed count is traded against threads, and the trade only pays if the bound is tight.
 */
export function encodeDagKernels(
  encoder: GPUCommandEncoder,
  resources: DagResources,
  main: DagMainPass = {},
) {
  // A DIAGNOSTIC variant alone re-encodes the cut. The repeat PRECEDES the cut that counts: each
  // kernel restarts from the clear, the final state is therefore that of a single run, and the
  // frame delta measures what the repeat actually cost — waits between dispatches included, which
  // no pass envelope reports. A cut in two passes repeats its main pass alone: the post pass reads
  // the image's own raster.
  const group = resources.occlusion.group(main.pyramid)
  if (resources.repeat) {
    encodeMain(encoder, resources, group, resources.repeat === 'head', true, { post: main.post })
    encodeMain(encoder, resources, group, false, false, main)
    return
  }
  encodeMain(encoder, resources, group, false, true, main)
}

/** What the main pass is encoded for: whether a readback copies the cut (`differ`), whether a post
 *  pass follows (`post`, `encodeDagPost`), and the pyramid the main pass reads — the previous
 *  image's, when its occlusion runs in two passes (`OCCLUSION_TWO_PASS`); a blank one otherwise. A
 *  cut that feeds no streaming — the primed pyramid's — stamps no row (`stamp` false). */
export type DagMainPass = {
  differ?: boolean
  post?: boolean
  pyramid?: CutPyramid
  stamp?: boolean
}

/**
 * The main pass of the cut: the drawn journal cleared, the descent from the roots, the clusters of
 * its kept leaves, the draws. A cut in one pass finishes in the same compute pass (`encodeFinish`);
 * one in two commits the main pass's draws as the frame's mask — what the image's first raster pass
 * draws — and leaves the rest to the post pass (`encodeDagPost`).
 */
function encodeMain(
  encoder: GPUCommandEncoder,
  resources: DagResources,
  group: GPUBindGroup,
  headOnly: boolean,
  clear: boolean,
  main: DagMainPass,
) {
  const { post = false, differ = false } = main
  const {
    blockCount,
    dispatchArgs,
    bindGroup,
    preparePipeline,
    clearDrawnPipeline,
    levelPipelines,
    wantedPipeline,
  } = resources
  // Flat dispatches run in rows of the device's width.
  const width = groupWidth(resources.device?.limits)
  const pass = encoder.beginComputePass(DAG_PASS)
  pass.setBindGroup(OCCLUSION_GROUP, group)
  // Previous frame's drawn pages, and they alone, take their flag back to zero: no more walk of
  // every flag, and the prepare that follows clears the journal. The journal is saved on the way
  // for the view it was before, when the uniforms name its region (`swap/swap.ts`, `saveRegionFor`).
  if (clear) {
    arm(pass, resources)
    pass.setPipeline(clearDrawnPipeline)
    pass.dispatchWorkgroupsIndirect(dispatchArgs, DAG_ARGS.drawn)
  } else pass.setBindGroup(0, bindGroup)
  // Its dispatch also resets the block counts.
  flat(pass, preparePipeline, width, Math.max(levelEntries(resources), blockCount))
  // The whole descent in THIS pass: dispatches of the same pass run in order and see what the
  // previous ones wrote — prepare and pass 0 already depended on that.
  //
  // Pass 0 starts from one root per primitive: the count of primitives and NOT `levelSizes[0]`,
  // which would not always bound it: `dagPrepare` puts one entry per primitive, missing root
  // included — pass 0 reads it there and rejects it —, where stage zero only counts roots that
  // exist. A primitive whose caller supplies an empty hierarchy would make the two diverge.
  flat(pass, levelPipelines[0], width, levelEntries(resources))
  // Each following level reads only the nodes the previous one kept, behind them in the descent
  // array, counted on the next of the three slots — the one a level earlier cleared. Every level
  // past pass 0 is dispatched on what the level before it deposited, its slot's groups armed in the
  // pass (`shader/armWgsl.ts`): threads follow the view, never the world. No count the layout keeps
  // bounds a level: a member
  // drawn whatever the view opens from queue 0 (`shader/placementTreeWgsl.ts`), so its root's
  // children join level 1 beside the tree's own nodes, where the layout counts them levels lower.
  const levels = levelsDispatched(resources)
  for (let level = 1; level < levels; level++) levelPass(pass, resources, level)
  // Pages of kept leaves, and they alone: a page under a rejected node is not read.
  arm(pass, resources)
  pass.setPipeline(wantedPipeline)
  pass.dispatchWorkgroupsIndirect(dispatchArgs, DAG_ARGS.cand)
  if (headOnly) {
    pass.end()
    return
  }
  encodeDraws(pass, resources)
  if (post) {
    // The main pass's draws become the frame's mask before the first raster pass reads it.
    commit(pass, resources, width)
    pass.end()
    return
  }
  encodeFinish(pass, resources, width, differ, main.stamp)
  pass.end()
}

/**
 * The cut's POST PASS (`shader/postPassWgsl.ts`), into `encoder`, once the image's first raster
 * pass drew the main pass's clusters and `pyramid` was built from that depth: the items and the
 * clusters the previous image's pyramid hid are judged again against this one, the subtrees of the
 * items it shows descended level by level as the main pass descends them, and the clusters drawn
 * — in the frame's mask and in the post mask alone, which the second raster pass draws. Then the
 * cut is finished (`encodeFinish`), its readback's difference with it when one copies it.
 */
export function encodeDagPost(
  encoder: GPUCommandEncoder,
  resources: DagResources,
  pyramid: CutPyramid | undefined,
  differ: boolean,
) {
  const { dispatchArgs, bindGroup } = resources,
    width = groupWidth(resources.device?.limits)
  const pass = encoder.beginComputePass(DAG_PASS)
  pass.setBindGroup(0, bindGroup)
  pass.setBindGroup(OCCLUSION_GROUP, resources.occlusion.group(pyramid))
  pass.setPipeline(resources.postPreparePipeline)
  pass.dispatchWorkgroups(1)
  arm(pass, resources)
  pass.setPipeline(resources.postNodesPipeline)
  pass.dispatchWorkgroupsIndirect(dispatchArgs, DAG_ARGS.postNodes)
  pass.setPipeline(resources.postClustersPipeline)
  pass.dispatchWorkgroupsIndirect(dispatchArgs, DAG_ARGS.postClusters)
  // What it shows enters queue 0 at any depth: every level runs again on what the one before it
  // kept, from queue 0.
  const levels = levelsDispatched(resources)
  for (let level = 0; level < levels; level++) levelPass(pass, resources, level)
  arm(pass, resources)
  pass.setPipeline(resources.wantedPipeline)
  pass.dispatchWorkgroupsIndirect(dispatchArgs, DAG_ARGS.cand)
  encodeDraws(pass, resources)
  encodeFinish(pass, resources, width, differ)
  pass.end()
}

/** The levels the descent dispatches: those a resident page needs reached, never more than the
 *  hierarchies hold (`PackedDag.residentLevels`); all of them where no residency is followed. A
 *  level no resident page reaches is never dispatched — it could ask for no page a resident one
 *  does not bring within reach — and costs nothing. */
function levelsDispatched({ packed, levelSizes }: DagResources) {
  return Math.min(levelSizes.length, packed.residentLevels?.() ?? levelSizes.length)
}

/** Level `level` of the descent: its queue's argument armed, then a thread an entry. */
function levelPass(pass: GPUComputePassEncoder, resources: DagResources, level: number) {
  const { levelPipelines, dispatchArgs } = resources
  arm(pass, resources)
  pass.setPipeline(levelPipelines[level % levelPipelines.length])
  pass.dispatchWorkgroupsIndirect(dispatchArgs, DAG_ARGS.queues[level % 3])
}

/** The running pass's draws: a thread a live cluster `dagWanted` has just listed. */
function encodeDraws(pass: GPUComputePassEncoder, resources: DagResources) {
  arm(pass, resources)
  pass.setPipeline(resources.maskPipeline)
  pass.dispatchWorkgroupsIndirect(resources.dispatchArgs, DAG_ARGS.live)
}

/** The cut's mask and drawn log made the frame's — what fit its lists' caps —: a thread a word of
 *  the masks (`shader/commitWgsl.ts`). */
function commit(pass: GPUComputePassEncoder, resources: DagResources, width: number) {
  pass.setPipeline(resources.commitPipeline)
  const words = BLOCK_MASK_WORDS * resources.blockCount
  dispatchRows(pass, workgroupCount(words, WORKGROUP_THREADS), 1, width)
}

/**
 * What every cut ends with, once its last pass drew: the drawable-page list compacted in increasing
 * order — the snapshot reports the count and its ranks, never a flag a page —, the mask and the
 * drawn log committed, the rows the cut's pages need stamped, and, when a readback copies the cut
 * (`differ`), the rows' queue and the difference against the snapshot last copied.
 */
function encodeFinish(
  pass: GPUComputePassEncoder,
  resources: DagResources,
  width: number,
  differ: boolean,
  stamp = true,
) {
  const { dispatchArgs } = resources
  pass.setPipeline(resources.drawPrefixPipeline)
  pass.dispatchWorkgroups(1)
  // The prefix armed the live list whole, both passes' entries.
  arm(pass, resources)
  pass.setPipeline(resources.drawScatterPipeline)
  pass.dispatchWorkgroupsIndirect(dispatchArgs, DAG_ARGS.live)
  commit(pass, resources, width)
  // The rows the cut's pages need, stamped, and their queue when a readback copies the cut
  // (`../rows/rowEviction.ts`): the cut's group back after them.
  if (resources.rowPass && stamp) {
    resources.rowPass.encode(pass, differ)
    pass.setBindGroup(0, resources.bindGroup)
  }
  if (differ) encodeDifference(pass, resources)
}

/** Every list's argument copied from `work` (`shader/armWgsl.ts`), then the cut's group back in
 *  place: the kernels that follow bind it. */
function arm(pass: GPUComputePassEncoder, { armPipeline, armGroup, bindGroup }: DagResources) {
  pass.setPipeline(armPipeline)
  pass.setBindGroup(0, armGroup)
  pass.dispatchWorkgroups(1)
  pass.setBindGroup(0, bindGroup)
}

/** The entries of queue 0, one `dagPrepare` thread each (`queueZeroEntries`). */
const levelEntries = ({ packed }: DagResources) => queueZeroEntries(packed)

/** A kernel on `threads` threads, in rows of `width` workgroups. */
function flat(
  pass: GPUComputePassEncoder,
  pipe: GPUComputePipeline,
  width: number,
  threads: number,
) {
  pass.setPipeline(pipe)
  dispatchRows(pass, workgroupCount(threads, WORKGROUP_THREADS), 1, width)
}
