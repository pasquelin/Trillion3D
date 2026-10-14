// The opaque trace over images of the sizes displays have, every pixel a mirror: its half grid traced
// whole and upsampled to every pixel (`reflections/traceHalf.ts`).
// The reflection target is set to a not-a-number first; after the second image — the first builds
// the radiance pyramid the screen is marched on — each of its words must have been written.
import { perspectiveProjection } from '../../../packages/math/src/projection/camera.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { openRig } from './rig.ts'
import { HALF_NAN, rigFrameOf } from './rigFrame.ts'
import { MODEL_FLAG } from '../../../packages/sdk-browser/src/scene/surfaceModel.ts'

/** What the proof reads: per size, the pixels the trace left as it found them. */
export type CoverageReading = { sizes: { size: number[]; unwritten: number }[] }

/** A wall facing the eye at a depth of 0.3 of its near plane, lit: every pixel a mirror. */
function wall(width: number, height: number) {
  const viewProjection = perspectiveProjection(new Float64Array(16), 60, width / height, 0.1, 1)
  const frame = rigFrameOf([width, height], viewProjection, [0, 0, 0])
  frame.depth.fill(0.3)
  frame.flags.fill(MODEL_FLAG.physical)
  for (let p = 0; p < width * height; p++) {
    frame.normals.set([0, 0, 1, 0], p * 4)
    frame.base.set([1, 1, 1, 1], p * 4)
    frame.radiance.set([0.5, 0.5, 0.5, 1], p * 4)
  }
  return frame
}

export function run(sizes: number[][]) {
  return runOnDevice<CoverageReading>(async (device, _events, result) => {
    result.sizes = []
    for (const [width, height] of sizes) {
      const rig = await openRig(device, wall(width, height))
      rig.image()
      rig.fill(HALF_NAN)
      rig.image()
      const words = await rig.read()
      let unwritten = 0
      for (let p = 0; p < width * height; p++)
        if ((words[4 * p + 3] & 0x7fff) !== 0x3c00) unwritten++
      result.sizes.push({ size: [width, height], unwritten })
      rig.dispose()
    }
  })
}
