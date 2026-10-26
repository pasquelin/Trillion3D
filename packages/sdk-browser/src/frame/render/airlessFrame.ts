import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { airlessAirOf, type AirlessAir } from '../../lighting/atmosphere/airless.ts'
import { airlessPlanet, FRAME_FLOATS, writeAirFrame } from '../../lighting/atmosphere/frame.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { viewProj } from '../backend/helpers.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * THE FRAME OF THE CLOUDS' AIR WHERE THE SCENE HAS NO ATMOSPHERE: the stand-in tables of such an
 * air (`airlessAirOf`) and its frame, written for this image — the eye over the planet the clouds
 * stand on (`airlessPlanet`, the clouds part's own radius), the image's matrices and size — as the
 * atmosphere's own frame is where there is one (`encodeAtmosphere`). The clouds' shadow maps and
 * the trace read it; the first of them to ask in an image writes it, the same words for the image
 * the others draw. The clouds read the pre-exposure from their own block, not from the frame's.
 */

const frame = new Float32Array(FRAME_FLOATS)
const inverse = new Float64Array(16)
/** The image each runtime's frame was last written for. */
const written = new WeakMap<WebgpuPagesRuntime, number>()

/** The air of a scene with no atmosphere, its frame written for `cam`'s image over a planet of
 *  `planetRadiusKm` kilometres, once an image. */
export function writeAirlessFrame(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
  planetRadiusKm: number,
): AirlessAir {
  const air = airlessAirOf(device)
  if (written.get(rt) === rt.run.frame) return air
  written.set(rt, rt.run.frame)
  const [width, height] = rt.gpu.targetSize
  invertMatrix4(inverse, viewProj)
  writeAirFrame(frame, cam, airlessPlanet(planetRadiusKm), viewProj, inverse, width, height, {
    frameIndex: rt.run.frame,
  })
  device.queue.writeBuffer(air.frame, 0, frame)
  return air
}
