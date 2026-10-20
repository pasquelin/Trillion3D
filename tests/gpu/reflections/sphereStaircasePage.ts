// The engine side of the staircase proof: the mirror spheres over a dark floor (`sphereFrame.ts`)
// laid in the engine's inputs, still images through its kernels until the view is settled (`rig.ts`,
// `rigImage.ts`), the held reflection target read back. No resident proxy: what the screen cannot answer is the sky's, so
// that every pixel of the floor's reflection is the screen march's alone.
import { runOnDevice } from '../../kit/device/deviceProof.ts'
import { sphereFrame } from './sphereFrame.ts'
import { settledImage } from './rigImage.ts'

/** The reflection target's raw half-float words. */
type SphereReading = { words: number[] }

export function run() {
  return runOnDevice<SphereReading>(async (device, _events, result) => {
    result.words = Array.from(await settledImage(device, sphereFrame().frame))
  })
}
