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
import { MOTION_LIST } from './gpuComposeGpu.ts'
import { motionEntries } from './gpuComposeEntries.ts'
import { dispatchGroup, sendWords } from './rootListPass.ts'
import { writePassParams } from '../gpu/core/passParams.ts'
import { noteMoved, takeMoved } from './rootMoves.ts'
import { everyComposed, type ComposeState } from './gpuComposeState.ts'

/**
 * The roots the motion pass writes this image (`ComposeState.owed`): those moved since their world
 * was last taken as reference, and those whose row the last compared image may have left other
 * than identity — every composed root on a restart or into a motion buffer it never wrote. What it
 * leaves owed: a restart nothing; a compared image the rows of the roots it took anew; a kept one
 * the references it did not take.
 */
function motionRanks(state: ComposeState, mode: number) {
  const { reference, motion } = state.owed
  if (mode === MOTION_RESET) reference.whole = motion.whole = true
  // The roots owed a reference joined into those owed a row, each once: the pass's roots.
  const stale = takeMoved(reference)
  if (stale) noteMoved(motion, stale)
  else motion.whole = true
  const ranks = takeMoved(motion) ?? everyComposed(state)
  if (mode === MOTION_SCAN) {
    if (stale) noteMoved(motion, stale)
    else motion.whole = true
  } else if (mode === MOTION_KEEP) {
    if (stale) noteMoved(reference, stale)
    else reference.whole = true
  }
  return ranks
}

/**
 * The temporal pass's decision for the linked roots' motion — a restart without `history`, a
 * compared image when the scene moved (`scan`), else one kept —, `eye` the one it reports the
 * motion to, then their motion into `encoder`: a thread each of the roots it is owed
 * (`motionRanks`). Nothing on a frame whose roots pass bound no motion, or another buffer than the
 * temporal pass's.
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
  // What the pass leaves (`COMPOSE_MOTION_WGSL`) is what the roots owe after it (`motionRanks`): a
  // motion buffer bound anew owes every root both (`encodeRootsPass`).
  const ranks = motionRanks(state, mode)
  if (!ranks.length) return
  gpu.motionList = sendWords(device, gpu.motionList, ranks, ranks.length, MOTION_LIST)
  writePassParams(device, gpu.motionParams, state.roots, ranks.length)
  const pipeline = composeKernels.motion(device).get(),
    held = gpu.motionGroup
  held.identity.entries[0] ??= motionEntries(rt, gpu)
  composeGroup(device, held, pipeline)
  const pass = encoder.beginComputePass({ label: COMPOSE_MOTION_PASS })
  pass.setPipeline(pipeline)
  dispatchGroup(rt, pass, held, ranks.length)
  pass.end()
}
