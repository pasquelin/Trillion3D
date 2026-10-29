import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { accumulatedScale } from '../../../../../sdk-core/src/contracts/sunCascades.ts'
import { DEFAULT_CLASSIC_CASCADES } from '../../../../../sdk-core/src/scene/light/fields.ts'
import { VSM_CM_PER_UNIT } from '../vsm/constants.ts'

/**
 * THE CASCADES OF A SUN'S CLASSIC SHADOW (`shadowVirtualEnable` off): where each cascade of the view's depth begins and ends, and how far it fades into the
 * next. All lengths are centimetres, the unit of the shadow settings (`VSM_CM_PER_UNIT` brings a scene's own to it).
 *
 * The sun's own settings are those a light has by default: four cascades, an exponent of 3 for how much longer each cascade is than the one before,
 * a transition of a tenth of a cascade, a shadow distance of 400 metres.
 */

/** What a sun says of its cascades. */
export interface SunCascadeSettings {
  /** The number of cascades the sun asks (`DynamicShadowCascades`). */
  readonly cascades: number
  /** How much longer each cascade is than the one before: 1 linear, 2 twice as long, … (`CascadeDistributionExponent`). */
  readonly exponent: number
  /** The share of a cascade's length it fades into the next over (`CascadeTransitionFraction`). */
  readonly transitionFraction: number
  /** The distance the shadow reaches, centimetres (`DynamicShadowDistanceMovableLight`). */
  readonly distance: number
}

/** The settings of a sun that sets none. */
export const DEFAULT_SUN_CASCADES: SunCascadeSettings = {
  cascades: DEFAULT_CLASSIC_CASCADES.cascades,
  exponent: DEFAULT_CLASSIC_CASCADES.exponent,
  transitionFraction: DEFAULT_CLASSIC_CASCADES.transitionFraction,
  distance: DEFAULT_CLASSIC_CASCADES.distance * VSM_CM_PER_UNIT,
}

/** What the view says of them (`shadowDistanceScale`, `shadowCsmMaxCascades`, `shadowCsmTransitionScale`). */
export interface ViewCascadeSettings {
  readonly distanceScale: number
  readonly maxCascades: number
  readonly transitionScale: number
  /** The view's near plane, centimetres. */
  readonly near: number
}

/** The distance the cascades reach: the sun's, scaled by the view's (0 to 2); 0 where the view allows no cascade. */
export const cascadeDistance = (sun: SunCascadeSettings, view: ViewCascadeSettings) =>
  !(view.maxCascades > 0) ? 0 : sun.distance * clamp(view.distanceScale, 0, 2)

/** How many cascades the sun is drawn in: its own count held to the view's, none where the distance is 0. */
export const cascadeCount = (sun: SunCascadeSettings, view: ViewCascadeSettings) =>
  cascadeDistance(sun, view) > 0
    ? clamp(Math.trunc(sun.cascades) || 0, 0, Math.trunc(view.maxCascades))
    : 0

/** Where split `index` lies: 0 is the view's near plane, `count` the end of the last cascade. */
function splitDistance(sun: SunCascadeSettings, view: ViewCascadeSettings, index: number) {
  const far = cascadeDistance(sun, view)
  return (
    view.near + accumulatedScale(sun.exponent, index, cascadeCount(sun, view)) * (far - view.near)
  )
}

/** One cascade: the depth range it covers, with the fade into the next added at its far end, and the plane that fade begins at. */
export interface CascadeRange {
  readonly near: number
  /** The far end, the fade included (but for the last cascade, whose fade lies inside its range). */
  readonly far: number
  /** The depth where the cascade's weight begins to fall to the next one's (the last cascade's, to nothing). */
  readonly fadePlane: number
  /** The length of the fade, past `fadePlane` up to `far`. */
  readonly fadeLength: number
  /** The length of the previous cascade's fade, which this one is the fade's other side of. */
  readonly nearFadeLength: number
}

/** The range of cascade `index` (0 to `cascadeCount` − 1). */
export function cascadeRange(
  sun: SunCascadeSettings,
  view: ViewCascadeSettings,
  index: number,
): CascadeRange {
  const count = cascadeCount(sun, view)
  const transition = sun.transitionFraction * clamp(view.transitionScale, 0, 2)
  const near = splitDistance(sun, view, index)
  let far = splitDistance(sun, view, index + 1)
  let fadePlane = far
  const fadeLength = (far - near) * transition
  if (index < count - 1) far += fadeLength
  // The last cascade fades to nothing: its fade plane moves in, its range does not grow.
  else fadePlane -= fadeLength
  const before =
    index >= 1
      ? (splitDistance(sun, view, index) - splitDistance(sun, view, index - 1)) * transition
      : 0
  return { near, far, fadePlane, fadeLength: far - fadePlane, nearFadeLength: before }
}

/** The sphere that bounds the slice of the view's frustum between depths `near` and `far` (`tanX`, `tanY` the tangents of its half fields), as its centre's depth along the view axis
 *  and its radius: the centre that makes the far and near corners equally far, held between the planes; the radius reaches the farthest corner, at least 1. */
export function cascadeSphere(near: number, far: number, tanX: number, tanY: number) {
  const length = far - near
  const farDiagonal = (tanX * far) ** 2 + (tanY * far) ** 2
  const nearDiagonal = (tanX * near) ** 2 + (tanY * near) ** 2
  const depth = clamp(far - ((nearDiagonal - farDiagonal) / (2 * length) + length * 0.5), near, far)
  const reach = Math.max(farDiagonal + (far - depth) ** 2, nearDiagonal + (depth - near) ** 2)
  return { depth, radius: Math.max(Math.sqrt(reach), 1) }
}

/** The bounding sphere of cascade `index` of `sun` seen by `view` (`tanX`, `tanY` the tangents of the view's half fields): its centre's depth along the view axis and its radius. */
export function cascadeSphereOf(
  sun: SunCascadeSettings,
  view: ViewCascadeSettings,
  index: number,
  tanX: number,
  tanY: number,
) {
  const range = cascadeRange(sun, view, index)
  return cascadeSphere(range.near, range.far, tanX, tanY)
}
