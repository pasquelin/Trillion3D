import { lightRayTraced } from '../../../../../sdk-core/src/contracts/rayTracedShadowOptions.ts'
import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { contactShadowOfLight } from '../../../../../sdk-core/src/scene/light/lightContactShadow.ts'
import {
  LIGHT_SETTINGS,
  type SceneLight,
} from '../../../../../sdk-core/src/scene/light/contracts.ts'
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

/**
 * Whether the ray-traced shadow of `light` is denoised (`rayTracedShadowsDenoiser`): a light with a size to blur by — a sun with an angular radius, a lamp with an emitter radius or length, a
 * rectangle — has a penumbra; a point source casts a hard shadow and keeps its rays whole.
 */
export function rayTracedDenoised(settings: ShadowValues, light: SceneLight) {
  if (!settings.rayTracedShadowsDenoiser) return false
  if (light.kind === 'directional')
    return (light.angularRadius ?? LIGHT_SETTINGS.sunAngularRadius) > 0
  if (light.kind === 'rect') return true
  return (light.emitterRadius ?? 0) > 0 || (light.emitterLength ?? 0) > 0
}
