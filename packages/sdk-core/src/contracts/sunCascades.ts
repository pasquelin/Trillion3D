import type { LightShadow } from './lightShadowOptions.ts'
import type { ShadowValues } from './shadowOptions.ts'

/**
 * THE CASCADES OF A SUN'S SHADOWS, laid from the light's settings (`lightShadowOptions.ts`) and the
 * view's (`shadowOptions.ts`, `sunShadowOptions.ts`) — the only place their distances are made. The
 * engine draws the near cascades as one clipmap, so their layout shapes nothing but the edge the
 * far-shadow test leaves casters out past. Lengths are in metres.
 *
 * The near levels. The light's `shadowCascades`, at most the view's `shadowNearLevels`, split the
 * distance from the view's near plane to the light's `shadowDistance` times `shadowDistanceScale`,
 * each `shadowCascadeExponent` times the span of the one before; none where either count or the
 * distance is 0. A level's far end is extended by its span times `shadowCascadeTransition` times
 * `shadowOverlapScale`, its overlap into the next, unless it is the last of all.
 *
 * The edge is the far end of the last near level, extended when a cascade follows it: a far level
 * (the light's `farShadowCascades` while its `farShadowDistance` is more than a metre past its
 * shadow distance, at most the view's `shadowMaxFarCascades`) or the distance-field cascade. Where
 * the view's `farShadowCulling` is off there is none.
 *
 * The distance-field cascade is no longer traced on the view (the shadow maps draw every cluster at
 * any distance); it only counts for the edge. It is counted where the view's `shadowFarField` and
 * `distanceFieldShadowing` are on and its `distanceFieldShadowQuality` is above 0, the light's
 * `distanceFieldShadows` is, the scene has distance fields, and the light's
 * `distanceFieldShadowDistance` times the view's `distanceFieldDistanceScale` is past the near
 * levels' (or above 0, where there is none).
 */

/** A sun's cascades: the far-shadow test's edge, 0 for none. */
export interface SunCascades {
  readonly edge: number
}

/** The share of `count` levels' span, each `exponent` times the one before, that lies before level
 *  `index` (0 for the first). */
export function accumulatedScale(exponent: number, index: number, count: number) {
  if (index <= 0) return 0
  let size = 1,
    before = 0,
    total = 0
  for (let k = 0; k < count; k++, size *= exponent) {
    if (k < index) before += size
    total += size
  }
  return before / total
}

/** The least a far cascade's span may be, in metres, for the light to have far levels. */
const FAR_CASCADE_MIN_SPAN = 1

/**
 * The cascades of a sun with the settings `light`, seen from a view whose near plane is `near`, under
 * the view's settings `view`; `distanceFields` is whether the scene has distance fields.
 */
export function sunCascades(
  light: LightShadow,
  near: number,
  view: ShadowValues,
  distanceFields: boolean,
): SunCascades {
  const reach = view.shadowNearLevels > 0 ? light.shadowDistance * view.shadowDistanceScale : 0
  const nearCount = reach > 0 ? Math.min(light.shadowCascades, view.shadowNearLevels) : 0
  const farCount =
    light.farShadowCascades > 0 &&
    light.farShadowDistance - light.shadowDistance > FAR_CASCADE_MIN_SPAN
      ? Math.min(view.shadowMaxFarCascades, light.farShadowCascades)
      : 0
  const fieldReach =
    distanceFields && light.distanceFieldShadows
      ? light.distanceFieldShadowDistance * view.distanceFieldDistanceScale
      : 0
  const hasField =
    view.shadowFarField &&
    view.distanceFieldShadowing &&
    view.distanceFieldShadowQuality > 0 &&
    (nearCount > 0 ? fieldReach > reach : fieldReach > 0)
  const total = Math.max(nearCount + farCount, nearCount + (hasField ? 1 : 0))
  const overlap = light.shadowCascadeTransition * view.shadowOverlapScale
  const lastNear =
    near + accumulatedScale(light.shadowCascadeExponent, nearCount - 1, nearCount) * (reach - near)
  const edge =
    nearCount > 0 && view.farShadowCulling
      ? reach + (nearCount - 1 < total - 1 ? (reach - lastNear) * overlap : 0)
      : 0
  return { edge }
}
