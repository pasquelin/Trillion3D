/** The cloud shadow fields of a scene light (`SceneLight`), a directional light's alone; their
 *  names and defaults are the rules' (`CLOUD_SHADOW_LIGHT_RULES`, `../../modules/sky/cloudShadow.ts`). */
export interface SceneLightCloudShadow {
  /** Directional only: whether the cloud march reads the light's opaque shadow map where it samples
   *  the clouds' light; absent, off. (Of the air's lights only the first is read for it.) */
  shadowsClouds?: boolean
  /** Directional only: whether the light has a cloud shadow map, as the air's light of its index
   *  (`atmosphereSunIndex`); absent, off. */
  castCloudShadows?: boolean
  /** Directional only: the weight of the map's extinction and optical depth, from 0; absent, 1. A
   *  strength of 0 makes no map. */
  cloudShadowStrength?: number
  /** Directional only: how much of the clouds' shade the air takes, from 0; absent, 1. */
  cloudShadowOnAtmosphereStrength?: number
  /** Directional only: how much of the clouds' shade the surfaces take, from 0; absent, 1. */
  cloudShadowOnSurfaceStrength?: number
  /** Directional only: added to the depth where the cloud begins, in kilometres; absent, 0. */
  cloudShadowDepthBiasKm?: number
  /** Directional only: the radius round the camera the map covers, in kilometres, from 1; absent,
   *  150. */
  cloudShadowExtentKm?: number
  /** Directional only: the factor on the map's 512 texels a side, from 0.25; absent, 1. */
  cloudShadowResolutionScale?: number
  /** Directional only: the factor on the 16 samples a ray of the map takes, from 0.25; absent, 1. */
  cloudShadowRaySamplesScale?: number
  /** Directional only: the factor on the light inside the clouds, linear, three numbers; absent,
   *  white. */
  cloudScatteredLuminanceScale?: [number, number, number]
}
