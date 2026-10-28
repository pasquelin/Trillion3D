import type { CapsuleShadowField } from '../contracts/capsuleShadowOptions.ts'
import type { ContactShadowField } from '../contracts/contactShadowOptions.ts'
import type { ShadowField } from '../contracts/shadowOptions.ts'
import type { ShadowViewField } from './shadowViewMeanings.ts'

/** The settings of the view that shape a sun's shadows by distance (`../contracts/shadowOptions.ts`,
 *  `../contracts/sunShadowOptions.ts`): the rest are the maps' (`shadowViewMeanings.ts`) and the
 *  contact shadows' (`contactShadowMeanings.ts`) and the capsule shadows' (`capsuleShadowMeanings.ts`). */
type ShadowSunField = Exclude<
  ShadowField,
  ShadowViewField | ContactShadowField | CapsuleShadowField
>

/** What each of them means. */
export const SHADOW_SUN_MEANINGS: Readonly<Record<ShadowSunField, string>> = {
  shadowDistanceScale:
    "Factor from 0 to 2 on the shadow distance of every directional light (its shadowDistance, 400 metres by default): the quality levels write 0.6, 0.7 and 0.85 below the top one and 1 at 'cinematic'. 0 leaves the far-shadow culling nothing to test against: it culls nothing.",
  farShadowCulling:
    'Whether a directional light has a near edge, a little farther than its shadow distance, scaled — 427 metres at 400 — and the distance-field cascade that begins past it. The far-shadow test, which this switch turns on, reaches the subjects that are no cluster geometry; every object the engine draws is made of clusters, which the shadow maps take at any distance, so no caster is left out of the maps for being far.',
  shadowNearLevels:
    "How many near levels a directional light's shadows have, from 0 to 10, never more than the light's own shadowCascades: they shape the edge of the far-shadow test. 10, the default, is the light's own count; the quality levels write 1 at the two coarser ones, 4 below the top and 10 at 'cinematic'. 0 leaves no near level, so no edge: nothing is culled.",
  shadowOverlapScale:
    "Factor from 0 to 2 on the share of its span a near level overlaps into the next (the light's shadowCascadeTransition, 0.1): it moves the edge of the far-shadow test past the shadow distance, where a cascade follows, and the length of the distance-field cascade's fades. The quality levels write 0, 0.25 and 0.8 below the top one and 1 at 'cinematic'.",
  shadowFarField:
    "Whether the cascade of the distance fields follows the near levels: where it does, the edge of the far-shadow test lies past the distance by the overlap of the last near level, and a sun shadow is traced against the distance fields of the meshes that are no cluster geometry (the shadow maps draw the clusters, which every mesh of the engine is made of, so nothing is traced today) over the metres from there to the light's distanceFieldShadowDistance. It needs the scene's meshes to have distance fields and the light's distanceFieldShadows. The quality levels turn it off at the two coarser ones and on at 'cinematic'.",
  shadowMaxFarCascades:
    'The most far levels a directional light may have, whatever its farShadowCascades: 10 by default, 0 gives it none. Far levels are counted, not drawn (past the near levels the sun is shadowed by the distance-field cascade): a light with some ends its near levels with the overlap and lets the distance-field cascade fade out by it.',
  shadowFarDistanceOverride:
    'The far distance, in meters, of every directional light when above 0 (its farShadowDistance is read otherwise); 0, the default, none. It only moves where far levels end, and the engine draws none (its sun shadows past the near levels are the distance-field cascade), so it has no visible effect.',
  distanceFieldDistanceScale:
    'Factor from 0.0001 to 10000 on the distanceFieldShadowDistance of every directional light: below 1 shortens the distance-field cascade, above 1 lengthens it.',
  distanceFieldFarTransitionScale:
    "Factor from 0 to 1 on the length of the fade out at the far end of the distance-field cascade, which is the cascade's overlap length: 1, the default, fades like the other cascades, 0 does not fade.",
  distanceFieldShadowing:
    'Whether a sun may have a distance-field shadow cascade at all (true, the default): the master switch of the feature. Off, no cascade is drawn, whatever distanceFieldShadowQuality and each light say.',
  distanceFieldShadowQuality:
    'The steps of a ray of the distance-field cascade: 0 draws none, 1 twenty, 2 thirty-two, 3 (the default) sixty-four. At 3 alone, a thin transmitting surface keeps the light that survives the thickness it has gone through, by its own opacity.',
  distanceFieldShadowFullResolution:
    "Whether the distance-field cascade is traced at the display's resolution (true) or at half of it, upsampled with a filter that keeps the depth edges (false, the default).",
  distanceFieldShadowTileSize:
    'The side, in meters, of the tiles across the light the meshes of the distance-field cascade are listed in, above 0, 2 by default: smaller tiles list fewer meshes each and more tiles.',
  distanceFieldShadowTwoSidedBias:
    "The factor on the distance a two-sided mesh's surface is expanded by where its distance field is traced for the cascade, 1 by default; it makes the shadows of leaves and cloth match the shadow maps'.",
  distanceFieldShadowObjectsPerTile:
    'The meshes a tile of the distance-field cascade has room for on average, 128 by default, at least 1: the room of the lists is that number times the tiles; a tile past it loses meshes (its shadow flickers), a larger number spends memory.',
  distanceFieldShadowScatterTiles:
    "Whether the meshes of the distance-field cascade are drawn as boxes onto a grid of tiles across the light and each pixel reads its tile's list (true, the default), or each group of 8 by 8 texels of the trace culls the meshes to its own bounds (false: no grid, no draw; the next option has nothing to act on).",
  distanceFieldShadowCompactTiles:
    'Whether the lists of the tiles of the distance-field cascade lie one after the other in the room, a tile taking only what it holds (true, the default), or each tile has a place of its own, the room over the tiles, and a tile past its place loses meshes (false). It acts with distanceFieldShadowScatterTiles.',
  distanceFieldShadowSubsampleDepth:
    'Whether the trace of the distance-field cascade decides if a texel is reached from the depth at its top left alone (true: less bandwidth, artifacts on edges and holes of a pixel) or from the farthest depth of its block of pixels (false, the default). It acts with distanceFieldShadowFullResolution off.',
  distanceFieldShadowSnapResolution:
    'The texels, at least 32 and 2048 by default, across the shadow space of the distance-field cascade whose grid its origin is snapped to (4 texels a step, 4 texels off each side): the tile grid then moves in steps with the camera. A larger number moves it in finer steps.',
}
