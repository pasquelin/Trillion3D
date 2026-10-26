import { mapSide } from './cloudShadow.ts'
import type { SkyLightSettings } from './skyLight.ts'
import type { SkyQualityValues } from './quality.ts'

/**
 * The clouds' sky occlusion map: a map seen from above along the planet's vertical, of how much the
 * clouds darken the sky's multiply scattered light under them, that the air's marches read to dim
 * the first light's multiple scattering (the sky, the haze, the capture of the sky light), and
 * nothing else: not the sky light's own diffuse and specular light. Off by default (a sky light
 * asks for it with `cloudAmbientOcclusion`). Distances are in kilometres, as written.
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

/** The side of the map in texels: `mapSide` of the sky light's resolution scale. */
export const cloudSkyOcclusionSide = (light: CloudSkyOcclusionLight, mostSide: number) =>
  mapSide(light.cloudAmbientOcclusionMapResolutionScale, mostSide)
