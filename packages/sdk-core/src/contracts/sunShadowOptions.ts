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
 * the far levels past a light's near ones are counted and how the distance-field cascade is laid and
 * its meshes listed, each with the reference's default. The quality levels write none of them; the row
 * that turns the cascade off on the two coarser levels is `shadowFarField`'s (`shadowOptions.ts`). A
 * light's own settings of the same shadows are `lightShadowOptions.ts`'.
 *
 * A sun's shadow maps draw every cluster at any distance, and every mesh the engine draws is made of
 * clusters, so no distance-field shadow is traced on the view: the cascade shapes the edge of the
 * far-shadow test (`sunCascades.ts`), and the settings of its tiles, rays and lists below are those of
 * the lists the surface cache's cards trace the suns through (`lighting/surfaceCache/lighting/meshShadow.ts`).
 *
 * - `shadowMaxFarCascades` (10): the most far levels a light's own count (`farShadowCascades`) may
 *   have; it counts them — a light with far levels ends its near levels with an overlap and lets the
 *   distance-field cascade fade by its length — but no far level is drawn;
 *   `shadowFarDistanceOverride` (0, none): metres, the far distance of every light when it is above
 *   0. It only moves where the far levels end, and none is drawn, so it has no visible effect: it
 *   is kept so that a scene that names it reads;
 * - `distanceFieldDistanceScale` (1, from 0.0001 to 10 000): the factor on every light's
 *   `distanceFieldShadowDistance`;
 * - `distanceFieldShadowing` (on): whether a sun's distance-field cascade is allowed at all, the master switch of the feature (`r.DistanceFieldShadowing`,
 *   `DistanceFieldShadowing.cpp:36-41`); off, no cascade is laid, whatever the quality and the light say;
 * - `distanceFieldShadowQuality` (3, from 0 to 3): the steps of a ray, 0 none (no cascade laid),
 *   1 twenty, 2 thirty-two, 3 sixty-four; `distanceFieldShadowTileSize` (2 metres): the side, on
 *   the plane across the light, of the tiles the meshes are listed in;
 *   `distanceFieldShadowTwoSidedBias` (1): the factor on the distance a two-sided mesh's surface
 *   is expanded by, where its field is traced; `distanceFieldShadowObjectsPerTile` (128, at least
 *   1): the meshes a tile has room for on average, the lists' room being that times the tiles;
 * - `distanceFieldShadowCompactTiles` (on): whether the tiles' lists lie one after the other in
 *   the room (a start offset a tile), or, off, each tile has a place of its own, the room over the
 *   tiles — a tile past its place loses meshes;
 * - `distanceFieldShadowSnapResolution` (2048, at least 32): the texels across the shadow
 *   space, less 4 on each side, whose grid the space's origin is snapped to (4 texels a step), so
 *   that the tile grid moves in steps with the camera.
 *
 * The cascade is traced on the view only while the shadows are classic (`shadowVirtualEnable` off): the pass is the reference's, a ray from each pixel
 * toward the sun through the meshes listed by tile, at half the image's size and upsampled with the depth as the weight, laid into the sun's mask by the minimum.
 * - `distanceFieldShadowFullResolution` (off): whether the cascade is traced at the image's size, else at half of it (`r.DFFullResolution`);
 * - `distanceFieldFarTransitionScale` (1, from 0 to 1): the factor on the length of the cascade's far fade (`r.DFFarTransitionScale`);
 * The distance a ray goes toward the sun and the share of a pixel's depth it starts off the surface by are the light's own (`lightShadowOptions.ts`).
 */
export const SUN_SHADOW_RULES = /* @__PURE__ */ (() =>
  [
    count('shadowMaxFarCascades', 10, 0),
    nonNegative('shadowFarDistanceOverride', 0),
    number('distanceFieldDistanceScale', 1, [0.0001, 10000]),
    flag('distanceFieldShadowing', true),
    integer('distanceFieldShadowQuality', 3, [0, 3]),
    positive('distanceFieldShadowTileSize', 2, 'a finite number of metres above 0'),
    nonNegative('distanceFieldShadowTwoSidedBias', 1),
    count('distanceFieldShadowObjectsPerTile', 128, 1),
    flag('distanceFieldShadowCompactTiles', true),
    integer('distanceFieldShadowSnapResolution', 2048, [32, INT32_MAX]),
    flag('distanceFieldShadowFullResolution', false),
    number('distanceFieldFarTransitionScale', 1, [0, 1]),
  ] as const)()
