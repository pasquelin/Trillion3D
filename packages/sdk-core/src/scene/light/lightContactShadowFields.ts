/** The contact shadow fields of a scene light (`SceneLight`), every kind's, and its indirect lighting
 *  factor, which the light's record holds beside them; their names, kinds, ranges and defaults are
 *  the rules' (`LIGHT_CONTACT_SHADOW_RULES`, `../../contracts/lightContactShadowOptions.ts`). */
export interface SceneLightContactShadow {
  /** See `LIGHT_CONTACT_SHADOW_RULES`. */
  contactShadowLength?: number
  /** See `LIGHT_CONTACT_SHADOW_RULES`. */
  contactShadowLengthInWorldSpace?: boolean
  /** See `LIGHT_CONTACT_SHADOW_RULES`. */
  contactShadowCastingIntensity?: number
  /** See `LIGHT_CONTACT_SHADOW_RULES`. */
  contactShadowNonCastingIntensity?: number
  /** See `LIGHT_CONTACT_SHADOW_RULES`. */
  indirectLightingIntensity?: number
}
