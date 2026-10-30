import { clamp } from '../../../../../../math/src/scalar/reals.ts'
import {
  cascadeCount,
  cascadeDistance,
  cascadeRange,
  cascadeSphere,
  type SunCascadeSettings,
  type ViewCascadeSettings,
} from '../cascadeSplits.ts'

/**
 * THE DISTANCE-FIELD CASCADE OF A SUN WITH CLASSIC SHADOW MAPS: the one cascade after the shadow-mapped ones, from where the last of them ends (the view's near plane when the
 * sun has none) to the sun's distance-field distance, traced by rays through the meshes' distance fields. It is the last cascade, so its range does not grow: it fades to nothing
 * over the share of its length the other cascades fade over, the view's transition scale in it, times `farTransitionScale` (0 to 1), by moving its fade plane in; it fades
 * in from the last shadow-mapped cascade over that cascade's fade length. All lengths are centimetres, the unit of the shadow settings.
 */
export interface FieldCascade {
  /** Where the cascade's slice of the view's depth begins and ends. */
  readonly near: number
  readonly far: number
  /** The depth where its weight begins to fall to nothing, and the length of that fall. */
  readonly fadePlane: number
  readonly fadeLength: number
  /** The length, before `near`, over which its weight rises from nothing (the last shadow-mapped cascade's fade; 0 when there is none). */
  readonly nearFadeLength: number
  /** The sphere that holds the slice: its centre's depth along the view axis and its radius. */
  readonly centre: number
  readonly radius: number
}

/** What decides whether a sun has the cascade: the view's switches and the sun's own. */
export interface FieldCascadeInput {
  readonly sun: SunCascadeSettings
  readonly view: ViewCascadeSettings
  /** The sun's distance-field distance, scaled by the view's (`distanceFieldDistanceScale`), centimetres; 0 where the sun has none (`distanceFieldShadows` off). */
  readonly reach: number
  readonly farTransitionScale: number
  /** The half fields' tangents of the view. */
  readonly tan: readonly [number, number]
}

/** The cascade of the sun, or none where its reach does not pass the end of the shadow-mapped cascades (or there are none and the reach is 0). */
export function fieldCascade({
  sun,
  view,
  reach,
  farTransitionScale,
  tan,
}: FieldCascadeInput): FieldCascade | undefined {
  const count = cascadeCount(sun, view)
  const near = count > 0 ? cascadeDistance(sun, view) : view.near
  if (!(count > 0 ? reach > near : reach > 0)) return undefined
  const transition = sun.transitionFraction * clamp(view.transitionScale, 0, 2)
  const fadeLength = (reach - near) * transition * clamp(farTransitionScale, 0, 1)
  let nearFadeLength = 0
  if (count > 0) {
    const last = cascadeRange(sun, view, count - 1)
    nearFadeLength = (last.far - last.near) * transition
  }
  const sphere = cascadeSphere(near, reach, tan[0], tan[1])
  return {
    near,
    far: reach,
    fadePlane: reach - fadeLength,
    fadeLength,
    nearFadeLength,
    centre: sphere.depth,
    radius: sphere.radius,
  }
}
