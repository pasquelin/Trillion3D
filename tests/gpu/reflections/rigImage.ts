// The still image every reflection proof reads (`rig.ts`): the image a still view of a frame holds,
// drawn as a frame loop draws while the view is unsettled — one image an animation frame, the lit
// image's hash coming back some frames later — until the reflections are settled
// (`reflectionsSettled`: the history frozen, the lit image final), its reflection target read back.
import { animationFrame } from '../kit/frame.ts'
import { openRig } from './rig.ts'
import type { RigFrame } from './rigFrame.ts'

type Rig = Awaited<ReturnType<typeof openRig>>

/** Images of `rig` drawn until its view is settled, at most `limit`: how many were drawn. */
export async function untilSettled(rig: Rig, limit = 60) {
  let images = 0
  while (!rig.settled() && images < limit) {
    rig.image()
    images++
    await animationFrame()
  }
  if (!rig.settled()) throw new Error(`the view never settled in ${limit} images`)
  return images
}

/** The reflection target a still view of `frame` on `device` holds once settled, its raw half-float
 *  words; the rig made for it disposed. */
export async function settledImage(device: GPUDevice, frame: RigFrame) {
  const rig = await openRig(device, frame)
  await untilSettled(rig)
  const words = await rig.read()
  rig.dispose()
  return words
}
