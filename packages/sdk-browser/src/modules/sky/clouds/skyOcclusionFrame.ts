import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import { normalizeVector3 } from '../../../../../math/src/vector/vector.ts'
import type { CloudSkyOcclusionLight } from '../../../../../sdk-core/src/modules/sky/cloudSkyOcclusion.ts'
import type { SkyQualityValues } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import {
  CM_PER_KM,
  CM_PER_M,
  KM_PER_CM,
  LEAST_SNAP_KM,
  lookAtMap,
  product,
  reversedOrthoMap,
  rowsAsMap,
  sceneToMaterial,
  shiftMap,
  VERTICAL,
  type CloudShadowFrame,
} from './shadowFrame.ts'

/**
 * WHERE THE CLOUDS' SKY OCCLUSION MAP LOOKS: an orthographic view with the depth reversed (near
 * plane 1, far plane 0) of a square round the point of the planet's surface under the camera, along
 * the planet's vertical, toward the planet's centre. The map of a light (`./shadowFrame.ts`) in
 * the same form, and the same trace reads it. Its steps, in centimetres, on the material's axes:
 * 1. the point looked at is the planet's centre plus the unit vector from the centre to the camera
 *    times the planet's radius, each coordinate rounded to the grid of `cloudSkyAOSnapKm`;
 * 2. the trace direction is the unit vector from that point to the planet's centre;
 * 3. the depth range is the layer's top altitude plus one snap length; the far plane is twice it;
 *    the map's eye lies behind the point, against the trace direction, by the depth range;
 * 4. the view looks from the eye at the point, its up the vertical, or the forward axis where the
 *    trace is nearly vertical (a dot above 0.99); the projection keeps `1 / diameter` of each
 *    side, the diameter being twice the extent, and the depth range 0 to the far plane.
 * There is no snap to the pixel grid. The matrices are given from the position in centimetres
 * from the camera, on the scene's axes, as the shadow map's are.
 */

/** What the frame of the sky occlusion map is made from. */
export interface CloudSkyOcclusionFrameInput {
  /** The camera in the scene, metres, and from the planet's centre, kilometres (the air's frame). */
  readonly eye: ArrayLike<number>
  readonly eyeFromPlanetKm: ArrayLike<number>
  /** The planet's radius, kilometres. */
  readonly planetRadiusKm: number
  /** The cloud layer's base altitude and thickness, kilometres. */
  readonly layerBaseKm: number
  readonly layerThicknessKm: number
  readonly light: CloudSkyOcclusionLight
  /** The sky's quality settings of the map: `cloudSkyAOSnapKm` and `cloudSkyAOTraceSamples`. */
  readonly quality: Pick<SkyQualityValues, 'cloudSkyAOSnapKm' | 'cloudSkyAOTraceSamples'>
}

/** The frame of the sky occlusion map, in the form of the shadow map's (`CloudShadowFrame`), its
 *  `samples` the quality's `cloudSkyAOTraceSamples`. The snap length is held at `LEAST_SNAP_KM` or
 *  more before it becomes centimetres: the rounding divides by it, and a length of 0 or less (the
 *  quality setting accepts any number) would turn every matrix into not-a-number values. */
export function cloudSkyOcclusionFrame(input: CloudSkyOcclusionFrameInput): CloudShadowFrame {
  const { light, quality } = input
  const camera = sceneToMaterial(input.eye).map((v) => v * CM_PER_M)
  const centre = sceneToMaterial(input.eyeFromPlanetKm).map((v, k) => camera[k] - v * CM_PER_KM)

  const up = sceneToMaterial(input.eyeFromPlanetKm)
  normalizeVector3(up)
  const snap = Math.max(LEAST_SNAP_KM, quality.cloudSkyAOSnapKm) * CM_PER_KM
  const lookAt = up.map((v, k) => centre[k] + v * input.planetRadiusKm * CM_PER_KM)
  const snapped = lookAt.map((v) => Math.floor((v + 0.5 * snap) / snap) * snap)

  const traceDirection = centre.map((v, k) => v - snapped[k])
  normalizeVector3(traceDirection)

  const diameter = light.cloudAmbientOcclusionExtentKm * CM_PER_KM * 2
  const depthRange = (input.layerBaseKm + input.layerThicknessKm) * CM_PER_KM + snap
  const far = 2 * depthRange
  const vertical = Math.abs(traceDirection[2]) > VERTICAL ? [1, 0, 0] : [0, 0, 1]
  const eyeOfMap = snapped.map((v, k) => v - traceDirection[k] * depthRange)
  const view = lookAtMap(eyeOfMap, snapped, vertical)
  const worldToClip = product(reversedOrthoMap(diameter, diameter, 1 / far, 0), view)

  const toMaterial = rowsAsMap([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1])
  const clipFromCamera = product(worldToClip, product(shiftMap(camera), toMaterial))
  const [x, y, z] = sceneToMaterial(traceDirection)
  return {
    clipFromCamera,
    cameraFromClip: invertMatrix4(new Float64Array(16), clipFromCamera),
    rayDirection: [x, y, z],
    farDepthKm: far * KM_PER_CM,
    samples: quality.cloudSkyAOTraceSamples,
  }
}
