import type { CastRayTracedShadow } from '../../contracts/rayTracedShadowOptions.ts'
import { LIGHT_CONTACT_SHADOW_RULES } from '../../contracts/lightContactShadowOptions.ts'
import { ruledLightSettings } from './lightNumbers.ts'

/** What a page may pass to a light about its contact shadows and its indirect lighting factor: the fields of
 *  `LIGHT_CONTACT_SHADOW_RULES`, whose rules say what each takes; every kind of light has them. */
export interface LightContactShadowParameters {
  contactShadowLength?: number
  contactShadowLengthInWorldSpace?: boolean
  contactShadowCastingIntensity?: number
  contactShadowNonCastingIntensity?: number
  indirectLightingIntensity?: number
  castRayTracedShadow?: CastRayTracedShadow
  rayTracedShadowSamplesPerPixel?: number
}

declare module './light.ts' {
  interface Light {
    /** See `LIGHT_CONTACT_SHADOW_RULES`: a write is checked by its rule and reaches the world at once. */
    contactShadowLength: number
    /** See `LIGHT_CONTACT_SHADOW_RULES`. */
    contactShadowLengthInWorldSpace: boolean
    /** See `LIGHT_CONTACT_SHADOW_RULES`. */
    contactShadowCastingIntensity: number
    /** See `LIGHT_CONTACT_SHADOW_RULES`. */
    contactShadowNonCastingIntensity: number
    /** See `LIGHT_CONTACT_SHADOW_RULES`. */
    indirectLightingIntensity: number
    /** See `LIGHT_CONTACT_SHADOW_RULES`. */
    castRayTracedShadow: CastRayTracedShadow
    /** See `LIGHT_CONTACT_SHADOW_RULES`. */
    rayTracedShadowSamplesPerPixel: number
  }
}

export const { take, copy, settingsSet, fromRecord, define } =
  ruledLightSettings<LightContactShadowParameters>(LIGHT_CONTACT_SHADOW_RULES)
