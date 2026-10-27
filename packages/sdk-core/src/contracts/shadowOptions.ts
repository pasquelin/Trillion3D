import { SHADOW_MAP_PRESET_LEVELS, SHADOW_MAP_RULES } from './shadowMapOptions.ts'
import { SUN_SHADOW_RULES } from './sunShadowOptions.ts'
import { CONTACT_SHADOW_RULES } from './contactShadowOptions.ts'
import {
  contextReader,
  flagSetting as flag,
  integerSetting as integer,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * THE VIEW'S SHADOW SETTINGS: how a directional light's shadows are cut by distance and the shadow
 * maps' own. A sun's shadow maps are cut from the eye's view and take every cluster caster at any
 * distance: the reference's far-shadow test reaches the subjects it gathers on the CPU, which are no
 * cluster geometry, and every caster the engine draws is made of clusters. The distance is the sun's
 * own (`shadowDistance`, metres, per light, `lightShadowOptions.ts`), scaled by the view's
 * `shadowDistanceScale`; the edge of the sun's near levels lies a little past it, by the sun's near levels, their overlap and the cascades after
 * them (`sunCascades.ts`), which the quality levels write the rows of with the scale. The cascade
 * of the distance fields that follows the near levels, and the far levels, are shaped by the view's
 * settings listed in `sunShadowOptions.ts`. The raster draws every light's maps together, in as many
 * view passes as the maps its views' dispatch can list ask (`shadowMultipassViews`; one on any
 * device for the maps a frame holds). Run-time settings, as `./settingRules.ts` says: no compiler
 * job names them, no cache key holds them, and none moves a page: they restage nothing.
 */

/** The settings of the shadows by field, each with the reference's default:
 *  `shadowDistanceScale`, 1, from 0 to 2 — the factor on every sun's shadow distance; 0 gives the
 *  culling nothing to test against, so it culls nothing —, `farShadowCulling`, on — whether a sun has
 *  a near edge and the distance-field cascade that follows it —, and the three that shape the edge
 *  (`sunCascades`):
 *  `shadowNearLevels`, 10, from 0 to 10 — how many near levels the sun's shadows have, no more than
 *  the light's own `shadowCascades` —, `shadowOverlapScale`, 1, from 0 to 2 — the factor on the
 *  share of its span a level overlaps into the next — and `shadowFarField`, on — whether the
 *  distance-field cascade follows the near levels, where the scene has distance fields —, the one
 *  of the raster's view passes: `shadowMultipassViews`, on — whether the lights whose maps would
 *  pass the maps one pass takes (the rows of the cull's dispatch, a light a row, 65 535 on any
 *  device, `vsmViewsPerPass` in
 *  `packages/sdk-browser/src/lighting/shadows/vsm/render/renderViewPasses.ts`) are drawn in several
 *  passes, each light whole in one, or, off, every light in one pass: the pages are the same either
 *  way —, the level of detail the shadow maps take of the clusters: `shadowGeometryLodBias`, 1 —
 *  each map's view selects its own clusters, at the error the cut allows times two to this bias over
 *  the streaming's quality scale, in the map's pixels: 0 the cut's own error, higher coarser —, the occlusion culling of the shadow
 *  maps' casters: `shadowOcclusionCulling`, on — whether the raster culls the casters hidden in a
 *  map behind what its pages already hold, in two passes against the maps' depth pyramid (the
 *  previous frame's, then this frame's) —, `shadowDynamicHzb`, off — whether the pyramid holds a
 *  second layer for the pages' dynamic casters, the static layer's depths merged with the dynamic
 *  slice's, where the first holds the static layer's alone (a cached scene with much dynamic
 *  overdraw; it doubles the pyramid's memory) —, and `shadowOcclusionFullUpdate`, off — whether that
 *  pyramid is built again over every page each frame rather than over the pages drawn —, then the
 *  far levels' and the distance-field cascade's (`SUN_SHADOW_RULES`), the contact shadows'
 *  (`CONTACT_SHADOW_RULES`) and the shadow maps' own
 *  (`SHADOW_MAP_RULES`). */
export const SHADOW_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    number('shadowDistanceScale', 1, [0, 2]),
    flag('farShadowCulling', true),
    integer('shadowNearLevels', 10, [0, 10]),
    number('shadowOverlapScale', 1, [0, 2]),
    flag('shadowFarField', true),
    flag('shadowMultipassViews', true),
    // No bound but the one the shaders need: 2 to the bias, a factor of the threshold they read as
    // an f32, finite and normal.
    number('shadowGeometryLodBias', 1, [-126, 127]),
    flag('shadowOcclusionCulling', true),
    flag('shadowDynamicHzb', false),
    flag('shadowOcclusionFullUpdate', false),
    ...SUN_SHADOW_RULES,
    ...CONTACT_SHADOW_RULES,
    ...SHADOW_MAP_RULES,
  ] as const))()
/** What the quality levels below the top write of the shadow settings: the sun's four rows — the
 *  scale on every sun's shadow distance, how many near levels it has, the scale on their overlap and
 *  whether the distance-field cascade follows them, which shape the edge of the far-shadow test
 *  (`sunCascades`) — and the maps' rows (`SHADOW_MAP_PRESET_LEVELS`). `max` writes nothing: the
 *  rules' defaults (`runtime/qualityLevels.ts`); `cinematic` writes the fifth row: all ten near
 *  levels, the full overlap and the distance-field cascade. */
export const SHADOW_PRESET_LEVELS = /* @__PURE__ */ (() =>
  ({
    smooth: {
      shadowDistanceScale: 0.6,
      shadowNearLevels: 1,
      shadowOverlapScale: 0,
      shadowFarField: false,
      ...SHADOW_MAP_PRESET_LEVELS.smooth,
    },
    balanced: {
      shadowDistanceScale: 0.7,
      shadowNearLevels: 1,
      shadowOverlapScale: 0.25,
      shadowFarField: false,
      ...SHADOW_MAP_PRESET_LEVELS.balanced,
    },
    fine: {
      shadowDistanceScale: 0.85,
      shadowNearLevels: 4,
      shadowOverlapScale: 0.8,
      shadowFarField: true,
      ...SHADOW_MAP_PRESET_LEVELS.fine,
    },
    cinematic: {
      shadowDistanceScale: 1,
      shadowNearLevels: 10,
      shadowOverlapScale: 1,
      shadowFarField: true,
      ...SHADOW_MAP_PRESET_LEVELS.cinematic,
    },
  }) as const)()

/** The shadow setting `field` of a runtime's context (`contextReader`): its default where the
 *  context holds none. */
export const readShadowSetting = /* @__PURE__ */ contextReader(SHADOW_RULES)
/** The field of one setting of the shadows. */
export type ShadowField = keyof typeof SHADOW_RULES
/** The shadow settings as a host writes them, by their fields: each its value, or nothing for its
 *  default. */
export type ShadowOptions = SettingOptions<typeof SHADOW_RULES>
/** The shadow settings, resolved. */
export type ShadowValues = SettingValues<typeof SHADOW_RULES>
