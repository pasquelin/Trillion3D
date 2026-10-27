import { LIGHT_SHADOW_RULES, type LightShadowField } from '../contracts/lightShadowOptions.ts'
import { ruleProperties } from './settingProperties.ts'

/** What each shadow setting of a directional light means (`../contracts/lightShadowOptions.ts`). */
const LIGHT_SHADOW_MEANINGS: Readonly<Record<LightShadowField, string>> = {
  shadowDistance:
    "Directional only: how far from the eye, in meters, its shadows are asked to reach (the far-shadow test's edge lies a little farther). It lays the light's shadow levels and the edge where its distance-field cascade begins; the shadow maps take every cluster caster at any distance, the far-shadow test reaching only subjects that are no cluster geometry.",
  shadowCascades:
    "Directional only: how many near levels its shadows are cut into, at most the shadowNearLevels of the view (the quality levels write fewer below the top and the most at 'cinematic'). They shape the edge of the far-shadow test.",
  shadowCascadeExponent:
    'Directional only: how many times the span of the level before each near level takes; 1 splits the distance evenly, more puts the levels nearer the eye.',
  shadowCascadeTransition:
    "Directional only: the share of its span a near level overlaps into the next, scaled by the view's shadowOverlapScale; it moves the edge of the far-shadow test past the shadow distance where a cascade follows.",
  farShadowCascades:
    'Directional only: the far levels between its shadow distance and farShadowDistance; where there are some, the last near level overlaps into them.',
  farShadowDistance:
    "Directional only: where its far levels end, in meters; valid while it is more than a meter past the light's shadow distance.",
  distanceFieldShadows:
    "Directional only: whether the cascade of the distance fields follows its near levels, where the scene's meshes have distance fields and the view's shadowFarField is on: a sun shadow traced against them from the near levels' end to distanceFieldShadowDistance.",
  distanceFieldShadowDistance:
    "Directional only: where the distance-field cascade ends, in meters, scaled by the view's distanceFieldDistanceScale; by default past the light's shadow distance.",
  distanceFieldTraceDistance:
    'Directional only: how far, in meters, a ray of the distance-field cascade goes toward the light; farther raises the cost.',
  shadowAmount:
    "Directional only: how dark the shadow of the distance-field cascade is, from 0 (none) to 1 (the default, the whole shadow): the cascade's visibility is faded toward 1 by it. The maps' own shadow is not scaled.",
  distanceFieldRayStartOffset:
    "Directional only: the share of a pixel's depth the distance-field cascade's rays start off the surface by, which hides the self-shadowing of coarse distance fields on large meshes.",
}

/** The light tool's parameter of each shadow setting of a directional light, from its rule: its
 *  kind, default, bounds and what it means. */
export const lightShadowProperties = () => ruleProperties(LIGHT_SHADOW_RULES, LIGHT_SHADOW_MEANINGS)
