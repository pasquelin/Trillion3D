import { retire } from '../../../gpu/core/frameRetire.ts'
import type { ResolveFrame } from '../webgpuKinds.ts'
import { bytesOf, makeHistory } from './dofImages.ts'
import type { Held } from './dofHeld.ts'
import type { DofPlan } from './dofPlan.ts'

/**
 * THE HISTORY OF A DEPTH OF FIELD's accumulation of its setup: two images that take turns (`Held.stable`),
 * made when the plan accumulates the setup in time and given back when it does not, and what says whether
 * the last image wrote the one the next reads (`Held.history`) — and for which display.
 */

/** The images of the history of `held`, as the setup images each hold two. */
const historyImages = (held: Held) => held.stable?.flatMap(({ color, coc }) => [color, coc]) ?? []

/** Bytes of the history `held` keeps. */
export const historyBytes = (held: Held) => bytesOf(historyImages(held), [])

/** Gives back the history of `held`, once the frame that may name it is submitted. */
export function dropHistory(device: GPUDevice, held: Held) {
  for (const { texture } of historyImages(held)) retire(device, texture)
  held.stable = undefined
  held.stableKey = ''
  held.history = false
}

/**
 * Makes the images the setup of `plan` is accumulated in — given back where the plan does not, made
 * again where their size moved: the history is then none — and says whether the history describes the
 * last image. An image drawn replaces it (`markDrawn`); one not drawn, a pipeline not compiled,
 * leaves it.
 */
export function fitHistory(device: GPUDevice, held: Held, plan: DofPlan) {
  const key = plan.temporal && !plan.idle ? `${plan.preBuffer}` : ''
  if (key !== held.stableKey) {
    dropHistory(device, held)
    if (key) held.stable = makeHistory(device, plan)
    held.stableKey = key
  }
  return held.history
}

/** The image of `plan` was encoded: its setup, where it is accumulated, is the history of the next, in
 *  the rectangle of the display it was drawn for, and the two images change turns. */
export function markDrawn(held: Held, plan: DofPlan, frame: ResolveFrame) {
  held.history = plan.temporal
  held.historyDisplay[0] = frame.display[0]
  held.historyDisplay[1] = frame.display[1]
  if (plan.temporal) held.parity = 1 - held.parity
}
