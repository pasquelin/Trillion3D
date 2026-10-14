/**
 * WHICH LIGHTS A FRAME SHADOWS (`frameSetup.ts`): those that cast and whose reach a point the frame
 * lights may lie in — the view's frustum, a pixel wider —: the view's lights, never the world's.
 */
import type { SceneLight } from '../../../sdk-core/src/scene/light/contracts.ts'
import {
  frustumExcludesSphere,
  frustumPlanesFromMatrix,
} from '../../../math/src/geometry/frustum/frustum.ts'
import { multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { clampLowWins } from '../../../math/src/scalar/reals.ts'
import type { VsmFrameLight } from './frameSetup.ts'

/** Relative room above what the lighting's f32 range test (`directIncidence`, `distance>=range`)
 *  and the light's f32 position round: a few roundings of 2⁻²⁴ each, far below 2⁻¹⁶. */
const F32_ROOM = 2 ** -16
const seenClip = new Float64Array(16)

/**
 * The planes every point the frame lights lies within, in world space (`frustum.ts` order): the
 * view's frustum one pixel wider on each side of `width` × `height` — a jittered sample stays
 * within half a pixel of it — and its near plane as much nearer; no far plane where the projection
 * has none. The opaque, blend and water passes read a shadow only at their own pixels (bounce
 * traces its proxy): a light no such point is in reach of
 * has no shadow anyone reads.
 */
export function vsmSeenPlanes(
  out: Float64Array,
  view: Float64Array,
  projection: Float64Array,
  width: number,
  height: number,
) {
  multiplyMatrix4(seenClip, projection, view)
  const wider = 1 + 2 / clampLowWins(width, 1, height)
  for (let k = 3; k < 16; k += 4) seenClip[k] *= wider
  frustumPlanesFromMatrix(out, seenClip)
  return out
}

/** Whether a point within `planes` (`vsmSeenPlanes`) can be in reach of `light`: always for a
 *  sun; for a local light, unless its sphere lies wholly behind one plane. The lighting gives a
 *  point out of range exactly zero before any shadow read (`directIncidence`). */
export function vsmLightSeen(light: SceneLight, planes: Float64Array) {
  if (light.kind === 'directional' || !light.position || !light.range) return true
  const [x, y, z] = light.position
  const reach =
    light.range + F32_ROOM * (light.range + Math.max(Math.abs(x), Math.abs(y), Math.abs(z)))
  return !frustumExcludesSphere(planes, x, y, z, reach)
}

/** Whether the frame shadows `l`: it casts, and a lit point of the frame is in reach of it
 *  (`vsmLightSeen`). What the maps, their tables and the mask are sized by: the view's lights, never
 *  the world's. */
export const vsmShadowed = (l: VsmFrameLight) => l.light.castsShadow && (l.visible ?? true)
