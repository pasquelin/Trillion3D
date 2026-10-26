// The image every reflection proof reads (`rig.ts`): the image a still view of a frame holds after a
// fixed count of images drawn as a frame loop draws them — one image an animation frame —, enough
// for the history to fill (`reflectionMaxFramesAccumulated`, twice over), its reflection target read back.
import { animationFrame } from '../../kit/device/frame.ts'
import { defaultReflections } from '../../../packages/sdk-core/src/contracts/reflectionOptions.ts'
import { openRig } from './rig.ts'
import type { RigFrame } from './rigFrame.ts'

type Rig = Awaited<ReturnType<typeof openRig>>

/** The images a still view draws before it is read: its history full twice over. */
const STILL_IMAGES = 2 * defaultReflections().historyFrames

/** `images` images of `rig` drawn, one an animation frame; the view then holds a lit image
 *  of it (`settled`). */
async function untilSettled(rig: Rig, images = STILL_IMAGES) {
  for (let image = 0; image < images; image++) {
    rig.image()
    await animationFrame()
  }
  if (!rig.settled()) throw new Error(`the view holds no image after ${images} images`)
  return images
}

/** The reflection target a still view of `frame` on `device` holds after `STILL_IMAGES` images, its
 *  raw half-float words; the rig made for it disposed. */
export async function settledImage(device: GPUDevice, frame: RigFrame) {
  const rig = await openRig(device, frame)
  await untilSettled(rig)
  const words = await rig.read()
  rig.dispose()
  return words
}
