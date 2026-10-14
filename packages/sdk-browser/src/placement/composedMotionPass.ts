/**
 * THE LINKED PLACEMENTS' MOTION (`gpuCompose.ts`), in the image's own command buffer. The roots
 * pass goes before every cut in a command buffer submitted at once (`rootPasses.ts`), before the
 * temporal pass decides this image: the motion it bound is written here, after the decision
 * (`decideComposedMotion`), so the uniform it reads is the decided one, in queue order.
 */
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { composeGroup } from '../webgpu/core/bindIdentity.ts'
import { COMPOSE_MOTION_PASS } from '../stage/passLabels.ts'
import { decideComposedMotion, MOTION_KEEP, MOTION_RESET, MOTION_SCAN } from './composedMotion.ts'
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
  const mode = !history ? MOTION_RESET : scan ? MOTION_SCAN : MOTION_KEEP
  decideComposedMotion(rt, device, eye, mode)
  const state = rt.compose,
    gpu = state?.gpu,
    listed = state?.rankList.set.count ?? 0
  if (!state || !gpu?.rankList || !listed || state.frame !== rt.run.frame) return
  if (!state.motionBound || state.motionBound !== rt.gpu.temporal?.motion.buffer) return
  const pipeline = composeKernels.motion(device).get(),
    held = gpu.motionGroup
  held.identity.entries[0] ??= motionEntries(rt, gpu)
  composeGroup(device, held, pipeline)
  const pass = encoder.beginComputePass({ label: COMPOSE_MOTION_PASS })
  pass.setPipeline(pipeline)
  dispatchGroup(rt, pass, held, listed)
  pass.end()
}
