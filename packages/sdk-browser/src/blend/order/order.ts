import { sortSeedsFarToNear } from '../sortPlan.ts'
import { assignOwnSlots } from '../runs.ts'
import { planPipeline } from '../plan/plan.ts'
import { eyeKey } from '../eyeKey.ts'
import { FRAME_HEAD } from '../frame/frameHead.ts'
import { writeFramePlanes } from '../frame/framePlanes.ts'
import type { WebgpuBlendState } from '../state.ts'

/**
 * PAINT ORDER OF TRANSPARENT SURFACES, REDONE EVERY FRAME.
 *
 * A blend pipeline does not write depth (`../pipelines.ts`): two transparent surfaces are
 * therefore separated by nothing other than the order they are encoded in. The encoding plan is a
 * SCENE object — source order, rebuilt only when matrices move — and cannot carry this decision,
 * which depends on the eye.
 *
 * WHAT WE RANK ON: the square of the eye-to-WORLD-box-centre distance of the item, decreasing —
 * farthest first, nearest last. A frank distance, never a normalised depth: the engine convention
 * is inverted (`../../camera/depthConvention.ts`) and ranking on it would read backwards. The square
 * is enough, it is monotonic in the distance. THE GAP IS TAKEN RELATIVE TO THE EYE, bound by bound,
 * before being averaged: that is the space of the rest of the path, and an absolute world centre
 * would lose its useful bits far from the origin.
 *
 * WHO RANKS: the GPU ranks every entry of a pass (`orderWgsl.ts`), on these very keys computed in
 * emulated doubles, the CPU's to the bit. The CPU ranks only the own entries, the ones it must
 * encode one draw each (`../runs.ts`) — none in a pass of one class — and sends the GPU the eye and
 * their order.
 */

/**
 * The frame data the kernels read (`frameLayout`, `../frame/frameHead.ts`): the eye, the frustum planes
 * brought to it in single precision (`../frame/framePlanes.ts`) and the item count the verdict tests, then
 * the own seeds in paint order and their slots.
 */
function writeOrderFrame(blendState: WebgpuBlendState, eye: ArrayLike<number>) {
  const { frameDoubles: doubles, frameWords: words, frameLayout: layout } = blendState
  doubles[0] = eye[0]
  doubles[1] = eye[1]
  doubles[2] = eye[2]
  doubles[3] = 0
  writeFramePlanes(words, blendState.blendPlanes, eye)
  words[FRAME_HEAD.items] = blendState.blendGpu.length
  words.set(blendState.ownSeeds, layout.ownSeeds)
  words.set(blendState.ownSlots, layout.ownSlots)
}

/**
 * The frame's share of the CPU in the order: the own entries' keys and paint order, the frame data
 * for the GPU, and the slots the pass draws. The frustum verdict is the GPU's, in the same
 * submission (`../verdict/verdictWgsl.ts`): the CPU reads no item's box here but the own items' keys.
 *
 * WITHOUT AN EYE, NOTHING IS PAINTED: a frame without a camera has no paint order, and no slot.
 */
export function orderBlendPasses(blendState: WebgpuBlendState, eye: ArrayLike<number> | undefined) {
  if (!eye || !blendState.blendGpu.length) {
    blendState.runCount = 0
    return
  }
  const { blendGpu: items, ownItems, orderKeys, orderPriorities, seeds, ownSeeds } = blendState
  for (let k = 0; k < ownItems.length; k++)
    orderKeys[ownItems[k]] = eyeKey(items[ownItems[k]], eye[0], eye[1], eye[2])
  sortSeedsFarToNear(ownSeeds, seeds, orderKeys, orderPriorities)
  if (seeds.length)
    assignOwnSlots(
      seeds,
      ownSeeds,
      blendState.mainPipeline >= 0,
      blendState.ownSlots,
      blendState.slotOwns,
    )
  blendState.runCount = blendState.slotCount
  fillSlotPipelines(blendState)
  writeOrderFrame(blendState, eye)
}

/** The pipeline rank each slot sets this frame (`slotPipelines`): its own entry's, or the main
 *  class's for a gap. */
function fillSlotPipelines(blendState: WebgpuBlendState) {
  const { slotOwns, slotPipelines, seeds, ownSeeds, mainPipeline } = blendState
  for (let slot = 0; slot < blendState.runCount; slot++) {
    const own = slotOwns[slot]
    slotPipelines[slot] = own >= 0 ? planPipeline(seeds[ownSeeds[own]]) : mainPipeline
  }
}
