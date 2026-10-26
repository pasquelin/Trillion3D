import type { DagResources } from './resources.ts'
import { dispatchRows, groupWidth, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { DAG_ARGS } from './shader/armWgsl.ts'
import { DAG_SELECTION_PASS } from '../../diagnostic/stage/passLabels.ts'
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
 * require remains: prepare carries thresholds, planes and the masks' reset in one go, and the
 * cluster cull appends the clusters it draws to the list of visible clusters as it judges them.
 *
 * Lists have no bound the layout knows — the candidates, the visible clusters, the post pass's
 * held items —, so the kernels that walk them dispatch indirectly, on a group count the kernel
 * that filled the list wrote in `work`. WebGPU refuses, in one dispatch, an argument
 * buffer that a group its pipeline uses binds writable, and `work` is: the arming kernel copies
 * the counts into `dispatchArgs`, which only its own group binds (`shader/armWgsl.ts`), as a
 * dispatch of the same pass. A copy outside the pass would cut it in three, and a pass behind an
 * off-pass copy costs about seventeen times a dispatch in the open pass (the measurement next to
 * `hierarchyLevelSizes`, `hierarchy.ts`).
 *
 * Not that those lists have no upper bound: `pageCount` is one for all. It is COARSE,
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
    encodeMain(encoder, resources, group, resources.repeat === 'head', { post: main.post })
  }
  encodeMain(encoder, resources, group, false, main)
}

/** What the main pass is encoded for: whether a post pass follows (`post`, `encodeDagPost`), and the
 *  pyramid the main pass reads — the previous image's, when its occlusion runs in two passes
 *  (`OCCLUSION_TWO_PASS`); a blank one otherwise. */
export type DagMainPass = {
  post?: boolean
  pyramid?: CutPyramid
}

/** The cut's compute pass, whoever encodes it. */
const DAG_PASS: GPUComputePassDescriptor = { label: DAG_SELECTION_PASS }

/**
 * The main pass of the cut: the descent from the roots, the clusters of its kept leaves, the
 * cluster cull that appends the ones it draws to the list of visible clusters. A cut in one pass
 * finishes in the same compute pass (`encodeFinish`); one in two ends its pass there — the main
 * pass's visible clusters are the list's first, what the image's first raster pass draws — and
 * leaves the rest to the post pass (`encodeDagPost`).
 */
function encodeMain(
  encoder: GPUCommandEncoder,
  resources: DagResources,
  group: GPUBindGroup,
  headOnly: boolean,
  main: DagMainPass,
) {
  const { post = false } = main
  const { blockCount, dispatchArgs, bindGroup, preparePipeline, levelPipelines, wantedPipeline } =
    resources
  // Flat dispatches run in rows of the device's width.
  const width = groupWidth(resources.device?.limits)
  const pass = encoder.beginComputePass(DAG_PASS)
  pass.setBindGroup(OCCLUSION_GROUP, group)
  pass.setBindGroup(0, bindGroup)
  // Its dispatch also resets the blended clusters' masks.
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
  // A cut in two passes ends its first here: the visible clusters it appended are the first
  // raster pass's.
  if (!headOnly && !post) encodeFinish(pass, resources)
  pass.end()
}

/**
 * The cut's POST PASS (`shader/postPassWgsl.ts`), into `encoder`, once the image's first raster
 * pass drew the main pass's clusters and `pyramid` was built from that depth: the items and the
 * clusters the previous image's pyramid hid are judged again against this one, the subtrees of the
 * items it shows descended level by level as the main pass descends them, and the clusters drawn
 * appended to the list of visible clusters behind the main pass's, which the second raster pass
 * draws. Then the cut is finished (`encodeFinish`).
 */
export function encodeDagPost(
  encoder: GPUCommandEncoder,
  resources: DagResources,
  pyramid: CutPyramid | undefined,
) {
  const { dispatchArgs, bindGroup } = resources
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
  encodeFinish(pass, resources)
  pass.end()
}

/** The levels the descent dispatches: those a resident page needs reached, never more than the
 *  hierarchies hold (`PackedDag.residentLevels`); all of them where no residency is followed. A
 *  level no resident page reaches is never dispatched — it could ask for no page a resident one
 *  does not bring within reach — and costs nothing. */
export function levelsDispatched({
  packed,
  levelSizes,
}: Pick<DagResources, 'packed' | 'levelSizes'>) {
  return Math.min(levelSizes.length, packed.residentLevels?.() ?? levelSizes.length)
}

/** Level `level` of the descent: its queue's argument armed, then a thread an entry. */
function levelPass(pass: GPUComputePassEncoder, resources: DagResources, level: number) {
  const { levelPipelines, dispatchArgs } = resources
  arm(pass, resources)
  pass.setPipeline(levelPipelines[level % levelPipelines.length])
  pass.dispatchWorkgroupsIndirect(dispatchArgs, DAG_ARGS.queues[level % 3])
}

/**
 * What every cut ends with, once its last pass appended its clusters: its peaks and the number of
 * clusters drawn written, then the drawn list of the readout, a thread a visible cluster
 * (`shader/finishWgsl.ts`).
 */
function encodeFinish(pass: GPUComputePassEncoder, resources: DagResources) {
  const { dispatchArgs } = resources
  pass.setPipeline(resources.finishPipeline)
  pass.dispatchWorkgroups(1)
  // The finish armed the visible list, the longer of its two ends.
  arm(pass, resources)
  pass.setPipeline(resources.drawnPipeline)
  pass.dispatchWorkgroupsIndirect(dispatchArgs, DAG_ARGS.visible)
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
