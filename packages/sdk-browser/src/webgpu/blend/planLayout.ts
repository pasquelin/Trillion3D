import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
/**
 * WHERE THE BLEND PLAN AND ITS RUNS SIT IN THE SCENE'S WORDS.
 *
 * The plan's own layout — its entry bits, its runs, what each pass occupies — is read by the plan
 * that fills it, the order kernel that sorts it and places its slots, the expansion kernel and the
 * draw that read a run, and the resources that size the buffers. The words here describe the
 * buffer, not the walk: the walk is `order.ts` (which entries, in which order) and `runs.ts`
 * (which stretch of entries one draw paints).
 */

/** The two passes: blend, then transmission over the frozen background. */
export const EXPAND_PASSES = 2
/** Plan entries a kernel thread GROUP covers, and therefore its threads: the shader interpolates
 *  this value in its `@workgroup_size`, so the two cannot diverge. */
export const EXPAND_GROUP = 64

/**
 * TWO words per run: its first entry and their count, and nothing more.
 *
 * A slot's pipeline and buffers are the CPU's (`draw.ts`): the main class's, or its own entry's; a
 * run of no entry draws nothing (`runs.ts`).
 */
export const RUN_WORDS = 2

/** Draw slots a pass of `entries` plan entries can need: one per entry that draws its own, and one
 *  around each of them for the pass's main class (`runs.ts`). */
export const slotCapacity = (entries: number) => 2 * entries + 1

/** Words of the plan array per entry a pass can hold: its seed, its sorted place, and the two words
 *  of each of its two slots, plus the one slot left over. Local: `planRegions` reads it. */
const PLAN_ENTRY_WORDS = 2 + 2 * RUN_WORDS

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
  let shift = 2
  while (shift < 30 && 1 << shift < Math.max(4, maxVertexWords)) shift++
  return shift
}

/** Vertices an instance of an UNPAGED primitive draws: the largest multiple of three the
 *  addressing stride lets through, and never more than the primitive carries. */
export const blendChunkWords = (shift: number, indexCount: number) =>
  Math.max(3, Math.min(indexCount, 3 * Math.floor((1 << shift) / 3)))

/** What each pass occupies: its seeded entries, their sorted order and its runs in the plan, its
 *  indirect arguments. */
export function planRegions(maxEntries: number) {
  const regions = [],
    passWords = maxEntries * PLAN_ENTRY_WORDS + RUN_WORDS
  for (let pass = 0; pass < EXPAND_PASSES; pass++)
    regions.push({
      seeds: pass * passWords,
      order: pass * passWords + maxEntries,
      runs: pass * passWords + 2 * maxEntries,
      args: pass * slotCapacity(maxEntries) * 4,
    })
  return regions
}

/** Words the plan and the kernel scratch occupy for the whole scene. */
export const planWords = (maxEntries: number) =>
  (maxEntries * PLAN_ENTRY_WORDS + RUN_WORDS) * EXPAND_PASSES
export const scratchWords = (maxEntries: number) => maxEntries + ceilDiv(maxEntries, EXPAND_GROUP)
