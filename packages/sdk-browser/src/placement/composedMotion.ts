/**
 * The temporal pass's word on the linked placements' motion (`gpuCompose.ts`), kept apart from the
 * compose passes so the temporal pass reaches it without their modules: the decision, and the
 * doubles' shader form it is written in.
 */
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

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
  packDoubles(state.motionMode, 2, [eye[0], eye[1], eye[2]])
  device.queue.writeBuffer(state.gpu.motionMode, 0, state.motionMode)
}

/** Writes `values` as doubles in the shader's form, high word then low word, from word `at`. */
export function packDoubles(out: Uint32Array, at: number, values: ArrayLike<number>) {
  for (let k = 0; k < values.length; k++) {
    cell[0] = values[k]
    out[at + k * 2] = cellWords[1]
    out[at + k * 2 + 1] = cellWords[0]
  }
}
const cell = new Float64Array(1),
  cellWords = new Uint32Array(cell.buffer)
