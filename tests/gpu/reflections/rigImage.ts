// The still image every reflection proof reads (`rig.ts`): two images of a frame, the first building
// the radiance pyramid the second reflects, and the second's reflection target read back.
import { openRig } from './rig.ts'
import type { RigFrame } from './rigFrame.ts'

/** The reflection target of the second of two still images of `frame` on `device`, its raw
 *  half-float words; the rig made for it disposed. */
export async function secondImage(device: GPUDevice, frame: RigFrame) {
  const rig = await openRig(device, frame)
  rig.image()
  rig.image()
  const words = await rig.read()
  rig.dispose()
  return words
}
