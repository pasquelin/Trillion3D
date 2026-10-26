/** The shadow fields of a scene light (`SceneLight`), a directional light's alone; their names, kinds
 *  and defaults are the rules' (`LIGHT_SHADOW_RULES`, `../../contracts/lightShadowOptions.ts`). */
export interface SceneLightShadow {
  /** Directional only: how far from the eye, in metres, its shadow maps are asked to reach; past the
   *  edge that lies a little farther a caster that does not cast far shadows is left out
   *  (`shadowOptions.ts`); 0 none; absent, 400. */
  shadowDistance?: number
  /** Directional only: the near levels its shadows are cut into, a whole number of at least 0, at
   *  most the view's `shadowNearLevels`; absent, 4. */
  shadowCascades?: number
  /** Directional only: how many times the span of the level before each near level takes, at least
   *  0; absent, 3. */
  shadowCascadeExponent?: number
  /** Directional only: the share of its span a near level overlaps into the next, at least 0;
   *  absent, 0.1. */
  shadowCascadeTransition?: number
  /** Directional only: the far levels between its shadow distance and `farShadowDistance`, a whole
   *  number of at least 0; absent, 0. */
  farShadowCascades?: number
  /** Directional only: the distance, in metres, its far levels end at, valid while it is more than a
   *  metre past the shadow distance; absent, 3000. */
  farShadowDistance?: number
  /** Directional only: whether the cascade of the distance fields follows its near levels, where
   *  the scene has distance fields; absent, it does. */
  distanceFieldShadows?: boolean
  /** Directional only: the distance, in metres, that cascade ends at, scaled by the view's
   *  `distanceFieldDistanceScale`; absent, 512. */
  distanceFieldShadowDistance?: number
  /** Directional only: how far, in metres, a ray of that cascade goes, from 10 to 10 000; absent,
   *  100. */
  distanceFieldTraceDistance?: number
  /** Directional only: the share of a pixel's depth its rays of that cascade start off the
   *  surface by, at least 0; absent, 0.003. */
  distanceFieldRayStartOffset?: number
  /** Directional only: how dark the distance-field cascade's shadow is, from 0 to 1; absent, 1. */
  shadowAmount?: number
}
