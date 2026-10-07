import { EXPAND_GROUP } from './planLayout.ts'
import { PLAN_SHIFT } from './planEntry.ts'
import { EXPAND_UNI } from './expandUniform.ts'

/**
 * RUNS OF THE TRANSPARENT PASS: what replaces a draw per item.
 *
 * The sorted plan, farthest to nearest (`order.ts`), remains the correctness constraint: a blend
 * does not write depth, and only the order in which primitives pass the rasterizer separates two
 * surfaces. That order is GUARANTEED INSIDE A DRAW: a draw's primitives are rasterized instance by
 * instance, and in each instance vertex by vertex. A stretch of plan entries that set the same
 * pipeline and read the same buffers can therefore fit in ONE draw whose instances are, in order,
 * those of each entry.
 *
 * The GPU sorts the plan (`orderWgsl.ts`) and the CPU encodes the draws without that order: WebGPU
 * lets an indirect draw take its counts from the GPU, never its pipeline nor its bind group. The
 * draws are therefore laid out ahead of the order, as SLOTS:
 * - the pass's MAIN CLASS — the paged entries of its most common pipeline, which all read the one
 *   shared bind group — paints in any order inside a draw of its own;
 * - every other entry is an OWN entry — an unpaged item with its own buffers, or a paged one of
 *   another pipeline — and needs a draw of its own: the CPU orders these few itself, with the GPU's
 *   keys and rule (`sortPlan.ts`), so it knows which draw each one is;
 * - the main class is drawn in the GAPS between own items: a gap before the first, one after each.
 *   An item's own entries — the back and the face of an unpaged double-sided item — tie on their
 *   key and follow each other in seed order: nothing can paint between them, and no gap does.
 * A gap may hold no entry: a draw of no instance. A pass without a main class has only its own
 * slots; a pass of one class has a single slot, one draw, and nothing ordered on the CPU. Once the
 * order is known, the GPU gives each slot its run (CPU model: `runs.fixture.ts`) and the expansion
 * kernel its indirect argument.
 */

/**
 * First word of an expanded instance: its item rank, and above it the cull mode the vertex stage
 * applies (`planVertexCull`, zero when the pipeline culls). The expansion kernel, its CPU model
 * (`runs.fixture.ts`) and the vertex stage read the split here.
 */
export const INSTANCE_CULL_SHIFT = 30
export const INSTANCE_ITEM_MASK = (1 << INSTANCE_CULL_SHIFT) - 1

/** Slots of a pass: one per own entry, plus a gap before each own item and after the last one
 *  when the pass has a main class. Fixed by the plan: an item's entries stay together. */
export const slotCount = (own: number, items: number, main: boolean) =>
  main ? own + items + 1 : own

/**
 * The slot of each own entry this frame (`ownSlots`, in paint order) and the own entry each slot
 * draws (`slotOwns`, -1 for a gap), from the own seeds in paint order. Returns the slots.
 */
export function assignOwnSlots(
  seeds: Uint32Array,
  ownSeeds: Uint32Array,
  main: boolean,
  ownSlots: Uint32Array,
  slotOwns: Int32Array,
) {
  let slot = 0,
    previous = -1
  for (let k = 0; k < ownSeeds.length; k++) {
    const item = seeds[ownSeeds[k]] >>> PLAN_SHIFT
    if (main && item !== previous) slotOwns[slot++] = -1
    slotOwns[slot] = k
    ownSlots[k] = slot++
    previous = item
  }
  if (main) slotOwns[slot++] = -1
  return slot
}

/** Writes the expansion kernel's uniform words (`expandUniform.ts`) into `out`, at the rank each
 *  occupies. */
export function blendExpandUniform(
  out: Uint32Array,
  counts: { entries: number; runs: number; instanceBase: number },
  region: { order: number; runs: number; args: number },
  scene: { maxVertexWords: number; vertexShift: number },
) {
  out[EXPAND_UNI.entryCount] = counts.entries
  out[EXPAND_UNI.groupCount] = Math.ceil(Math.max(1, counts.entries) / EXPAND_GROUP)
  out[EXPAND_UNI.runCount] = counts.runs
  out[EXPAND_UNI.instanceBase] = counts.instanceBase
  out[EXPAND_UNI.argsBase] = region.args
  out[EXPAND_UNI.maxVertexWords] = scene.maxVertexWords
  out[EXPAND_UNI.vertexShift] = scene.vertexShift
  out[EXPAND_UNI.orderBase] = region.order
  out[EXPAND_UNI.runsBase] = region.runs
  return out
}
