import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import type { SkyLightSettings } from './skyLight.ts'
import type { SkyQualityValues } from './quality.ts'

/**
 * The clouds' sky occlusion map: a map seen from above along the planet's vertical, of how much the
 * clouds darken the sky's multiply scattered light under them, that the air reads to dim that light.
 * Off by default. Distances are in kilometres, as written.
 *
 * It has no setting of its own. The sky light's five `cloudAmbientOcclusion…` fields are the
 * component's, held by the sky light part (`./skyLight.ts`); the renderer's `cloudSkyAO`,
 * `cloudSkyAOResolutionMax`, `cloudSkyAOTraceSamples`, `cloudSkyAOFiltering` and `cloudSkyAOSnapKm`
 * are quality settings (`./quality.ts`).
 */

/** The sky light's settings the map reads: `cloudAmbientOcclusion` (the map is made),
 *  `…Strength`, `…ExtentKm` (the radius round the camera the map covers), `…MapResolutionScale`
 *  (the factor on the map's 512 texels a side) and `…ApertureScale`. */
export type CloudSkyOcclusionLight = Pick<
  SkyLightSettings,
  | 'cloudAmbientOcclusion'
  | 'cloudAmbientOcclusionStrength'
  | 'cloudAmbientOcclusionExtentKm'
  | 'cloudAmbientOcclusionMapResolutionScale'
  | 'cloudAmbientOcclusionApertureScale'
>

/** The map is made when the quality's switch `cloudSkyAO` is on and the scene has a sky light that
 *  asks for it. `light` is none where the scene has no sky light. */
export const cloudSkyOcclusionWanted = (
  quality: Pick<SkyQualityValues, 'cloudSkyAO'>,
  light: CloudSkyOcclusionLight | undefined,
) => quality.cloudSkyAO && light !== undefined && light.cloudAmbientOcclusion

/** The texels a side of the map has at a resolution scale of 1. */
const BASE_SIDE = 512

/** The side of the map in texels: the base side times the sky light's scale, cut to a whole
 *  number, at most the map's largest, at least 1. The floor is ours: a largest side of 0 or less,
 *  which the quality setting lets through, would give a map of no texels, whose size is inverted for
 *  the sampling (infinity) and which the GPU refuses to create. */
export const cloudSkyOcclusionSide = (light: CloudSkyOcclusionLight, mostSide: number) =>
  clampLowWins(Math.trunc(BASE_SIDE * light.cloudAmbientOcclusionMapResolutionScale), 1, mostSide)
