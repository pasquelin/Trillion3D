import { wantsContractLighting } from '../pages/prepare/lightResources.ts'
import { deviceAnswer } from './deviceAnswer.ts'
import { taaArrivals } from '../../taa/frame.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { frameStart } from '../../frame/scheduling.ts'

/**
 * One of the interactive loop's first display frames: held — nothing drawn, the loop
 * asking the next frame at once (`pendingWebgpuFrame`) — while the display's refresh is measured
 * on intervals no work stretched (`ScaleControl.measuring`). Only the loop's frames: an
 * explicit render (`world.render`, `awaitPages`, a capture) always draws. Whether it held.
 */
export function measureWebgpuFrame(rt: WebgpuPagesRuntime) {
  if (rt.views.active !== rt.views.main || rt.capture.capturing || !rt.scale.measuring) return false
  rt.scale.tick(frameStart(), rt.timing.gpuTiming?.supported === true)
  if (!rt.scale.measuring) return false
  rt.scale.hold()
  return true
}

/** Wait for feedback, never capture image pixels or bypass frame admission budgets. */
export async function pendingWebgpuFrame(rt: WebgpuPagesRuntime) {
  const { run, gpu, vis, services } = rt
  if (run.lost) throw new Error('WEBGPU_LOST')
  // A frame held to measure the display's refresh waits for nothing (`ScaleControl.held`).
  if (rt.scale.held) return true
  // What the device still answers for: its answer asks a frame, held or not.
  const answer = deviceAnswer(rt)
  if (answer) {
    await answer
    return true
  }
  // A held frame asks nothing more: what it waited for — the lit program among them — is answered
  // above (`deviceAnswer`), and a failed compile leaves the loop idle.
  if (run.frameHeld) return false
  await gpu.device?.queue.onSubmittedWorkDone()
  await run.gpuSelection?.flush()
  if (gpu.deferred && wantsContractLighting(rt)) await gpu.deferred.settle()
  // The next page the job lands, not its last: the frames draw while a long job loads (#836).
  await services.residency.progress()
  await vis.textures?.settled()
  // An image drawn while the effect programs compile is drawn again once, when they arrive,
  // rather than on every frame meanwhile, which would spend the loop's rounds (#349). Waited
  // last: the feedback above is not held back by a compilation.
  await gpu.effects?.settled()
  if (run.lost) throw new Error('WEBGPU_LOST')
  return true
}

/** What the view received so far, the interactive loop's progress (`frameScheduler.ts`): the camera
 *  pages made resident, and the quiet images a still average not yet whole took — a frame that adds
 *  either spends none of the settle limit, so the loop draws a still image to its hold (#836). */
export const webgpuLandings = (rt: WebgpuPagesRuntime) =>
  rt.services.residency.landings + taaArrivals(rt)
