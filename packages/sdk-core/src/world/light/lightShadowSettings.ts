import { LIGHT_SHADOW_RULES, type LightShadowOptions } from '../../contracts/lightShadowOptions.ts'
import { ruledLightSettings } from './lightNumbers.ts'

/** What a page may pass to a light about its shadows (`SceneLight` shadow fields, one for each rule
 *  of `LIGHT_SHADOW_RULES`); a directional light's alone. A distance is metres, `true` its default,
 *  `false` none. */
export type LightShadowParameters = LightShadowOptions

declare module './light.ts' {
  interface Light {
    /** Directional only: how far from the eye, in metres, its shadow maps are asked to reach, scaled
     *  by the view's `shadowDistanceScale`; 400. The far-shadow test's edge lies a little farther
     *  (427.0 at the defaults): a caster whose depth along the view, less its radius, is past it,
     *  and whose object does not set `castFarShadow`, is left out of the light's shadows. A write
     *  reaches the world at once, and makes the light's shadows again. */
    shadowDistance: number
    /** Directional only: the near levels its shadows are cut into, at most the view's
     *  `shadowNearLevels`; 4. */
    shadowCascades: number
    /** Directional only: how many times the span of the one before each near level takes; 3. */
    shadowCascadeExponent: number
    /** Directional only: the share of its span a near level overlaps into the next; 0.1. */
    shadowCascadeTransition: number
    /** Directional only: the far levels between its shadow distance and `farShadowDistance`; 0. */
    farShadowCascades: number
    /** Directional only: where its far levels end, in metres; 3000. */
    farShadowDistance: number
    /** Directional only: whether the cascade of the distance fields follows its near levels, where
     *  the scene has distance fields; on. */
    distanceFieldShadows: boolean
    /** Directional only: where that cascade ends, in metres, scaled by the view's
     *  `distanceFieldDistanceScale`; 512. */
    distanceFieldShadowDistance: number
    /** Directional only: how far a ray of that cascade goes, in metres, from 10 to 10 000; 100. */
    distanceFieldTraceDistance: number
    /** Directional only: the share of a pixel's depth its rays of that cascade start off the
     *  surface by; 0.003. */
    distanceFieldRayStartOffset: number
    /** Directional only: how dark the distance-field cascade's shadow is, from 0 to 1; 1. */
    shadowAmount: number
  }
}

export const { take, copy, settingsSet, fromRecord, define } =
  ruledLightSettings<LightShadowParameters>(
    LIGHT_SHADOW_RULES,
    (light) => light.kind === 'directional',
  )
