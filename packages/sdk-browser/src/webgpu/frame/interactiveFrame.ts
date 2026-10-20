import { wantsContractLighting } from '../pages/prepare/contractLight.ts'
import { deviceAnswer } from './deviceAnswer.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { frameStart } from '../../frame/scheduling.ts'
import { DAG_READBACK_SLOTS } from '../../gpu/dag/layout.ts'

/**
 * One of the interactive loop's first display frames: held — nothing drawn, the loop
 * asking the next frame at once (`pendingWebgpuFrame`) — while the display's refresh is measured
 * on intervals no work stretched (`ScaleControl.measuring`). Only the loop's frames: an
 * explicit render (`world.render`, `awaitPages`, a capture) always draws. Whether it held.
 */
export function measureWebgpuFrame(rt: WebgpuPagesRuntime) {
  const { scale } = rt.views.main
  if (rt.views.active !== rt.views.main || rt.capture.capturing || !scale.measuring) return false
  scale.tick(frameStart(), rt.timing.gpuTiming?.supported === true)
  if (!scale.measuring) return false
  scale.hold()
  return true
}

/**
 * Whether the device still runs `DAG_READBACK_SLOTS` of the loop's images: the CPU of one hides
 * behind the GPU of the one before, a further one would only queue. The display's own pacing is no
 * bound: a GPU slower than the refresh would otherwise pile frames up on the device, and every
 * readback behind them. Admission, not cadence.
 */
const deviceSaturated = (rt: WebgpuPagesRuntime) => rt.run.gpuFramesInFlight >= DAG_READBACK_SLOTS

/**
 * Whether the interactive loop leaves out the display frame that began: while the device is
 * saturated (`deviceSaturated`), and under the frame cap (`ScaleControl.skips`,
 * `../../frame/cadence.ts`). Only the main view's loop frames: an explicit render, a capture or
 * another view always draws.
 */
export const skipsWebgpuFrame = (rt: WebgpuPagesRuntime) =>
  rt.views.active === rt.views.main &&
  !rt.capture.capturing &&
  (deviceSaturated(rt) || rt.views.main.scale.skips(frameStart()))

/** Wait for feedback, never capture image pixels or bypass frame admission budgets. */
export async function pendingWebgpuFrame(rt: WebgpuPagesRuntime) {
  const { run, gpu, vis } = rt
  if (run.lost) throw new Error('WEBGPU_LOST')
  // A frame held to measure the display's refresh waits for nothing (`ScaleControl.held`).
  if (rt.views.main.scale.held) return true
  // What the device still answers for: its answer asks a frame, held or not.
  const answer = deviceAnswer(rt)
  if (answer) {
    await answer
    return true
  }
  // A held frame asks nothing more: what it waited for — the lit program among them — is answered
  // above (`deviceAnswer`), and a failed compile leaves the loop idle.
  if (run.frameHeld) return false
  // Asked at the frame's submit, all three: the feedback answers for this frame's GPU work and the
  // reads it queued, never for a frame the loop draws meanwhile (`FRAMES_IN_FLIGHT`).
  const work = gpu.device?.queue.onSubmittedWorkDone(),
    cut = run.gpuSelection?.flush(),
    textures = vis.textures?.settled()
  await Promise.all([work, cut, textures])
  if (gpu.deferred && wantsContractLighting(rt)) await gpu.deferred.settle()
  // An image drawn while the effect programs compile is drawn again once, when they arrive,
  // rather than on every frame meanwhile, which would spend the loop's rounds. Waited
  // last: the feedback above is not held back by a compilation.
  await gpu.effects?.settled()
  if (run.lost) throw new Error('WEBGPU_LOST')
  return true
}
