import { matrixWindingCw } from '../../../../math/src/matrix/orientation.ts'
import type { PageSurface } from '../../page/surface.ts'
import { BLEND_MODES, drawnBlending } from '../../scene/materialBlending.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import { filtersDisplay } from './equations.ts'
import { EXPAND_PASSES } from './planLayout.ts'
import { MAX_SIDES } from './statics.ts'
import { slotCount } from './runs.ts'
import { FRAME_HEAD } from './frameHead.ts'
import { planOrderSteps } from './orderSteps.ts'
import type { BlendGpuItem, WebgpuBlendState } from './state.ts'
import {
  PLAN_PIPELINE_MASK,
  PLAN_SHARED_BIT,
  PLAN_SHIFT,
  PLAN_VERTEX_CULL_BIT,
  planEntry,
} from './planEntry.ts'
import { planCull } from './planCull.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'

/** The three cull ranks of a pass's pipelines: a plan entry picks them without a test, and the
 *  rank, plus three per blend mode (`BLEND_MODES`), indexes the pipelines of the pass
 *  (`BlendModePipelines`, `draw.ts`). The water surfaces have only the three normal ones. */
const PIPELINE_NONE = 0,
  PIPELINE_FRONT = 1,
  PIPELINE_BACK = 2
export const planItem = (entry: number) => entry >>> PLAN_SHIFT
/** Cull mode the vertex stage applies to the entry's instances: zero when the pipeline culls. */
const planVertexCull = (entry: number) =>
  entry & PLAN_VERTEX_CULL_BIT ? planCull(entry) : PIPELINE_NONE
/** Pipeline the entry sets: its mode's one that culls nothing when the vertex stage culls for it. */
export const planPipeline = (entry: number) => (entry & PLAN_PIPELINE_MASK) - planVertexCull(entry)
const planShared = (entry: number) => (entry & PLAN_SHARED_BIT) !== 0
/** First pipeline rank of an item's blend mode (`drawnBlending`, which refuses by name). */
const modeBase = (surface: PageSurface, transmissive: boolean) =>
  BLEND_MODES.indexOf(drawnBlending(surface.blending, transmissive)) * 3

/** Plan entries of an item: back then face for a double-sided one drawn in two passes, else one. */
function sidesOf(item: BlendGpuItem) {
  // One determinant, taken once, picks both faces.
  const renverse = matrixWindingCw(item.matrix.elements)
  const front = renverse ? PIPELINE_FRONT : PIPELINE_BACK,
    back = renverse ? PIPELINE_BACK : PIPELINE_FRONT
  // The record is read here, as its owner wrote it last: the plan is what must see a side
  // switched in place (see the room reserved above).
  const surface = item.surface
  const side = surface.side,
    base = modeBase(surface, !!item.transmissive)
  if (side === 'double' && !surface.forceSinglePass) return [base + back, base + front]
  if (side === 'front') return [base + front]
  if (side === 'back') return [base + back]
  return [base + PIPELINE_NONE]
}

/**
 * Encoding plan, rebuilt when the scene has changed matrices — and never per frame. An entry
 * carries the item rank and the pipeline to set, so neither the order nor the slots read a
 * material.
 */
export function refreshBlendPlan(blendState: WebgpuBlendState) {
  const items = blendState.blendGpu
  const blend: number[] = [],
    transmission: number[] = []
  // Triangles each pass SUBMITS (a double-sided item twice: two plan entries), and whether a mode
  // filters the display: counted with the plan, never per frame.
  let blendTriangles = 0,
    transmissionTriangles = 0,
    filters = false
  const modes = new Set<Blending>()
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      into = item.transmissive ? transmission : blend
    const sides = sidesOf(item),
      vertexCull = !!item.paged && sides.length === MAX_SIDES
    filters ||= filtersDisplay(BLEND_MODES[Math.floor(sides[0] / 3)])
    modes.add(BLEND_MODES[Math.floor(sides[0] / 3)])
    for (const side of sides) {
      into.push(planEntry(i, side, !!item.paged, vertexCull))
      if (item.paged) continue
      if (item.transmissive) transmissionTriangles += item.count / 3
      else blendTriangles += item.count / 3
    }
  }
  blendState.seeds = [Uint32Array.from(blend), Uint32Array.from(transmission)]
  splitBlendClasses(blendState)
  planBlendOrder(blendState)
  blendState.blendTriangles = blendTriangles
  blendState.transmissionTriangles = transmissionTriangles
  blendState.filtersDisplay = filters
  blendState.planModes = [...modes]
}

/**
 * Each pass's MAIN CLASS — the shared entries of its most common pipeline, the lowest on a tie —
 * and its OWN entries, every other one, each its own draw slot (`runs.ts`). An item's entries
 * share its class: a paged double-sided item sets one pipeline for both sides (VERTEX CULL), an
 * unpaged one is never shared; they are consecutive seeds, which is how its own items are counted.
 * The own entries start in source order, the order the CPU then keeps sorting in place.
 */
function splitBlendClasses(blendState: WebgpuBlendState) {
  // An item the GPU keys itself has no own rank.
  const ranks = blendState.ownRanks.fill(NO_INDEX),
    owned: number[] = []
  for (let pass = 0; pass < EXPAND_PASSES; pass++) {
    const seeds = blendState.seeds[pass],
      shared = new Array<number>(PLAN_PIPELINE_MASK + 1).fill(0)
    for (const entry of seeds) if (planShared(entry)) shared[planPipeline(entry)]++
    const most = Math.max(...shared),
      main = most ? shared.indexOf(most) : -1
    const own: number[] = []
    let items = 0
    for (let seed = 0; seed < seeds.length; seed++) {
      const entry = seeds[seed]
      if (planShared(entry) && planPipeline(entry) === main) continue
      own.push(seed)
      const item = planItem(entry)
      if (ranks[item] === NO_INDEX) ranks[item] = owned.push(item) - 1
      if (own.length === 1 || planItem(seeds[own[own.length - 2]]) !== item) items++
    }
    blendState.mainPipeline[pass] = main
    blendState.ownSeeds[pass] = Uint32Array.from(own)
    blendState.ownSlots[pass] = new Uint32Array(own.length)
    const slots = seeds.length ? slotCount(own.length, items, main >= 0) : 0
    blendState.slotOwns[pass] = new Int32Array(slots)
    blendState.slotCounts[pass] = slots
  }
  blendState.ownItems = Uint32Array.from(owned)
}

/** Where the frame data puts the own keys and seeds, and the order kernel's dispatches. */
function planBlendOrder(blendState: WebgpuBlendState) {
  const layout = blendState.frameLayout
  layout.ownKeys = FRAME_HEAD.words
  let at = layout.ownKeys + 2 * blendState.ownItems.length
  let step = 0
  for (let pass = 0; pass < EXPAND_PASSES; pass++) {
    layout.ownSeeds[pass] = at
    layout.ownSlots[pass] = at + blendState.ownSeeds[pass].length
    at += 2 * blendState.ownSeeds[pass].length
    const entries = blendState.seeds[pass].length
    blendState.orderSteps[pass] = entries
      ? planOrderSteps(
          {
            entries,
            ownCount: blendState.ownSeeds[pass].length,
            main: blendState.mainPipeline[pass] >= 0,
            region: blendState.planRegions[pass],
            ownSeedBase: layout.ownSeeds[pass],
            ownSlotBase: layout.ownSlots[pass],
            ownKeyBase: layout.ownKeys,
          },
          blendState.orderStepWords,
          step,
          blendState.uniformStride,
        )
      : []
    step += blendState.orderSteps[pass].length
  }
  layout.words = at
  blendState.planMoved = true
}
