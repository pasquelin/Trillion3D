import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { screenProbeSettingsOf } from '../screen/settingsOf.ts'
import { flushTranslucencyCache } from '../../translucencyGi/cache.ts'

/** Whether the radiance cache of this image casts its rays through the scene's triangles where it can: the cache is made and its
 *  setting (`screenProbeRadianceCacheHardwareRayTracing`) is on. The scene trace is the surface cache lighting's, which keeps it
 *  for the cache (`sceneRaysOf`). */
export function radianceCacheTraced(rt: WebgpuPagesRuntime) {
  const now = screenProbeSettingsOf(rt)
  return (
    rt.bounce.wanted &&
    rt.bounce.probes !== undefined &&
    now.radianceCache &&
    now.values.screenProbeRadianceCacheHardwareRayTracing
  )
}

/** The update of the radiance cache the image queued and the screen probes made none of — they cast nothing, or were not
 *  ready — made now, in a pass of its own, after them and before the lighting (`traceScreenProbes`). */
export function flushRadianceCache(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  rt.bounce.probes?.cache.flush(encoder)
  flushTranslucencyCache(rt.bounce, encoder)
}
