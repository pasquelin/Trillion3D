/**
 * WHICH LOCAL LIGHTS TAKE A SHADOW THIS FRAME: the gates a point, spot or rectangle light passes, in
 * their order, before its maps are set up (`frame/vsmPlan.ts`, `frameLights`), the settings of
 * `shadowMapOptions.ts` at their reference defaults:
 * 1. a point or rectangle light takes one only where point-light shadows are supported
 *    (`shadowPointLightShadows`);
 * 2. a light whose own `shadowResolutionScale` is 0 takes none where that disables it
 *    (`shadowResolutionScaleZeroDisables`);
 * 3. a point or rectangle light takes one only as a cube of faces (`shadowPointLightCubemaps`);
 * 4. the light's resolution on the screen — the radius of its bounds in pixels, times its kind's
 *    texels per pixel (`shadowTexelsPerPixelPoint`, `Spot`, `Rect`), scaled and held by the light's
 *    own scale and `shadowMaxResolution` — fades its shadow in, from `shadowMinResolution` up to
 *    `shadowFadeResolution` by `shadowFadeExponent`; a fade of 1/256 or less takes none.
 * The sun has none of them: its clipmaps follow the eye.
 */
import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import {
  shadowResolutionScaleOf,
  spotConesOf,
} from '../../../../../sdk-core/src/scene/light/fields.ts'
import { length3 } from '../../../../../math/src/vector/vector.ts'
import { VSM_UNIT_PER_CM } from './constants.ts'

/** The fade below which a light takes no shadow: 1/256. */
const MIN_FADE = 1 / 256
/** The border of a spot's shadow map, texels a side: a cube's has none. */
const SPOT_BORDER = 4

/** What the gate reads of the view a light is seen from: its projection's scales, the eye, and the
 *  size in pixels of the image drawn. */
export interface VsmGateView {
  projection: ArrayLike<number>
  eye: ArrayLike<number>
  width: number
  height: number
}

/**
 * The fade of a shadow of resolution `resolution` texels: 0 at and below `least`, 1 above `whole`,
 * between them the exponent `exponent` of its place in the range, rescaled so that its first step
 * is 0. A `least` at or past `whole` leaves no range between: 0 or 1.
 */
function vsmShadowFade(resolution: number, whole: number, least: number, exponent: number) {
  if (resolution > whole) return 1
  if (!(resolution > least)) return 0
  const inverse = 1 / (whole - least)
  const first = inverse ** exponent
  return (((resolution - least) * inverse) ** exponent - first) / (1 - first)
}

/** The resolution a light's scale and the most texels leave of `resolution`: a scale above 1
 *  raises it before the most holds it, one at or below 1 lowers it after. */
function scaledResolution(resolution: number, scale: number, most: number) {
  const raised = scale > 1 ? resolution * scale : resolution
  const held = Math.min(raised, most)
  return scale <= 1 ? held * scale : held
}

/** The radius in pixels of the bounds of a light seen from `view`: its radius — a spot's, that of
 *  the sphere inscribed in the end of its cone — over its distance from the eye, at least 1 cm,
 *  times the greater half size of the image in pixels per unit of view depth. */
function screenRadius(light: SceneLight, view: VsmGateView) {
  const [x, y, z] = light.position!
  const range = light.range!
  let reach = range,
    cx = x,
    cy = y,
    cz = z
  if (light.kind === 'spot') {
    const outer = spotConesOf(light)[1]
    const [dx, dy, dz] = light.direction!
    const along = range * Math.cos(outer)
    cx += dx * along
    cy += dy * along
    cz += dz * along
    reach = range * Math.sin(outer)
  }
  const distance = length3(cx - view.eye[0], cy - view.eye[1], cz - view.eye[2])
  const scale = Math.max(
    view.width * 0.5 * view.projection[0],
    view.height * 0.5 * view.projection[5],
  )
  return (scale * reach) / Math.max(distance, VSM_UNIT_PER_CM)
}

/**
 * Whether `light` takes a shadow when seen from `view`, by the gates above, `shadows` the settings
 * the session holds: a sun, or a light with no position or range to measure, always.
 */
export function vsmLocalShadowGate(light: SceneLight, view: VsmGateView, shadows: ShadowValues) {
  if (light.kind === 'directional' || !light.position || !light.range) return true
  const cube = light.kind !== 'spot'
  if (cube && !shadows.shadowPointLightShadows) return false
  const scale = shadowResolutionScaleOf(light)
  if (shadows.shadowResolutionScaleZeroDisables && scale <= 0) return false
  if (cube && !shadows.shadowPointLightCubemaps) return false
  const texels =
    light.kind === 'point'
      ? shadows.shadowTexelsPerPixelPoint
      : light.kind === 'rect'
        ? shadows.shadowTexelsPerPixelRect
        : shadows.shadowTexelsPerPixelSpot
  const unscaled = screenRadius(light, view) * texels
  // The most texels, less the border of both sides of a spot's map: never under 0, so that a cap
  // smaller than the borders holds the shadow to nothing rather than wrapping to no cap at all.
  const most = Math.max(0, shadows.shadowMaxResolution - 2 * (cube ? 0 : SPOT_BORDER))
  const scaled = scaledResolution(unscaled, scale, most)
  const resolution = shadows.shadowFadeUsesResolutionScale ? scaled : unscaled
  const fade = vsmShadowFade(
    resolution,
    shadows.shadowFadeResolution,
    shadows.shadowMinResolution,
    shadows.shadowFadeExponent,
  )
  return fade > MIN_FADE
}
