import { planItem, planPipeline, planShared } from './plan.ts';

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

/** The two passes: blend, then transmission over the frozen background. */
export const EXPAND_PASSES = 2;
/** Plan entries a kernel thread GROUP covers, and therefore its threads: the shader interpolates
 *  this value in its `@workgroup_size`, so the two cannot diverge. */
export const EXPAND_GROUP = 64;
/**
 * TWO words per run: its first entry and their count, and nothing more.
 *
 * Pipeline and owner item are read on the plan's first entry, which already carries them in its
 * low bits. Writing them in the run as well doubled what the frame writes on a scene that
 * merges nothing — a scene of unpaged items, where each run holds only one entry.
 */
export const RUN_WORDS = 2;
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
export function blendVertexShift(maxVertexWords: number) {
  let shift = 2;
  while (shift < 30 && 1 << shift < Math.max(4, maxVertexWords)) shift++;
  return shift;
}

/** Vertices an instance of an UNPAGED primitive draws: the largest multiple of three the
 *  addressing stride lets through, and never more than the primitive carries. */
export function blendChunkWords(shift: number, indexCount: number) {
  return Math.max(3, Math.min(indexCount, 3 * Math.floor((1 << shift) / 3)));
}

/**
 * Writes the runs of the sorted plan and returns their count.
 *
 * `out` belongs to the scene and is `RUN_WORDS` words per plan entry — the worst case — so nothing
 * is allocated per frame.
 */
export function buildBlendRuns(order: Uint32Array, out: Uint32Array) {
  let runs = 0,
    first = 0;
  while (first < order.length) {
    const pipeline = planPipeline(order[first]);
    const shared = planShared(order[first]);
    // An entry extends the run when it sets the same pipeline AND carries the share bit: both are
    // in its low bits, and the plan is walked without ever following a rank. Its cull mode may
    // differ: the vertex stage reads it per instance.
    let end = first + 1;
    if (shared)
      while (end < order.length && planShared(order[end]) && planPipeline(order[end]) === pipeline)
        end++;
    const base = runs * RUN_WORDS;
    out[base] = first;
    out[base + 1] = end - first;
    runs++;
    first = end;
  }
  return runs;
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

/** What each pass occupies: its order and runs in the plan, its indirect arguments. */
export function planRegions(maxEntries: number) {
  const regions = [];
  for (let pass = 0; pass < EXPAND_PASSES; pass++)
    regions.push({
      order: pass * maxEntries * (1 + RUN_WORDS),
      runs: pass * maxEntries * (1 + RUN_WORDS) + maxEntries,
      args: pass * maxEntries * 4,
    });
  return regions;
}

/**
 * THE TWELVE UNIFORM WORDS OF THE EXPANSION KERNEL, written once.
 *
 * Three writes and one read share them: production encoding, the “GPU = model” proof, the test
 * double, and the struct the shader declares. Reordering a word in one of the four let the other
 * three compile and pass while reading the wrong fields — exactly the devices meant to catch the
 * drift. They all read here.
 */
const UNI_FIELDS = [
  'entryCount',
  'groupCount',
  'runCount',
  'instanceBase',
  'argsBase',
  'maxVertexWords',
  'vertexShift',
  'orderBase',
  'runsBase',
] as const;
export const UNI_WORDS = 12;
export const EXPAND_UNI = Object.fromEntries(UNI_FIELDS.map((nom, rang) => [nom, rang])) as Record<
  (typeof UNI_FIELDS)[number],
  number
>;
/** WGSL declaration of these words, in the same order, padding included. */
export const expandUniformWgsl = () =>
  `struct Uni{${UNI_FIELDS.map((nom) => `${nom}:u32,`).join('')}pad0:u32,pad1:u32,pad2:u32,}`;

/** Writes them into `out`, at the rank each occupies. */
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

/** Words the plan and the kernel scratch occupy for the whole scene. */
export const planWords = (maxEntries: number) => maxEntries * (1 + RUN_WORDS) * EXPAND_PASSES;
export const scratchWords = (maxEntries: number) =>
  maxEntries + Math.ceil(maxEntries / EXPAND_GROUP);
