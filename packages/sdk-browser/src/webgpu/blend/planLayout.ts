import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
/**
 * WHERE THE BLEND PLAN AND ITS RUNS SIT IN THE SCENE'S WORDS.
 *
 * The plan's own layout — its entry bits, its runs, what the one pass of every translucent item
 * occupies — is read by the plan
 * that fills it, the order kernel that sorts it and places its slots, the expansion kernel and the
 * draw that read a run, and the resources that size the buffers. The words here describe the
 * buffer, not the walk: the walk is `order.ts` (which entries, in which order) and `runs.ts`
 * (which stretch of entries one draw paints).
 */

/**
 * TWO words per run: its first entry and their count, and nothing more.
 *
 * A slot's pipeline and buffers are the CPU's (`draw.ts`): the main class's, or its own entry's; a
 * run of no entry draws nothing (`runs.ts`).
 */
export const RUN_WORDS = 2

/** Draw slots the pass of `entries` plan entries can need: one per entry that draws its own, and one
 *  around each of them for the pass's main class (`runs.ts`). */
export const slotCapacity = (entries: number) => 2 * entries + 1

/** Words of the plan array per entry the pass can hold: its seed, its sorted place, and the two
 *  words of each of its two slots, plus the one slot left over. Local: `planRegion` reads it. */
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

/** What the pass occupies: its seeded entries, their sorted order and its runs in the plan, its
 *  indirect arguments from the first. */
export const planRegion = (maxEntries: number) => ({
  seeds: 0,
  order: maxEntries,
  runs: 2 * maxEntries,
  args: 0,
})

/** Words the plan and the kernel scratch occupy for the whole scene. */
export const planWords = (maxEntries: number) => maxEntries * PLAN_ENTRY_WORDS + RUN_WORDS
export const scratchWords = (maxEntries: number) =>
  maxEntries + ceilDiv(maxEntries, WORKGROUP_THREADS)
