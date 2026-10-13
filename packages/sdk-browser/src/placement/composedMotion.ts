/**
 * The temporal pass's word on the linked placements' motion (`gpuCompose.ts`), kept apart from the
 * compose passes so the temporal pass reaches it without their modules: the decision, written as
 * the shaders hold a double (`packDoubles`).
 */
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { packDoubles } from '../../../math/src/float/splitDouble.ts'

/** What the temporal pass decided for the linked roots' motion this image (`decideComposedMotion`):
 *  nothing, a restart, an image whose poses are not compared, one whose poses are. */
export const MOTION_SKIP = 0,
  MOTION_RESET = 1,
  MOTION_KEEP = 2,
  MOTION_SCAN = 3

/**
 * The temporal pass's decision for this image's motion (`MOTION_*`), `eye` the one it reports the
 * motion to: written after the roots pass was encoded and before the image is submitted, it is what
 * that pass reads. Nothing when this frame's roots pass bound no motion buffer, or another one.
 */
export function decideComposedMotion(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  eye: ArrayLike<number>,
  mode: number,
) {
  const state = rt.compose
  if (!state?.gpu || state.frame !== rt.run.frame) return
  if (!state.motionBound || state.motionBound !== rt.gpu.temporal?.motion.buffer) return
  state.motionMode[0] = mode
  packDoubles(state.motionMode, 2, eye, 0, 3)
  device.queue.writeBuffer(state.gpu.motionMode, 0, state.motionMode)
  // What the pass leaves: a restart takes every world as reference with no motion; a compared
  // image takes them too, its motion identity where the reference was current already; a kept one
  // writes identity and keeps the reference (`COMPOSE_ROOTS_WGSL`).
  if (mode === MOTION_RESET) state.previousCurrent = state.motionIdentity = true
  else if (mode === MOTION_SCAN) {
    state.motionIdentity = state.ranCurrent
    state.previousCurrent = true
  } else if (mode === MOTION_KEEP) state.motionIdentity = true
}
