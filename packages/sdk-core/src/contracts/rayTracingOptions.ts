import { flagSetting as flag, rulesOf, type SettingOptions } from './settingRules.ts'

/**
 * THE PROJECT'S RAY TRACING SWITCH, one setting every feature that traces the scene's triangles hangs on: `rayTracingEnable`, on — the value
 * of a new project in the reference. On, each feature takes its own setting (`reflectionHardwareRayTracing`, `screenProbeHardwareRayTracing`,
 * `screenProbeRadianceCacheHardwareRayTracing`, `surfaceCacheDirectLightingHardwareRayTracing`, `surfaceCacheRadiosityHardwareRayTracing`,
 * `translucencyGiHardwareRayTracing`, `screenProbeShortRangeAOHardwareRayTracing`, `visualizeHardwareRayTracing`,
 * `heterogeneousVolumesHardwareRayTracing`, `sampledLightsHardwareRayTracing`); off, each of them reads off whatever it is itself (`gatedFlagSetting`), so every feature
 * marches the distance fields, as a project with ray tracing off does. Run-time setting, as `./settingRules.ts` says. Not named
 * `rayTracing`: the settings are held flat on the engine's context, where `rayTracing` is the scene's ray-tracing file.
 */
export const RAY_TRACING_RULES = /* @__PURE__ */ (() =>
  rulesOf([flag('rayTracingEnable', true)] as const))()

/** The fields of the ray tracing switch's settings. */
export type RayTracingField = keyof typeof RAY_TRACING_RULES

/** What a host writes for the ray tracing switch. */
export type RayTracingOptions = SettingOptions<typeof RAY_TRACING_RULES>
