// The engine side of the staircase proof: the mirror spheres over a dark floor (`sphereFrame.ts`)
// laid in the engine's inputs, two still images through its kernels (`rig.ts`), the second's
// reflection target read back. No resident proxy: what the screen cannot answer is the sky's, so
// that every pixel of the floor's reflection is the screen march's alone.
import { runOnDevice } from '../kit/deviceProof.ts'
import { sphereFrame } from './sphereFrame.ts'
import { openRig } from './rig.ts'

/** The reflection target's raw half-float words. */
export type SphereReading = { words: number[] }

export function run() {
  return runOnDevice<SphereReading>(async (device, _events, result) => {
    const rig = await openRig(device, sphereFrame().frame)
    rig.image()
    rig.image()
    result.words = Array.from(await rig.read())
    rig.dispose()
  })
}
