import { isFiniteNumber } from '../../../math/src/scalar/reals.ts'
import { refusal } from './nameMatch.ts'
import { SHADOW_MAP_RULES } from './shadowMapOptions.ts'
import {
  flagSetting as flag,
  integerSetting as integer,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * THE SHADOWS' SETTINGS: THE SUN'S SHADOW DISTANCE AND THE FAR-SHADOW CULLING OF ITS CASTERS
 * (`packages/sdk-browser/src/lighting/shadows/vsm/render/renderCandidatesWgsl.ts`): a sun's shadow
 * maps are cut from the eye's view, and a caster far past the distance the sun's shadows are asked
 * to reach is left out of them unless its object says it still casts there (`castFarShadow`). The
 * distance is the sun's own (`shadowDistance`, in metres, per light), scaled by one setting of the
 * view (`shadowDistanceScale`); the culling has its own switch (`farShadowCulling`) and a second
 * one for which casters it tests (`farShadowCullsAllMeshes`), and the edge it tests against lies a
 * little past the distance, by the sun's near levels and their overlap (`shadowNearLevels`,
 * `shadowOverlapScale`, `shadowFarField`), which the quality levels write with the scale
 * (`../runtime/qualityLevels.ts`). The raster draws every light's maps together, in as many view
 * passes as the maps its views' dispatch can list ask (`shadowMultipassViews`; one on any device
 * for the maps a frame holds). Run-time settings, as `./settingRules.ts` says: no compiler job
 * names them, no cache key holds them, and none moves a page: they restage nothing.
 */

/** A directional light's shadow distance when it names none: 400 metres, the reference's own. */
export const SHADOW_DISTANCE_DEFAULT = 400

/** A shadow distance as a host writes it: metres, `true` the default (400), `false` none — the
 *  light's casters are never left out for being far —, nothing the default. */
export type ShadowDistanceOption = number | boolean | null | undefined

/** Whether `value` is a shadow distance in metres: a finite number of at least zero. */
export const isShadowDistance = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0

/**
 * The shadow distance, in metres, `option` names: a finite number of at least zero as itself,
 * `true`, `undefined` or `null` the default, `false` zero (none).
 * @throws TypeError naming the field and the values it takes when it is none of them.
 */
export function shadowDistanceOf(option?: ShadowDistanceOption): number {
  if (option === undefined || option === null || option === true) return SHADOW_DISTANCE_DEFAULT
  if (option === false) return 0
  if (!isShadowDistance(option))
    refusal('shadowDistance')(
      `must be a finite number of metres of at least 0, true or false, got ${String(option)}`,
    )
  return option
}

/** The cascades a sun's shadows are cut into at most: the light's own count, the reference's
 *  default. `shadowNearLevels` takes the nearest of them it lists. */
const LIGHT_CASCADES = 4

/** The settings of the shadows by field, each with the reference's default:
 *  `shadowDistanceScale`, 1, from 0 to 2 — the factor on every sun's shadow distance; 0 gives the
 *  culling nothing to test against, so it culls nothing —, `farShadowCulling`, on — whether a sun's
 *  shadow maps leave out the casters that lie past its shadow distance —,
 *  `farShadowCullsAllMeshes`, off — whether that test reaches every caster, or the merged far-field
 *  shells of the world's coarser levels and every caster that is none of them is kept: the objects
 *  drawn as themselves, at the finest level and as the instanced actors of the first, keep casting
 *  at any distance —, and the three that shape the edge of the test (`farShadowDistance`):
 *  `shadowNearLevels`, 10, from 0 to 10 — how many near levels the sun's shadows have, no more than
 *  the light's own four —, `shadowOverlapScale`, 1, from 0 to 2 — the factor on the share of its
 *  span the last near level overlaps into the next — and `shadowFarField`, on — whether a far-field
 *  shadow follows the near levels —, and the one of the raster's view passes: `shadowMultipassViews`,
 *  on — whether the lights whose maps would pass the maps one pass takes (the rows of the cull's
 *  dispatch, a light a row, 65 535 on any device, `vsmViewsPerPass` in
 *  `packages/sdk-browser/src/lighting/shadows/vsm/render/renderViewPasses.ts`) are drawn in several
 *  passes, each light whole in one, or, off, every light in one pass: the pages are the same either
 *  way. */
export const SHADOW_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    number('shadowDistanceScale', 1, [0, 2]),
    flag('farShadowCulling', true),
    flag('farShadowCullsAllMeshes', false),
    integer('shadowNearLevels', 10, [0, 10]),
    number('shadowOverlapScale', 1, [0, 2]),
    flag('shadowFarField', true),
    flag('shadowMultipassViews', true),
    ...SHADOW_MAP_RULES,
  ] as const))()
/** The field of one setting of the shadows. */
export type ShadowField = keyof typeof SHADOW_RULES
/** The shadow settings as a host writes them, by their fields: each its value, or nothing for its
 *  default. */
export type ShadowOptions = SettingOptions<typeof SHADOW_RULES>
/** The shadow settings, resolved. */
export type ShadowValues = SettingValues<typeof SHADOW_RULES>

/** The exponent of the near levels' growth: each is this many times the span of the one before. */
const LEVEL_EXPONENT = 3
/** The share of a level's span that it overlaps into the next (the scale on it is
 *  `shadowOverlapScale`). */
const LEVEL_OVERLAP = 0.1
/** The distance, in metres, the far-field shadows of a sun reach: past a shadow distance shorter
 *  than it, one more level follows the near ones (`shadowFarField`). */
const FAR_FIELD_REACH = 512

/**
 * How far from the eye, in metres, a sun's shadow maps still take every caster: the far edge of
 * its last near level — a shadow distance of `distance` metres times `shadowDistanceScale`, cut
 * into at most `LIGHT_CASCADES` levels (`shadowNearLevels`) from the view's `near` plane, each
 * `LEVEL_EXPONENT` times the span of the one before — with the overlap that level has into the next
 * when another follows (`shadowFarField`, and a shadow distance under `FAR_FIELD_REACH`):
 * 427.0 metres at the defaults (400 metres, near 0.05), the distance itself past 512. 0 — no
 * caster is left out — when the culling is off, the shadow distance is zero or no near level
 * is. A caster whose depth along the view, less its bounding radius, is past it is left out unless
 * it casts far shadows.
 */
export function farShadowDistance(distance: number, near: number, shadows: ShadowValues) {
  const levels = Math.min(LIGHT_CASCADES, shadows.shadowNearLevels),
    reach = distance * shadows.shadowDistanceScale
  if (!shadows.farShadowCulling || !(reach > 0) || levels <= 0) return 0
  // The last near level starts after the span of the ones before it: a share (3^(N-1) - 1) / (3^N
  // - 1) of the whole.
  const last = LEVEL_EXPONENT ** (levels - 1),
    start = near + ((last - 1) / (last * LEVEL_EXPONENT - 1)) * (reach - near),
    follows = shadows.shadowFarField && FAR_FIELD_REACH > reach
  return reach + (follows ? (reach - start) * LEVEL_OVERLAP * shadows.shadowOverlapScale : 0)
}
