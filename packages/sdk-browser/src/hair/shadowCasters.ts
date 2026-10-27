import { frustumExcludesBox } from '../../../math/src/geometry/frustum/box.ts'
import { FRUSTUM_PLANE_VALUES } from '../../../math/src/geometry/frustum/frustum.ts'
import { sphereMeetsCone } from '../../../math/src/geometry/sphere.ts'
import { dotVector3, length3 } from '../../../math/src/vector/vector.ts'
import { frameAround } from '../../../math/src/vector/frame.ts'
import type { SceneLight } from '../../../sdk-core/src/scene/light/contracts.ts'
import type { BoxSphere } from './boxSphere.ts'

/** What the out-of-view test reads of a light that casts. */
export type HairShadowLight = Pick<
  SceneLight,
  'kind' | 'position' | 'direction' | 'range' | 'outerConeAngle'
>

/**
 * THE GROOMS OUT OF VIEW THAT STILL CAST. A groom outside the camera's frustum casts onto what the
 * camera sees when a light that casts reaches it, so it stays in the macro groups (as a member that
 * is not drawn) while one does. The shadow views are the lights': a point, a rect or a spot light
 * reaches a groom whose sphere meets its range (a spot's cone must hold it too, the exact test of the
 * light's own bounds query); a sun reaches it when its bounds, extended along the sun's direction by
 * `distance` on each side, meet the camera's frustum, both held in the sun's frame. That is the test
 * the virtual shadow maps' views all fall under at this phase: their sun clipmaps follow the camera
 * and their local maps lie within the light's range. What a light brings to every groom of an image —
 * the sun's frame and the camera's planes in it, a spot's cone — is worked out once for the image
 * (`hairShadowPlan`), the grooms then asked of it (`hairReachedByLight`).
 */
export interface HairShadowInputs {
  /** The lights that cast: those of the scene's store with `castsShadow`, while shadows are on. */
  readonly lights: readonly HairShadowLight[]
  /** How far along a sun's direction the bounds of a groom are extended, in metres. */
  readonly distance: number
}

/** What a light brings to every groom of an image. */
interface LightPlan {
  light: HairShadowLight
  /** A sun's frame, its three axes one after the other (the direction, then two across it), and the
   *  camera's frustum planes in it. */
  readonly axes: Float64Array
  readonly planes: Float64Array
  /** A spot's cone: the length of its axis and the sine and cosine of its half-angle; `unit` 0 for a
   *  light that holds no cone. */
  unit: number
  sin: number
  cos: number
}

/** The plan of an image: its lights' (`lights[0..count)`), refilled in place by each. */
export interface HairShadowPlan {
  readonly lights: LightPlan[]
  count: number
  distance: number
}
const plan: HairShadowPlan = { lights: [], count: 0, distance: 0 }
/** The sun's frame holds the groom's box between these two corners. */
const corners = new Float64Array(6)
const rows = new Float64Array(6)

/** The plan of the image of the camera whose frustum planes are `planes`, for the lights of `shadow`.
 *  The record is refilled by each call and valid until the next. */
export function hairShadowPlan(shadow: HairShadowInputs, planes: Float64Array): HairShadowPlan {
  const { lights } = shadow
  plan.count = lights.length
  plan.distance = shadow.distance
  for (let k = 0; k < lights.length; k++) {
    const light = lights[k]!
    const held = (plan.lights[k] ??= {
      light,
      axes: new Float64Array(9),
      planes: new Float64Array(FRUSTUM_PLANE_VALUES),
      unit: 0,
      sin: 0,
      cos: 0,
    })
    held.light = light
    held.unit = 0
    const { direction } = light
    if (light.kind === 'directional' && direction) sunFrame(held, direction, planes)
    else if (light.kind === 'spot' && direction && light.outerConeAngle) {
      held.unit = length3(direction[0], direction[1], direction[2])
      held.sin = Math.sin(light.outerConeAngle)
      held.cos = Math.cos(light.outerConeAngle)
    }
  }
  return plan
}

/** Writes into `held` the sun's frame for the propagation direction `direction` — the first axis along
 *  it, the others across it — and the camera's frustum planes `planes` in it. */
function sunFrame(held: LightPlan, direction: readonly number[], planes: Float64Array) {
  const { axes, planes: inFrame } = held
  const length = length3(direction[0]!, direction[1]!, direction[2]!)
  const x = direction[0]! / length,
    y = direction[1]! / length,
    z = direction[2]! / length
  frameAround(rows, x, y, z)
  axes[0] = x
  axes[1] = y
  axes[2] = z
  for (let k = 0; k < 6; k++) axes[3 + k] = rows[k]!
  for (let p = 0; p < FRUSTUM_PLANE_VALUES; p += 4) {
    for (let axis = 0; axis < 3; axis++) inFrame[p + axis] = dotVector3(axes, planes, axis * 3, p)
    inFrame[p + 3] = planes[p + 3]!
  }
}

/** Whether a local light reaches `bounds`: the spheres meet, and a spot's cone holds the bounds'
 *  sphere. */
function localReaches(held: LightPlan, bounds: BoxSphere) {
  const { light } = held
  const { position, range } = light
  if (!position || !range) return false
  const { sphere } = bounds
  const distance = length3(
    sphere[0]! - position[0],
    sphere[1]! - position[1],
    sphere[2]! - position[2],
  )
  if (distance > range + sphere[3]!) return false
  if (held.unit <= 0) return true
  return sphereMeetsCone(sphere, position, light.direction!, held.unit, held.sin, held.cos)
}

/** Whether a sun of the plan `held` reaches `bounds`: its box in the sun's frame, extended by
 *  `distance` along the sun's direction, meets the camera's frustum in that frame. */
function sunReaches(held: LightPlan, bounds: BoxSphere, distance: number) {
  const { axes } = held
  const { box } = bounds
  for (let axis = 0; axis < 3; axis++) {
    const at = axis * 3
    const centre =
      axes[at]! * (box[0]! + box[3]!) * 0.5 +
      axes[at + 1]! * (box[1]! + box[4]!) * 0.5 +
      axes[at + 2]! * (box[2]! + box[5]!) * 0.5
    const reach =
      Math.abs(axes[at]!) * (box[3]! - box[0]!) * 0.5 +
      Math.abs(axes[at + 1]!) * (box[4]! - box[1]!) * 0.5 +
      Math.abs(axes[at + 2]!) * (box[5]! - box[2]!) * 0.5 +
      (axis === 0 ? distance : 0)
    corners[axis] = centre - reach
    corners[3 + axis] = centre + reach
  }
  return !frustumExcludesBox(
    held.planes,
    corners[0]!,
    corners[1]!,
    corners[2]!,
    corners[3]!,
    corners[4]!,
    corners[5]!,
  )
}

/** Whether a light of the image's plan `reach` (`hairShadowPlan`) reaches the groom of `bounds` that the
 *  camera's frustum does not hold. */
export function hairReachedByLight(bounds: BoxSphere, reach: HairShadowPlan) {
  const { lights, count, distance } = reach
  for (let k = 0; k < count; k++) {
    const held = lights[k]!
    const reached =
      held.light.kind === 'directional'
        ? !!held.light.direction && sunReaches(held, bounds, distance)
        : localReaches(held, bounds)
    if (reached) return true
  }
  return false
}
