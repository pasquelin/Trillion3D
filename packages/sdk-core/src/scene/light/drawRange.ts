import { FLOAT32_MIN_NORMAL } from '../../../../math/src/constants.ts'
import { SHADOW_RULES } from '../../contracts/shadowOptions.ts'

/**
 * WHICH LIGHTS A PERSPECTIVE VIEW DRAWS, the part that belongs to the light: a point, spot or rectangle
 * light is left out of a view — of its lighting and of its shadow both — when it spans too little of
 * the screen or lies past its own draw distance. The light is measured by its bounding sphere: the ball
 * of its range around its position for a point or a rectangle, the sphere that holds its cone for a
 * spot (`coneSphereAlong`, `coneSphereRadius`). A light whose bounding sphere has the radius `W` (in metres) at the
 * distance `d` from the view, taken to the sphere's centre, is drawn while
 *
 *   (min(0.02, lightMinScreenRadius / W) * factor * d)^2 < 1
 *
 * (0.02 per metre is 0.0002 per centimetre: a light of 1.5 m or less, a light of no range among
 * them, is left out past 50 m, a larger one past `W / lightMinScreenRadius`), `factor` the view's
 * (the horizontal field of view over 90 degrees, 1 where the setting `lightDrawRangeFollowsFieldOfView`
 * is off), and, if it names a `maxDrawDistance` above 0, while `d^2 < (maxDrawDistance *
 * lightMaxDrawDistanceScale)^2` (`inDrawRange`). A directional light and an orthographic view always draw.
 *
 * What depends on the light and the two settings alone is written into the light's record by the
 * store (`LIGHT_FIELD.drawShare`, `maxDrawDistance`; `LightRangeView`); the view's factor and eye meet
 * it where the light is tested, once a view on the CPU (`lightDrawn`), whose decision the light's kind
 * word carries to every pass (`LIGHT_UNDRAWN_SHIFT`).
 */

/** The most the screen share factor takes, per metre of distance: 0.0002 per centimetre. */
const SCREEN_SHARE_PER_METRE = 0.02

/** The cosine of the half-angle under which a cone's bounding sphere is no longer the one that
 *  holds its base: 45 degrees. */
export const CONE_BASE_COSINE = Math.SQRT1_2

/** The distance along the axis, from the apex, of the centre of the sphere that holds a cone of length `range` and half-angle of cosine
 *  `cosine`: under 45 degrees' cosine the one through the base circle, centred `range * cosine` along the axis; else the one through
 *  the apex and the base rim, centred `range / (2 * cosine)` along it. */
export const coneSphereAlong = (range: number, cosine: number) =>
  cosine < CONE_BASE_COSINE ? range * cosine : range / (2 * cosine)

/** The radius of that sphere: `range` times the sine of the half-angle under 45 degrees' cosine, else `range / (2 * cosine)`. */
export const coneSphereRadius = (range: number, cosine: number) =>
  cosine < CONE_BASE_COSINE ? range * Math.sqrt(1 - cosine * cosine) : range / (2 * cosine)

/** The view's settings the lights' draw range is folded with (`ShadowValues`): the share of the screen
 *  below which a light is left out and the factor on the draw distances the lights name. */
export interface LightRangeView {
  lightMinScreenRadius: number
  lightMaxDrawDistanceScale: number
}

/** The view with the settings' defaults. */
export const NO_LIGHT_RANGE_VIEW: Readonly<LightRangeView> = /* @__PURE__ */ (() =>
  Object.freeze({
    lightMinScreenRadius: SHADOW_RULES.lightMinScreenRadius.default,
    lightMaxDrawDistanceScale: SHADOW_RULES.lightMaxDrawDistanceScale.default,
  }))()

/** The share of the screen per metre of distance under which a light whose bounding sphere has the
 *  radius `radius` is left out (`min(0.02, lightMinScreenRadius / radius)`): a sphere of no radius is
 *  the least share's, and a setting of 0 leaves no light out by its size. */
export function drawShareOf(radius: number, view: LightRangeView) {
  if (!(view.lightMinScreenRadius > 0)) return 0
  return radius > 0
    ? Math.min(SCREEN_SHARE_PER_METRE, view.lightMinScreenRadius / radius)
    : SCREEN_SHARE_PER_METRE
}

/** The distance, in metres, past which a light that names `named` as its draw distance is left out
 *  under `view`: 0 for no limit. A scale of 0 leaves a light that names a distance out everywhere,
 *  the least normal distance. */
export const maxDrawDistanceFor = (named: number, view: LightRangeView) =>
  named > 0 ? Math.max(named * view.lightMaxDrawDistanceScale, FLOAT32_MIN_NORMAL) : 0

/**
 * Whether a view of the factor `factor` draws a light of the share `share` (`drawShareOf`) and the greatest draw distance `farthest`
 * (`maxDrawDistanceFor`, 0 for none) whose bounding sphere's centre is `distanceSquared` from the eye: both tests on the squared
 * distance, written so that a distance no comparison orders (NaN) fails the first and the light is left out. The square of the greatest
 * distance is held in single precision, so that a scale of 0, which leaves the least normal float as the distance, leaves a light
 * everywhere out, the eye's own place included. An orthographic view has no factor and asks nothing (`lightDrawViewOf`).
 */
export function inDrawRange(
  distanceSquared: number,
  share: number,
  farthest: number,
  factor: number,
) {
  const scaled = share * factor
  return (
    scaled * scaled * distanceSquared < 1 &&
    (!(farthest > 0) || distanceSquared < Math.fround(farthest * farthest))
  )
}
