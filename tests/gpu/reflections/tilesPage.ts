// The opaque trace over images of the sizes displays have, every pixel a mirror: the tiles it lists
// outnumber what one dimension of a dispatch holds (3840 × 2160 lists 129,600, against the 65,535
// of a dimension), and it traces them all, in rows (`reflections/trace.ts`, `gpu/dispatch/grid.ts`).
// The reflection target is set to a not-a-number first; after the second image — the first builds
// the radiance pyramid the screen is marched on — each of its words must have been written.
import { perspectiveSlope } from '../../../packages/math/src/projection/camera.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { openRig } from './rig.ts'
import { HALF_NAN } from './rigFrame.ts'

/** What the proof reads: per size, the pixels the trace left as it found them, and the tiles the
 *  image holds. */
export type TilesReading = { sizes: { size: number[]; unwritten: number; tiles: number }[] }

/** A wall facing the eye at a depth of 0.3 of its near plane, lit: every pixel a mirror. */
function wall(width: number, height: number) {
  const f = 1 / perspectiveSlope(60)
  const viewProjection = new Float64Array([
    f / (width / height),
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    0,
    -1,
    0,
    0,
    0.1,
    0,
  ])
  const pixels = width * height
  const fill = (values: number[]) => {
    const out = new Float32Array(pixels * values.length)
    for (let p = 0; p < pixels; p++) out.set(values, p * values.length)
    return out
  }
  return {
    size: [width, height] as const,
    viewProjection,
    eye: [0, 0, 0] as const,
    depth: new Float32Array(pixels).fill(0.3),
    flags: new Uint8Array(pixels).fill(2),
    normals: fill([0, 0, 1, 0]),
    base: fill([1, 1, 1, 1]),
    radiance: fill([0.5, 0.5, 0.5, 1]),
  }
}

export function run(sizes: number[][]) {
  return runOnDevice<TilesReading>(async (device, _events, result) => {
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
      result.sizes.push({
        size: [width, height],
        unwritten,
        tiles: ceilDiv(width, 8) * ceilDiv(height, 8),
      })
      rig.dispose()
    }
  })
}
