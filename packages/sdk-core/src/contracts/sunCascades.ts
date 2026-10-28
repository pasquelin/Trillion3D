import type { LightShadow } from './lightShadowOptions.ts'
import type { ShadowValues } from './shadowOptions.ts'

/**
 * THE CASCADES OF A SUN'S SHADOWS, laid from the light's settings (`lightShadowOptions.ts`) and the
 * view's (`shadowOptions.ts`, `sunShadowOptions.ts`) — the only place their distances are made. The
 * engine draws the near cascades as one clipmap, so their layout shapes nothing but two things: the
 * edge the far-shadow test leaves casters out past, and the cascade of the distance fields that
 * follows them, whose planes `distanceField` carries. Lengths are in metres.
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
 * The distance-field cascade is made where the view's `shadowFarField` is on and its
 * `distanceFieldShadowQuality` is above 0, the light's `distanceFieldShadows` is, the scene has
 * distance fields, and the light's
 * `distanceFieldShadowDistance` times the view's `distanceFieldDistanceScale` is past the near
 * levels' (or above 0, where there is none): it runs from the near levels' end to that distance,
 * its far end extended by its own overlap where more cascades are due after it, else faded out
 * before that end, over the overlap times `distanceFieldFarTransitionScale`.
 */

/** The planes of the distance-field cascade, from the eye along the view. It is traced where the
 *  depth lies between `minDepth` and `maxDepth`, faded in from `nearFadeOffset` over the length
 *  whose inverse is `invNearFadeLength` — the last near level's overlap — and out from `fadeOffset`
 *  over that of `invFadeLength` (0, no fade, with `fadeOffset` 0). */
export interface DistanceFieldCascade {
  readonly near: number
  readonly far: number
  readonly minDepth: number
  readonly maxDepth: number
  readonly fadeOffset: number
  readonly invFadeLength: number
  readonly nearFadeOffset: number
  readonly invNearFadeLength: number
}

/** A sun's cascades: the far-shadow test's edge, 0 for none, and its distance-field cascade, if any. */
export interface SunCascades {
  readonly edge: number
  readonly distanceField?: DistanceFieldCascade
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
/** The least length, in metres, a fade is divided by. */
const FADE_LENGTH_MIN = 1e-5

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
  if (!hasField) return { edge }
  // The cascade's own span, from the near levels' end — the view's near plane where there is none.
  const start =
    near + accumulatedScale(light.shadowCascadeExponent, nearCount, nearCount) * (reach - near)
  let far = fieldReach,
    fade = (far - start) * overlap,
    fadeOffset = far
  if (nearCount < total - 1) far += fade
  else {
    fade *= view.distanceFieldFarTransitionScale
    fadeOffset -= fade
  }
  const nearFade = nearCount > 0 ? (reach - lastNear) * overlap : 0,
    fadeLength = far - fadeOffset
  return {
    edge,
    distanceField: {
      ...{ near: start, far, minDepth: start - nearFade, maxDepth: far },
      ...(fadeLength > 0
        ? { fadeOffset, invFadeLength: 1 / Math.max(fadeLength, FADE_LENGTH_MIN) }
        : { fadeOffset: 0, invFadeLength: 0 }),
      ...(nearFade > 0
        ? {
            nearFadeOffset: start - nearFade,
            invNearFadeLength: 1 / Math.max(nearFade, FADE_LENGTH_MIN),
          }
        : { nearFadeOffset: -1, invNearFadeLength: 1 }),
    },
  }
}
