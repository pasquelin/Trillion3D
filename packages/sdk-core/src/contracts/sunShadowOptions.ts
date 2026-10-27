import {
  INT32_MAX,
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
 * The cascade traces the meshes with a distance field that are no cluster geometry: a sun's shadow
 * maps draw the clusters, which would else be shadowed twice. Every mesh the engine draws is made
 * of clusters, so the lists of the cascade are empty whatever these settings say (its passes run
 * all the same).
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
 *   1 twenty, 2 thirty-two, 3 sixty-four (at 3 alone, a thin transmitting surface keeps the light that
 *   survives the thickness it has gone through, by its own opacity);
 *   `distanceFieldShadowFullResolution` (off): whether the cascade is traced at the display's
 *   resolution, or at half of it, upsampled; `distanceFieldShadowTileSize` (2 metres): the side, on
 *   the plane across the light, of the tiles the meshes are listed in;
 *   `distanceFieldShadowTwoSidedBias` (1): the factor on the distance a two-sided mesh's surface
 *   is expanded by, where its field is traced; `distanceFieldShadowObjectsPerTile` (128, at least
 *   1): the meshes a tile has room for on average, the lists' room being that times the tiles;
 * - how the meshes reach the pixels: `distanceFieldShadowScatterTiles` (on): whether the meshes'
 *   boxes are drawn onto the grid of tiles across the light and each pixel reads its tile's list,
 *   or, off, each group of 8 by 8 texels of the trace culls the meshes to its own bounds, in its
 *   group memory (no grid, no draw, and the two options below have nothing to act on);
 *   `distanceFieldShadowCompactTiles` (on): whether the tiles' lists lie one after the other in
 *   the room (a start offset a tile), or, off, each tile has a place of its own, the room over the
 *   tiles — a tile past its place loses meshes; `distanceFieldShadowSubsampleDepth` (off): whether
 *   the trace decides if a texel is reached from the depth at its top left alone, rather than the
 *   farthest depth of its block (cheaper in bandwidth, with artifacts on edges and holes of a pixel);
 * - `distanceFieldShadowSnapResolution` (2048, at least 32): the texels across the cascade's shadow
 *   space, less 4 on each side, whose grid the space's origin is snapped to (4 texels a step), so
 *   that the tile grid moves in steps with the camera.
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
    flag('distanceFieldShadowScatterTiles', true),
    flag('distanceFieldShadowCompactTiles', true),
    flag('distanceFieldShadowSubsampleDepth', false),
    integer('distanceFieldShadowSnapResolution', 2048, [32, INT32_MAX]),
  ] as const)()
