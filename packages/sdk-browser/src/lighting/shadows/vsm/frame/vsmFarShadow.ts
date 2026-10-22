import {
  contextReader,
  resolveSettingsInto,
} from '../../../../../../sdk-core/src/contracts/settingRules.ts'
import { CUT_RULES } from '../../../../../../sdk-core/src/contracts/cutOptions.ts'
import {
  farShadowDistance,
  SHADOW_DISTANCE_DEFAULT,
  SHADOW_RULES,
  type ShadowValues,
} from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { SceneLight } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import type { VsmMapSettings } from '../mapSettings.ts'
import type { VsmBoundLight } from '../rows/rowPageBound.ts'

/** The sun's shadow setting `field` the session holds (`shadowOptions.ts`), by its one reading. */
export const shadowSetting = contextReader(SHADOW_RULES)

const cutSetting = contextReader(CUT_RULES)

/**
 * The draw distances the casters take (`VsmRenderScene.drawDistance`): the scale of the view's
 * (`cutViewDistanceScale`) when the camera's cut holds a placement that names a distance and the
 * host did not turn the cull off (`cutDrawDistanceCulling`), none otherwise.
 */
export const casterDrawDistance = (
  rt: WebgpuPagesRuntime,
  cut: { readonly drawDistances: boolean } | null | undefined,
) =>
  cut?.drawDistances && cutSetting(rt, 'cutDrawDistanceCulling')
    ? { scale: cutSetting(rt, 'cutViewDistanceScale') }
    : undefined

/** The shadow settings the session holds, resolved into the one object each call rewrites. */
const shadows = {} as ShadowValues
const mapSettings = { shadows, frame: 0 }

/** The shadow settings the session holds and the scene frame, as the maps' setup reads them
 *  (`VsmMapSettings`): the one object, rewritten by each call. */
export function vsmMapSettings(rt: WebgpuPagesRuntime): VsmMapSettings {
  resolveSettingsInto(SHADOW_RULES, rt.context, shadows)
  mapSettings.frame = rt.run.frame
  return mapSettings
}

/**
 * How far from the eye, in metres, the shadow maps of `light` still take every caster
 * (`farShadowDistance`): its shadow distance, scaled and shaped by the sun's shadow settings the
 * session holds (`SHADOW_RULES`), cut from the view's `near` plane, or 0 — none — when the culling
 * is off, the product is zero or the light is not a sun. A sun's clipmap carries it in its maps'
 * records (`VsmDirectionalLightInput.farShadowDistance`); the raster reads it there
 * (`vsmFarShadowSkipped`).
 */
export const sunFarShadowDistance = (rt: WebgpuPagesRuntime, light: SceneLight, near: number) =>
  light.kind === 'directional'
    ? farShadowDistance(
        light.shadowDistance ?? SHADOW_DISTANCE_DEFAULT,
        near,
        resolveSettingsInto(SHADOW_RULES, rt.context, shadows),
      )
    : 0

/**
 * The distance past which no map view of the frame takes a caster that does not cast far shadows:
 * the greatest far-shadow distance of `lights` when every one is a sun that has one, else 0 — a
 * local light, or a sun with none, takes every caster (`VsmRenderScene.farDrop`).
 */
export function farDropOf(lights: readonly VsmBoundLight[]) {
  let drop = 0
  for (const { kind, clipmap } of lights) {
    const distance = kind === 'directional' ? (clipmap?.light.farShadowDistance ?? 0) : 0
    if (!(distance > 0)) return 0
    drop = Math.max(drop, distance)
  }
  return drop
}
