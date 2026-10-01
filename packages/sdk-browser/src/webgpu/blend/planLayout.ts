/**
 * WHERE THE BLEND PLAN AND ITS RUNS SIT IN THE SCENE'S WORDS.
 *
 * The plan's own layout — its entry bits, its runs, what each pass occupies — is read by six modules
 * of this pass and by none of them alone: the plan fills it, the runs slice it, the draw reads a run,
 * the expansion kernel writes its uniform at a region, and the resources size the buffers. Held in
 * `runs.ts`, `plan.ts` had to import the module that slices the plan it lays out, and the two formed
 * a cycle with `runSlicing.ts`: three modules where the layout decides nothing about the traversal
 * and the traversal decides nothing about the layout.
 *
 * The words here describe the buffer, not the walk. The walk is `order.ts` (which entries, sorted)
 * and `runSlicing.ts` (which stretch of entries draws once).
 */

/** The two passes: blend, then transmission over the frozen background. */
export const EXPAND_PASSES = 2;
/** Plan entries a kernel thread GROUP covers, and therefore its threads: the shader interpolates
 *  this value in its `@workgroup_size`, so the two cannot diverge. */
export const EXPAND_GROUP = 64;

/**
 * TWO words per run: its first entry and their count, and nothing more.
 *
 * Pipeline and owner item are read on the plan's first entry, which already carries them in its low
 * bits. Writing them in the run as well doubled what the frame writes on a scene that merges
 * nothing — a scene of unpaged items, where each run holds only one entry.
 */
export const RUN_WORDS = 2;

/** Words of the plan array between two entries: the entry, then the two words of its run. It is
 *  local — the only reader is `planRegions` below, which is where a plan pass begins. */
const PLAN_CHUNK_WORDS = 1 + RUN_WORDS;

/**
 * Bits of a plan entry the vertex words leave, so the expansion kernel, the CPU model beside it and
 * the vertex stage read one number: a run's indirect draw starts at vertex `base << shift`, and the
 * shader finds `base` in the high bits of the vertex index, its local rank in the low ones.
 *
 * `firstInstance` would have said the same thing, but WebGPU allows it in an indirect draw only under
 * an extension; `firstVertex` is always free when no vertex buffer is bound, and that is the case of
 * this pass.
 */
export const blendVertexShift = (maxVertexWords: number) => {
  let shift = 2;
  while (shift < 30 && 1 << shift < Math.max(4, maxVertexWords)) shift++;
  return shift;
};

/** Vertices an instance of an UNPAGED primitive draws: the largest multiple of three the
 *  addressing stride lets through, and never more than the primitive carries. */
export const blendChunkWords = (shift: number, indexCount: number) =>
  Math.max(3, Math.min(indexCount, 3 * Math.floor((1 << shift) / 3)));

/** What each pass occupies: its order and runs in the plan, its indirect arguments. */
export function planRegions(maxEntries: number) {
  const regions = [];
  for (let pass = 0; pass < EXPAND_PASSES; pass++)
    regions.push({
      order: pass * maxEntries * PLAN_CHUNK_WORDS,
      runs: pass * maxEntries * PLAN_CHUNK_WORDS + maxEntries,
      args: pass * maxEntries * 4,
    });
  return regions;
}

/** Words the plan and the kernel scratch occupy for the whole scene. */
export const planWords = (maxEntries: number) => maxEntries * PLAN_CHUNK_WORDS * EXPAND_PASSES;
export const scratchWords = (maxEntries: number) =>
  maxEntries + Math.ceil(maxEntries / EXPAND_GROUP);
