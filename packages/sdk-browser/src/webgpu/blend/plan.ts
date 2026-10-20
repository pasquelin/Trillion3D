import { matrixWindingCw } from '../../../../math/src/matrix/orientation.ts'
import type { PageSurface } from '../../page/surface.ts'
import { drawnBlending } from '../../scene/materialBlending.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import { filtersDisplay } from './equations.ts'
import { MAX_SIDES } from './statics.ts'
import { slotCount } from './runs.ts'
import { FRAME_HEAD } from './frameHead.ts'
import { planOrderSteps } from './orderSteps.ts'
import type { BlendGpuItem, WebgpuBlendState } from './state.ts'
import { PLAN_PIPELINE_MASK, PLAN_SHIFT, PLAN_VERTEX_CULL_BIT, planEntry } from './planEntry.ts'
import {
  CULL_RANK,
  REFRACT_BASE,
  TRANSMIT_BASE,
  blendingOf,
  pipelineBase,
  planCull,
} from './planCull.ts'

/** The cull ranks of a pass's pipelines (`CULL_RANK`): a plan entry picks them without a test, and
 *  the rank, plus its blend mode's base (`pipelineBase`) or the transmissive items'
 *  (`TRANSMIT_BASE`), indexes the pipelines of the pass (`BlendModePipelines`, `draw.ts`). */
export const planItem = (entry: number) => entry >>> PLAN_SHIFT
/** Cull mode the vertex stage applies to the entry's instances: zero when the pipeline culls. */
const planVertexCull = (entry: number) =>
  entry & PLAN_VERTEX_CULL_BIT ? planCull(entry) : CULL_RANK.none
/** Pipeline the entry sets: its mode's one that culls nothing when the vertex stage culls for it. */
export const planPipeline = (entry: number) => (entry & PLAN_PIPELINE_MASK) - planVertexCull(entry)
/** First pipeline rank of an item: its blend mode's (`drawnBlending`, which refuses by name), the
 *  transmissive items' own past them, a refracting one's past those (`REFRACT_BASE`). */
function firstPipeline(surface: PageSurface, transmissive: boolean) {
  const mode = drawnBlending(surface.blending, transmissive)
  if (!transmissive) return pipelineBase(mode)
  return surface.refracts ? REFRACT_BASE : TRANSMIT_BASE
}

/** Plan entries of an item: back then face for a double-sided one drawn in two passes, else one. */
function sidesOf(item: BlendGpuItem) {
  // One determinant, taken once, picks both faces.
  const renverse = matrixWindingCw(item.matrix.elements)
  const front = renverse ? CULL_RANK.front : CULL_RANK.back,
    back = renverse ? CULL_RANK.back : CULL_RANK.front
  // The record is read here, as its owner wrote it last: the plan is what must see a side
  // switched in place (see the room reserved above).
  const surface = item.surface
  const side = surface.side,
    base = firstPipeline(surface, !!item.transmissive)
  if (side === 'double' && !surface.forceSinglePass) return [base + back, base + front]
  if (side === 'front') return [base + front]
  if (side === 'back') return [base + back]
  return [base + CULL_RANK.none]
}

/**
 * Encoding plan, rebuilt when the scene has changed matrices — and never per frame. An entry
 * carries the item rank and the pipeline to set, so neither the order nor the slots read a
 * material. ONE pass holds every translucent item, the transmissive ones among the blends, sorted
 * together by distance, so a transmissive layer and a blend in front of each other compose right.
 */
export function refreshBlendPlan(blendState: WebgpuBlendState) {
  const items = blendState.blendGpu
  const entries: number[] = []
  // Whether a mode filters the display: found with the plan, never per frame.
  let filters = false,
    refracts = false
  const modes = new Set<Blending>()
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const sides = sidesOf(item),
      vertexCull = sides.length === MAX_SIDES
    const mode = blendingOf(sides[0])
    if (mode) {
      filters ||= filtersDisplay(mode)
      modes.add(mode)
    }
    refracts ||= !!item.transmissive && !!item.surface.refracts
    for (const side of sides) entries.push(planEntry(i, side, vertexCull))
  }
  blendState.seeds = Uint32Array.from(entries)
  splitBlendClasses(blendState)
  planBlendOrder(blendState)
  blendState.filtersDisplay = filters
  blendState.refracts = refracts
  blendState.planModes = [...modes]
}

/**
 * The pass's MAIN CLASS — the entries of its most common pipeline, the lowest on a tie — and its
 * OWN entries, every other one, each its own draw slot (`runs.ts`). An item's entries share its
 * class: a double-sided item sets one pipeline for both sides (VERTEX CULL); they are consecutive
 * seeds, which is how its own items are counted. The own entries start in source order, the order
 * the CPU then keeps sorting in place.
 */
function splitBlendClasses(blendState: WebgpuBlendState) {
  // The items whose keys the CPU takes each frame, to order their own entries.
  const owned = new Set<number>()
  const seeds = blendState.seeds,
    shared = new Array<number>(PLAN_PIPELINE_MASK + 1).fill(0)
  for (const entry of seeds) shared[planPipeline(entry)]++
  const most = Math.max(...shared),
    main = most ? shared.indexOf(most) : -1
  const own: number[] = []
  let items = 0
  for (let seed = 0; seed < seeds.length; seed++) {
    const entry = seeds[seed]
    if (planPipeline(entry) === main) continue
    own.push(seed)
    const item = planItem(entry)
    owned.add(item)
    if (own.length === 1 || planItem(seeds[own[own.length - 2]]) !== item) items++
  }
  blendState.mainPipeline = main
  blendState.ownSeeds = Uint32Array.from(own)
  blendState.ownSlots = new Uint32Array(own.length)
  const slots = seeds.length ? slotCount(own.length, items, main >= 0) : 0
  blendState.slotOwns = new Int32Array(slots)
  blendState.slotPipelines = new Int8Array(slots)
  blendState.slotCount = slots
  blendState.ownItems = Uint32Array.from(owned)
}

/** Where the frame data puts the own seeds and slots, and the order kernel's dispatches. */
function planBlendOrder(blendState: WebgpuBlendState) {
  const layout = blendState.frameLayout,
    own = blendState.ownSeeds.length,
    entries = blendState.seeds.length
  layout.ownSeeds = FRAME_HEAD.words
  layout.ownSlots = layout.ownSeeds + own
  layout.words = layout.ownSlots + own
  blendState.orderSteps = entries
    ? planOrderSteps(
        {
          entries,
          ownCount: own,
          main: blendState.mainPipeline >= 0,
          region: blendState.planRegion,
          ownSeedBase: layout.ownSeeds,
          ownSlotBase: layout.ownSlots,
        },
        blendState.orderStepWords,
        0,
        blendState.uniformStride,
      )
    : []
  blendState.planMoved = true
}
