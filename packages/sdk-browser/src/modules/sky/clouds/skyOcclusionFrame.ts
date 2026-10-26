import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import { normalizeVector3 } from '../../../../../math/src/vector/vector.ts'
import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import {
  cloudSkyOcclusionSide,
  type CloudSkyOcclusionLight,
} from '../../../../../sdk-core/src/modules/sky/cloudSkyOcclusion.ts'
import {
  CM_PER_KM,
  type SkyQualityValues,
} from '../../../../../sdk-core/src/modules/sky/quality.ts'
import {
  KM_PER_CM,
  mapAim,
  mapFromCamera,
  orthoMapAlong,
  sceneToMaterial,
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
interface CloudSkyOcclusionFrameInput {
  /** The camera in the scene, metres, and from the planet's centre, kilometres (the air's frame). */
  readonly eye: ArrayLike<number>
  readonly eyeFromPlanetKm: ArrayLike<number>
  /** The planet's radius, kilometres. */
  readonly planetRadiusKm: number
  /** The cloud layer's base altitude and thickness, kilometres. */
  readonly layerBaseKm: number
  readonly layerThicknessKm: number
  /** The sky light's `cloudAmbientOcclusionExtentKm`: the radius round the camera the map covers. */
  readonly extentKm: number
  /** The sky's quality settings of the map: `cloudSkyAOSnapKm` and `cloudSkyAOTraceSamples`. */
  readonly quality: Pick<SkyQualityValues, 'cloudSkyAOSnapKm' | 'cloudSkyAOTraceSamples'>
}

/** The frame of the sky occlusion map, in the form of the shadow map's (`CloudShadowFrame`), its
 *  `samples` the quality's `cloudSkyAOTraceSamples`. A snap length of 0 or less is read as the
 *  shadow map's is (`mapAim`). */
function cloudSkyOcclusionFrame(input: CloudSkyOcclusionFrameInput): CloudShadowFrame {
  const { quality } = input
  const aim = mapAim(
    input.eye,
    input.eyeFromPlanetKm,
    input.planetRadiusKm,
    quality.cloudSkyAOSnapKm,
  )

  const traceDirection = aim.centre.map((v, k) => v - aim.at[k])
  normalizeVector3(traceDirection)

  const diameter = input.extentKm * CM_PER_KM * 2
  const depthRange = (input.layerBaseKm + input.layerThicknessKm) * CM_PER_KM + aim.snap
  const far = 2 * depthRange
  const { worldToClip } = orthoMapAlong(aim.at, traceDirection, depthRange, diameter, far)

  const clipFromCamera = mapFromCamera(worldToClip, aim.camera)
  const [x, y, z] = sceneToMaterial(traceDirection)
  return {
    clipFromCamera,
    cameraFromClip: invertMatrix4(new Float64Array(16), clipFromCamera),
    rayDirection: [x, y, z],
    farDepthKm: far * KM_PER_CM,
    samples: quality.cloudSkyAOTraceSamples,
  }
}

/** What an image of the map is made from, beside the sky light's settings it reads: the clouds part
 *  and the camera and planet it looks from (`CloudSkyOcclusionFrameInput`). */
export interface SkyOcclusionPlanInput {
  readonly part: CloudPart
  readonly eye: ArrayLike<number>
  readonly eyeFromPlanetKm: ArrayLike<number>
  readonly planetRadiusKm: number
}

/** The map of an image for the sky light `light`: its side in texels (the light's resolution scale
 *  on 512, no more than `cloudSkyAOResolutionMax`), its frame, and whether the hemisphere filter
 *  runs (`cloudSkyAOFiltering`). */
export function skyOcclusionPlan(input: SkyOcclusionPlanInput, light: CloudSkyOcclusionLight) {
  const { quality, settings } = input.part
  return {
    side: cloudSkyOcclusionSide(light, quality.cloudSkyAOResolutionMax),
    filtered: quality.cloudSkyAOFiltering,
    frame: cloudSkyOcclusionFrame({
      eye: input.eye,
      eyeFromPlanetKm: input.eyeFromPlanetKm,
      planetRadiusKm: input.planetRadiusKm,
      layerBaseKm: settings.baseAltitudeKm,
      layerThicknessKm: settings.thicknessKm,
      extentKm: light.cloudAmbientOcclusionExtentKm,
      quality,
    }),
  }
}
