import type { RayTracingField } from '../contracts/rayTracingOptions.ts'

/** What each setting of the ray tracing switch means (`../contracts/rayTracingOptions.ts`). */
export const RAY_TRACING_MEANINGS: Readonly<Record<RayTracingField, string>> = {
  rayTracingEnable:
    "Whether the world traces rays through the scene's triangles at all; true by default, as a new project has it. The switch the per-feature settings hang on: reflectionHardwareRayTracing, screenProbeHardwareRayTracing, screenProbeRadianceCacheHardwareRayTracing, screenProbeShortRangeAOHardwareRayTracing, surfaceCacheDirectLightingHardwareRayTracing, surfaceCacheRadiosityHardwareRayTracing, translucencyGiHardwareRayTracing, heterogeneousVolumesHardwareRayTracing, visualizeHardwareRayTracing and sampledLightsHardwareRayTracing. False, every one of them reads false whatever its own value, so each feature marches the distance fields instead, as a project with ray tracing off does.",
}
