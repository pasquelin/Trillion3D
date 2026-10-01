import { planItem, planShared } from './plan.ts';
import { EXPAND_GROUP, RUN_WORDS } from './planLayout.ts';
import { buildBlendRuns } from './runSlicing.ts';
import { EXPAND_UNI } from './expandUniform.ts';

/**
 * RUNS OF THE TRANSPARENT PASS: what replaces a draw per item.
 *
 * The sorted plan, farthest to nearest (`order.ts`), remains the correctness constraint:
 * a blend does not write depth, and only the order in which primitives pass the rasterizer
 * separates two surfaces. That order is GUARANTEED INSIDE A DRAW: a draw's primitives are
 * rasterized instance by instance, and in each instance vertex by vertex. A stretch of plan
 * entries that set the same pipeline and read the same buffers can therefore fit in ONE draw whose
 * instances are, in order, those of each entry.
 *
 * A run stops on two things, and on nothing else:
 * - the pipeline changes (a single-sided neighbour, or the back and the face of an unpaged
 *   double-sided item; a paged one sets the same pipeline twice, its vertex stage culls, `plan.ts`);
 * - the item is not paged: it carries its own index, position and UV buffers, hence its own bind
 *   group, and cannot share its neighbours' draw.
 * The water surfaces (`../water/pass.ts`) merge on the same terms: their material volume is
 * read by rank in the composite, never offset per draw.
 *
 * The worst case therefore yields exactly the previous draws; the ordinary case — paged primitives
 * that share a pipeline — yields them all in one.
 */

/**
 * First word of an expanded instance: its item rank, and above it the cull mode the vertex stage
 * applies (`planVertexCull`, zero when the pipeline culls). The expansion kernel, its CPU model
 * and the vertex stage read the split here.
 */
export const INSTANCE_CULL_SHIFT = 30;
export const INSTANCE_ITEM_MASK = (1 << INSTANCE_CULL_SHIFT) - 1;
export const instanceWord = (item: number, vertexCull: number) =>
  (item | (vertexCull << INSTANCE_CULL_SHIFT)) >>> 0;
export const instanceItem = (word: number) => word & INSTANCE_ITEM_MASK;
/** A shared run belongs to no item: its bind group is that of the paged ones. */
export const RUN_SHARED = 0xffffffff;

/**
 * Addressing stride of an instance: the power of two that separates two instances in vertex-index
 * space.
 *
 * A run's indirect draw starts at vertex `base << shift`, where `base` is the rank of its first
 * instance in the expanded list. The shader therefore finds that rank in the high bits of the
 * vertex index and its local rank in the low bits — the same trick the old plan played with the
 * item rank. `firstInstance` would have said the same thing, but WebGPU allows it in an indirect
 * draw only under an extension; `firstVertex` is always free when no vertex buffer is bound, and
 * that is the case of this pass.
 */

/** Vertices an instance of an UNPAGED primitive draws: the largest multiple of three the
 *  addressing stride lets through, and never more than the primitive carries. */

/**
 * The runs of `order` sliced again from entry `at`, the first that moved; `out` holds the `count`
 * runs it had before. A run reads only its entries and the one that stopped it: runs before the
 * one holding `at - 1` stand, and that one resumes the slicing, as it may now extend.
 */
export function resliceBlendRuns(order: Uint32Array, out: Uint32Array, count: number, at: number) {
  if (!count || at <= 0) return buildBlendRuns(order, out);
  // Runs are stored by increasing first entry: the last one below `at`.
  let lo = 0;
  for (let hi = count - 1; lo < hi;) {
    const mid = (lo + hi + 1) >> 1;
    if (out[mid * RUN_WORDS] < at) lo = mid;
    else hi = mid - 1;
  }
  return buildBlendRuns(order, out, lo, out[lo * RUN_WORDS]);
}

/**
 * ITEM A RUN NAMES, or `RUN_SHARED` when it merges several.
 *
 * A run is ownerless only if it merges several ITEMS: the one that kept a single item — one entry,
 * or the back and the face of a double-sided paged item, always adjacent since they carry the same
 * rank (`order.ts`) — names it, and the frame can then skip encoding it altogether when the
 * frustum rejects it — exactly what a draw per item used to do. The three paths read it here:
 * encoding, the expansion kernel and its CPU model.
 */
export function runOwner(order: Uint32Array, first: number, entries: number) {
  const entry = order[first],
    item = planItem(entry);
  return entries > 1 && planShared(entry) && planItem(order[first + entries - 1]) !== item
    ? RUN_SHARED
    : item;
}

/** Writes the expansion kernel's uniform words (`expandUniform.ts`) into `out`, at the rank each
 *  occupies. */
export function blendExpandUniform(
  out: Uint32Array,
  counts: { entries: number; runs: number; instanceBase: number },
  region: { order: number; runs: number; args: number },
  scene: { maxVertexWords: number; vertexShift: number },
) {
  out[EXPAND_UNI.entryCount] = counts.entries;
  out[EXPAND_UNI.groupCount] = Math.ceil(Math.max(1, counts.entries) / EXPAND_GROUP);
  out[EXPAND_UNI.runCount] = counts.runs;
  out[EXPAND_UNI.instanceBase] = counts.instanceBase;
  out[EXPAND_UNI.argsBase] = region.args;
  out[EXPAND_UNI.maxVertexWords] = scene.maxVertexWords;
  out[EXPAND_UNI.vertexShift] = scene.vertexShift;
  out[EXPAND_UNI.orderBase] = region.order;
  out[EXPAND_UNI.runsBase] = region.runs;
  return out;
}
