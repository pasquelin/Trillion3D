import { SELECTION_WORKGROUP as WORKGROUP } from '../core/selection.ts';
import type { createDagResources } from './resources.ts';

/** The cut's resources, as it encodes them. A light cut brings its own flags, work, frames, output
 *  and bind group, the views it runs this frame and its queue capacity (`lightCut.ts`); it keeps no
 *  draw flag and compacts no drawable list — each view's log goes to the light compaction. */
/** Label of a light cut's passes: shadow work, profiled as a stage of its own and never in the
 *  visibility block the camera's cut belongs to (`../../stage/mapping.ts`). */
export const LIGHT_CUT_PASS = 'Trillion3D light cut';

export type DagView = NonNullable<Awaited<ReturnType<typeof createDagResources>>> & {
  light?: { views: number; queueCap: number };
};

/**
 * Cut kernels, encoded in order. Each dispatch waits for the previous — the GPU empties its queue
 * and caches between two —, and that wait is attributed to no kernel: it is the number of
 * dispatches that fixes it, not their size. So only what the dependencies actually require
 * remains: prepare carries thresholds, planes and block counts in one go, the live list's group
 * count holds as additions come, and the mask itself counts the drawn of its block.
 *
 * Two passes not one: the group count lives in `work`, written by the first pass and read as
 * dispatch argument by the second, and WebGPU refuses a buffer both written and read as argument
 * in the same synchronisation scope. The cut carries only the copy of that word; the other two
 * argument words are one and never change.
 *
 * That copy is EXPENSIVE — the measurement sits next to `hierarchyLevelSizes` (`hierarchy.ts`)
 * —, and only three remain per frame. Not that the three lists have no upper bound: `pageCount` is
 * one for all. It is COARSE, 1,959,792 for 21,955 useful on the twelve-instance bench, when a
 * level's stage hugs its queue. An arming is therefore traded against threads, and the trade only
 * pays if the bound is tight.
 */
export function encodeDagKernels(encoder: GPUCommandEncoder, resources: DagView) {
  // A DIAGNOSTIC variant alone re-encodes the cut. The repeat PRECEDES the cut that counts: each
  // kernel restarts from the clear, the final state is therefore that of a single run, and the
  // frame delta measures what the repeat actually cost — waits between dispatches included, which
  // no pass envelope reports.
  if (resources.repeat) {
    encodeOnce(encoder, resources, resources.repeat === 'tete', true);
    encodeOnce(encoder, resources, false, false);
    return;
  }
  encodeOnce(encoder, resources, false, true);
}

function encodeOnce(
  encoder: GPUCommandEncoder,
  resources: DagView,
  headOnly: boolean,
  clear: boolean,
) {
  const {
    residentCut,
    blockCount,
    levelSizes,
    liveGroupsOffset,
    candGroupsOffset,
    drawnGroupsOffset,
    work,
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
    viewOffsetsPipeline,
    requestSortPipeline,
    evictPipeline,
    light,
  } = resources;
  // Every view's work items share each dispatch: a level's bound is its stage's nodes per view,
  // and never more than its queue holds.
  const views = light?.views ?? 1,
    queueCap = light?.queueCap ?? resources.nodeCount;
  const label = light ? LIGHT_CUT_PASS : 'Trillion3D DAG selection';
  // Head word of the dispatch argument, copied outside a pass: the other two have been one since
  // the buffer was created. That is the only reason for cuts between passes.
  const arm = (offset: number) => encoder.copyBufferToBuffer(work, offset, dispatchArgs, 0, 4);
  const open = () => {
    const pass = encoder.beginComputePass({ label });
    pass.setBindGroup(0, ranges[0].bindGroup);
    return pass;
  };
  // A light cut sets no draw flag, so it has none to clear.
  const clearDrawn = clear && !light;
  if (clearDrawn) arm(drawnGroupsOffset);
  const pass = open();
  // Previous frame's drawn pages, and they alone, take their flag back to zero: no more walk of
  // every flag, and the prepare that follows clears the journal.
  if (clearDrawn) {
    pass.setPipeline(clearDrawnPipeline);
    pass.dispatchWorkgroupsIndirect(dispatchArgs, 0);
  }
  // The first range's dispatch also resets the block counts.
  perRangeFlat(pass, ranges, preparePipeline, 0, views, blockCount);
  // The whole descent in THIS pass: dispatches of the same pass run in order and see what the
  // previous ones wrote — prepare and pass 0 already depended on that. Nothing else cut the
  // descent but the dispatch argument, and there is no more of it.
  //
  // Pass 0 starts from one root per primitive: each range's count of primitives and NOT
  // `levelSizes[0]`, which would not always bound it: `dagPrepare` puts one entry per primitive,
  // missing root included — pass 0 reads it there and rejects it —, where stage zero only counts
  // roots that exist. A primitive whose caller supplies an empty hierarchy would make the two
  // diverge. Each range reads its own roots; a deeper level mixes them, so each range walks the
  // level's whole queue and keeps its own primitives' nodes.
  perRangeFlat(pass, ranges, rootLevelPipeline, 0, views);
  // Each following level reads only the nodes the previous one kept, and fills the next of the
  // three queues — the one a level earlier cleared. The dispatched count is that of its stage's
  // nodes, an upper bound the layout knows.
  for (let level = 1; level < levelSizes.length; level++) {
    const pipeline = levelPipelines[level % levelPipelines.length];
    perRangeFlat(pass, ranges, pipeline, Math.min(levelSizes[level] * views, queueCap), 0);
  }
  pass.end();
  // Pages of kept leaves, and they alone: a page under a rejected node is not read.
  arm(candGroupsOffset);
  const wanted = open();
  perRangeIndirect(wanted, ranges, wantedPipeline, dispatchArgs);
  wanted.end();
  if (headOnly) return;
  arm(liveGroupsOffset);
  const live = open();
  // These kernels visit only live clusters, those `dagWanted` has just listed: their verdict is
  // the previous one, it is no longer spoken on those it said nothing about.
  const runLive = (pipeline: GPUComputePipeline) => {
    live.setPipeline(pipeline);
    live.dispatchWorkgroupsIndirect(dispatchArgs, 0);
  };
  // Each view's share of the drawn log, once every view's live clusters are counted.
  if (light) {
    live.setPipeline(viewOffsetsPipeline);
    live.dispatchWorkgroups(1);
  }
  perRangeIndirect(live, ranges, maskPipeline, dispatchArgs);
  // The drawable-page list is compacted here, in increasing order: the snapshot no longer
  // reports one flag per page but the count alone and its ranks.
  // Then the camera's requests, staged by `dagWanted`, go into the snapshot sorted by rank: one
  // workgroup, in the same pass (`shader/snapshotWgsl.ts`). A light cut sorts its own on the host.
  // Last, once every page this cut uses is stamped, the eviction queue (`shader/evictWgsl.ts`).
  if (!light) {
    if (residentCut) {
      live.setPipeline(drawPrefixPipeline);
      live.dispatchWorkgroups(1);
      runLive(drawScatterPipeline);
    }
    live.setPipeline(requestSortPipeline);
    live.dispatchWorkgroups(1);
    if (residentCut) {
      live.setPipeline(evictPipeline);
      live.dispatchWorkgroups(1);
    }
  }
  live.end();
}

/**
 * The kernels that read a primitive's words run once per range of `frames`, each under its
 * range's bind group, and take only its range's primitives (`frameRanges.ts`). One range keeps the
 * group the pass opened with: the commands of before.
 */
function perRangeIndirect(
  pass: GPUComputePassEncoder,
  ranges: DagView['ranges'],
  pipeline: GPUComputePipeline,
  args: GPUBuffer,
) {
  pass.setPipeline(pipeline);
  for (let r = 0; r < ranges.length; r++) {
    if (ranges.length > 1) pass.setBindGroup(0, ranges[r].bindGroup);
    pass.dispatchWorkgroupsIndirect(args, 0);
  }
}

/** The same, flat: `threads`, plus `perPrimitive` per primitive of the range, at least
 *  `firstFloor` on the first range. */
function perRangeFlat(
  pass: GPUComputePassEncoder,
  ranges: DagView['ranges'],
  pipeline: GPUComputePipeline,
  threads: number,
  perPrimitive: number,
  firstFloor = 0,
) {
  pass.setPipeline(pipeline);
  for (let r = 0; r < ranges.length; r++) {
    if (ranges.length > 1) pass.setBindGroup(0, ranges[r].bindGroup);
    const count = Math.max(threads + perPrimitive * ranges[r].count, r ? 0 : firstFloor);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(count / WORKGROUP)));
  }
}
