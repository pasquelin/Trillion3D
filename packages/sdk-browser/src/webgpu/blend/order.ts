import { sortSeedsFarToNear } from './sortPlan.ts'
import { assignOwnSlots } from './runs.ts'
import { eyeKey } from './eyeKey.ts'
import { FRAME_HEAD } from './frameHead.ts'
import { writeFramePlanes } from './framePlanes.ts'
import type { WebgpuBlendState } from './state.ts'

/**
 * PAINT ORDER OF TRANSPARENT SURFACES, REDONE EVERY FRAME.
 *
 * A blend pipeline does not write depth (`pipelines.ts`): two transparent surfaces are
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
 * emulated doubles. The CPU ranks only the own entries, the ones it must encode one draw each
 * (`runs.ts`) — none in a pass of one class — and sends the GPU the eye, their keys and their order.
 */

/**
 * The frame data the kernels read (`frameLayout`, `frameHead.ts`): the eye, the frustum planes
 * brought to it in single precision (`framePlanes.ts`) and the item count the verdict tests, each
 * own item's key — a NaN as the GPU's one NaN pattern, all ones —, then each pass's own seeds in
 * paint order and their slots. The water pass writes its own words of the head
 * (`../water/frameWords.ts`).
 */
function writeOrderFrame(blendState: WebgpuBlendState, eye: ArrayLike<number>) {
  const { frameDoubles: doubles, frameWords: words, frameLayout: layout } = blendState
  doubles[0] = eye[0]
  doubles[1] = eye[1]
  doubles[2] = eye[2]
  doubles[3] = 0
  writeFramePlanes(words, blendState.blendPlanes, eye)
  words[FRAME_HEAD.items] = blendState.blendGpu.length
  const own = blendState.ownItems,
    keys = blendState.orderKeys,
    first = layout.ownKeys / 2
  for (let k = 0; k < own.length; k++) {
    const key = keys[own[k]]
    doubles[first + k] = key
    if (key !== key) words.fill(0xffffffff, layout.ownKeys + 2 * k, layout.ownKeys + 2 * k + 2)
  }
  for (let pass = 0; pass < layout.ownSeeds.length; pass++) {
    words.set(blendState.ownSeeds[pass], layout.ownSeeds[pass])
    words.set(blendState.ownSlots[pass], layout.ownSlots[pass])
  }
}

/**
 * The frame's share of the CPU in the order: the own entries' keys and paint order, the frame data
 * for the GPU, and the slots each pass draws. The frustum verdict is the GPU's, in the same
 * submission (`verdictWgsl.ts`): the CPU reads no item's box here but the own items' keys.
 *
 * WITHOUT AN EYE, NOTHING IS PAINTED: a frame without a camera has no paint order, and no slot.
 */
export function orderBlendPasses(blendState: WebgpuBlendState, eye: ArrayLike<number> | undefined) {
  if (!eye || !blendState.blendGpu.length) {
    blendState.runCount[0] = 0
    blendState.runCount[1] = 0
    return
  }
  const { blendGpu: items, ownItems, orderKeys } = blendState
  for (let k = 0; k < ownItems.length; k++)
    orderKeys[ownItems[k]] = eyeKey(items[ownItems[k]], eye[0], eye[1], eye[2])
  for (let pass = 0; pass < blendState.seeds.length; pass++) {
    const seeds = blendState.seeds[pass],
      own = blendState.ownSeeds[pass]
    sortSeedsFarToNear(own, seeds, orderKeys)
    if (seeds.length)
      assignOwnSlots(
        seeds,
        own,
        blendState.mainPipeline[pass] >= 0,
        blendState.ownSlots[pass],
        blendState.slotOwns[pass],
      )
    blendState.runCount[pass] = blendState.slotCounts[pass]
  }
  writeOrderFrame(blendState, eye)
}
