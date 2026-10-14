/**
 * The invalidation's phases recorded (step 7): each packed (`packPhase`, `invalidationPack.ts`) and
 * dispatched in its own slot (`dispatchPhase`, `invalidationPass.ts`).
 */
import { dispatchPhase, slotOf } from './invalidationPass.ts'
import type { VsmInvalidationPhase } from './invalidationPhase.ts'
import { packPhase } from './invalidationPack.ts'
import type { VsmResources } from './resources.ts'

/** The previous frame the invalidation reads (its uniforms and shadow map slot count). */
interface VsmInvalidationFrame {
  device: GPUDevice
  mapSlotCount: number
}

/**
 * Records the invalidation dispatches of `phases` (in order: before the scene update, after it,
 * then the engine's box phase). Nothing when the previous frame had no shadow map slots
 * or a phase has no instance. Must run before `swapFrames()` of this frame and before
 * `encodeVsmPageCarry`. Returns the number of (instance, VSM) pairs dispatched.
 */
export function encodeVsmInvalidations(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  prevFrame: VsmInvalidationFrame,
  phases: readonly (VsmInvalidationPhase | null | undefined)[],
) {
  if (!(prevFrame.mapSlotCount > 0)) return 0
  let total = 0,
    k = 0
  for (const phase of phases) {
    const packed = phase && packPhase(phase)
    if (!packed) continue
    dispatchPhase(encoder, res, prevFrame.device, slotOf(prevFrame.device, res, k++), packed)
    total += packed.threads
  }
  return total
}
