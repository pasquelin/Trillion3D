import { lightRayTraced } from '../../../../../sdk-core/src/contracts/rayTracedShadowOptions.ts'
import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { contactShadowOfLight } from '../../../../../sdk-core/src/scene/light/lightContactShadow.ts'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

/**
 * The rays a pixel casts to `light` for its shadow: none (0) where the light keeps its shadow maps — its kind is not allowed, it asks for none
 * (`castRayTracedShadow`) or follows a view that casts none (`rayTracedShadows`) —, else the view's count from 0 (`rayTracedShadowsSamplesPerPixel`) or, with -1, the light's own.
 */
export function rayTracedSamples(settings: ShadowValues, light: SceneLight) {
  const own = contactShadowOfLight(light)
  if (!lightRayTraced(settings, light.kind, own.castRayTracedShadow)) return 0
  const view = settings.rayTracedShadowsSamplesPerPixel
  return Math.max(1, view >= 0 ? view : own.rayTracedShadowSamplesPerPixel)
}

/**
 * Whether any light of the scene casts its shadow by rays this image, so that the lighting keeps the scene trace (`sceneRaysOf`) for them as it does for the
 * probes' rays: the explicit setting is enough, no hardware is asked.
 */
export function rayTracedShadowsTraced(rt: WebgpuPagesRuntime) {
  const settings = rt.lights?.vsm?.state.maps.shadows
  const store = rt.lights?.store
  if (!settings || !store) return false
  for (const id of store.ids) {
    const light = store.light(id)
    if (light && rayTracedSamples(settings, light) > 0) return true
  }
  return false
}
