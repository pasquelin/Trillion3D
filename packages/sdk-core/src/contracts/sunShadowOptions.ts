import {
  countSetting as count,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  positiveSetting as positive,
} from './settingRules.ts'

/**
 * THE VIEW'S SETTINGS OF A SUN'S FAR SHADOWS (`shadowOptions.ts` lists them with the others): how
 * the far levels past a light's near ones are counted and how its distance-field cascade is drawn,
 * each with the reference's default. The quality levels write none of them; the row that turns the
 * cascade off on the two coarser levels is `shadowFarField`'s (`shadowOptions.ts`). A light's own
 * settings of the same shadows are `lightShadowOptions.ts`'.
 *
 * - `shadowMaxFarCascades` (10): the most far levels a light's own count (`farShadowCascades`) may
 *   have; it counts them — a light with far levels ends its near levels with an overlap and lets the
 *   distance-field cascade fade by its length — but no far level is drawn: past the near levels
 *   the engine's shadows are the distance-field cascade's;
 *   `shadowFarDistanceOverride` (0, none): metres, the far distance of every light when it is above
 *   0. It only moves where the far levels end, and none is drawn, so it has no visible effect: it
 *   is kept so that a scene that names it reads;
 * - `distanceFieldDistanceScale` (1, from 0.0001 to 10 000): the factor on every light's
 *   `distanceFieldShadowDistance`; `distanceFieldFarTransitionScale` (1, from 0 to 1): the factor on
 *   the length of the cascade's fade out at its far end, 0 none;
 * - `distanceFieldShadowQuality` (3, from 0 to 3): the steps of a ray, 0 none (no cascade drawn),
 *   1 twenty, 2 thirty-two, 3 sixty-four (from 2, a thin transmitting surface keeps the light that
 *   survives the thickness it has gone through);
 *   `distanceFieldShadowFullResolution` (off): whether the cascade is traced at the display's
 *   resolution, or at half of it, upsampled; `distanceFieldShadowTileSize` (2 metres): the side, on
 *   the plane across the light, of the tiles the meshes are listed in;
 *   `distanceFieldShadowTwoSidedBias` (1): the factor on the distance a two-sided mesh's surface
 *   is expanded by, where its field is traced; `distanceFieldShadowObjectsPerTile` (128, at least
 *   1): the meshes a tile has room for on average, the lists' room being that times the tiles.
 */
export const SUN_SHADOW_RULES = /* @__PURE__ */ (() =>
  [
    count('shadowMaxFarCascades', 10, 0),
    nonNegative('shadowFarDistanceOverride', 0),
    number('distanceFieldDistanceScale', 1, [0.0001, 10000]),
    number('distanceFieldFarTransitionScale', 1, [0, 1]),
    integer('distanceFieldShadowQuality', 3, [0, 3]),
    flag('distanceFieldShadowFullResolution', false),
    positive('distanceFieldShadowTileSize', 2, 'a finite number of metres above 0'),
    nonNegative('distanceFieldShadowTwoSidedBias', 1),
    count('distanceFieldShadowObjectsPerTile', 128, 1),
  ] as const)()
