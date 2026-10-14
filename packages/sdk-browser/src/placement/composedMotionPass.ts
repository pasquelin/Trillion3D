/**
 * THE LINKED PLACEMENTS' MOTION (`gpuCompose.ts`), in the image's own command buffer. The roots
 * pass goes before every cut in a command buffer submitted at once (`rootPasses.ts`), before the
 * temporal pass decides this image: the decision is written here, then the motion pass encoded, so
 * the uniform it reads is the decided one, in queue order.
 */
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { packDoubles } from '../../../math/src/float/splitDouble.ts'
import { composeGroup } from '../webgpu/core/bindIdentity.ts'
import { COMPOSE_MOTION_PASS } from '../stage/passLabels.ts'
import { MOTION_KEEP, MOTION_RESET, MOTION_SCAN } from './composedMotionWgsl.ts'
import { composeKernels } from './gpuComposeFrame.ts'
import { motionEntries } from './gpuComposeEntries.ts'
import { dispatchGroup } from './rootListPass.ts'

/**
 * The temporal pass's decision for the linked roots' motion — a restart without `history`, a
 * compared image when the scene moved (`scan`), else one kept —, `eye` the one it reports the
 * motion to, then their motion into `encoder`: a thread each of the composed roots. Nothing on a
 * frame whose roots pass bound no motion, or another buffer than the temporal pass's.
 */
export function encodeComposedMotion(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  eye: ArrayLike<number>,
  history: boolean,
  scan: boolean,
) {
  const state = rt.compose,
    gpu = state?.gpu
  if (!state || !gpu || state.frame !== rt.run.frame) return
  if (!state.motionBound || state.motionBound !== rt.gpu.temporal?.motion.buffer) return
  const mode = !history ? MOTION_RESET : scan ? MOTION_SCAN : MOTION_KEEP
  state.motionMode[0] = mode
  packDoubles(state.motionMode, 2, eye, 0, 3)
  device.queue.writeBuffer(gpu.motionMode, 0, state.motionMode)
  // What the pass leaves: a restart takes every world as reference with no motion; a compared
  // image takes them too, its motion identity where the reference was current already; a kept one
  // writes identity and keeps the reference (`COMPOSE_MOTION_WGSL`).
  if (mode === MOTION_RESET) state.previousCurrent = state.motionIdentity = true
  else if (mode === MOTION_SCAN) {
    state.motionIdentity = state.ranCurrent
    state.previousCurrent = true
  } else state.motionIdentity = true
  const listed = state.rankList.set.count
  if (!gpu.rankList || !listed) return
  const pipeline = composeKernels.motion(device).get(),
    held = gpu.motionGroup
  held.identity.entries[0] ??= motionEntries(rt, gpu)
  composeGroup(device, held, pipeline)
  const pass = encoder.beginComputePass({ label: COMPOSE_MOTION_PASS })
  pass.setPipeline(pipeline)
  dispatchGroup(rt, pass, held, listed)
  pass.end()
}
