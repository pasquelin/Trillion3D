import type { SurfaceCacheSettings } from '../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'

/**
 * WHETHER THE DEVICE TRACES RAYS IN HARDWARE: where it does, the scene's rays go through its triangles (the direct light's shadows and
 * the radiosity of the surface cache, the screen probes, the radiance cache, the reflections) as their settings ask; where it does not,
 * they are marched through the global distance field, as the reference's lighting chooses by the same test. WebGPU exposes no ray
 * tracing hardware: a ray through the triangles there is a tree walked by a compute program, many times the cost of the field's march.
 */
export const hardwareRayTracing = (): boolean => false

/** The surface cache's settings as the device runs them, by the settings: their rays through the triangles off where it traces none. */
const onDevice = new WeakMap<SurfaceCacheSettings, SurfaceCacheSettings>()

/** `settings` as the device runs them (`hardwareRayTracing`): the same object each image for the same settings. */
export function surfaceCacheRaysOf(settings: SurfaceCacheSettings): SurfaceCacheSettings {
  if (hardwareRayTracing()) return settings
  let held = onDevice.get(settings)
  if (!held)
    onDevice.set(
      settings,
      (held = {
        ...settings,
        surfaceCacheDirectLightingHardwareRayTracing: false,
        surfaceCacheRadiosityHardwareRayTracing: false,
      }),
    )
  return held
}
