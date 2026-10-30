import {
  choiceSetting as choice,
  flagSetting as flag,
  integerSetting as integer,
  type SettingRule,
} from './settingRules.ts'

/**
 * The reflections' hit lighting (`packages/sdk-browser/src/lighting/reflections/hitLighting/`), settings of the reflections family
 * (`./reflectionOptions.ts`, which lists `HIT_LIGHTING_RULES`): run-time settings as `./settingRules.ts` says, each default the reference's.
 *
 * WHAT IT IS. A reflection ray that meets the scene's triangles reads the light the surface cache holds at the hit. With the hit lighting the
 * hits that need it are traced again, sorted by material, and lit where they stand: the hit's own material (diffuse colour, emission) lit by the
 * scene's lights with a shadow ray each, plus the surface cache's indirect light (or, with `hardwareRayTracingHitLightingSkylight`, the sky light's).
 *
 * - `reflectionHardwareRayTracingHitLighting`, off — the second trace for the hits the surface cache cannot light (no card gave any light);
 * - `hardwareRayTracingLightingMode`, `'surfaceCache'` — `'hitLighting'` and `'hitLightingForReflections'` light every hit of the reflections
 *   where it stands, `'surfaceCache'` leaves it to the setting above; `'hitLighting'` alone lights the hits of the screen probes' rays and of the radiance cache's too (the reference's
 *   `GetHitLightingMode == HitLighting` gate of both), the other two keep the surface cache for them;
 * - `hardwareRayTracingHitLightingAllowed`, on — the scalability switch that lets any of them be on;
 * - `reflectionHardwareRayTracingBucketMaterials`, on — the traces of the second pass are sorted by material so that the threads that follow one another shade the same one;
 * - `hardwareRayTracingHitLightingDirectLighting`, on — the lights are evaluated at the hit, the material's whole response (diffuse and specular lobe) toward the eye; off, the surface cache's own light is read as it stands (with the sky light on, the hit has the sky light's terms alone);
 * - `hardwareRayTracingHitLightingShadowMode`, `'soft'` — `'off'` no shadow, `'hard'` one ray to the centre of the light, `'soft'` one ray to a point of its source;
 * - `hardwareRayTracingHitLightingSkylight`, `'standalone'` — the sky light's unshadowed irradiance in place of the surface cache's indirect light: `'off'`, `'on'`, or
 *   `'standalone'`, on only when the project has no surface-cache indirect lighting (never here: the engine always has it);
 * - `hardwareRayTracingHitLightingReflectionCaptures`, off — with the sky light on, the hit's specular is the top layer's reflectance on the sky light's filtered cube (the reflection captures' only source here) along the reflected ray, in place of the rough share of the irradiance;
 * - `hardwareRayTracingHitLightingForceOpaque`, off — the hit lighting's own trace (the one that meets the hit again) skips the any-hit test of the masks;
 * - `hardwareRayTracingHitLightingShadowTranslucencyMode`, `'masked'` — `'opaque'`, `'masked'` or `'fractional'`: whether the shadow rays cut the masked and the translucent surfaces;
 * - `reflectionMaxBounces`, 1 — the reflection rays that continue from a lit hit, a mirror seen in a mirror: 1 is a single ray, more follow the hit's own specular reflection (the surfaces rougher than the reflections trace keep the rough approximation of the light), each hit lit as the first;
 * - `reflectionRayTracedTranslucentRefractions`, on — the project's switch that lets the translucent surfaces be traced through (the reference's per-project setting; the refraction events below need it);
 * - `reflectionMaxRefractionBounces`, 0 — the refraction events of a path: with 1 or more, the hit lighting meets the translucent surfaces (they are no longer passed by) and the path goes on through each, weighed by what the surface lets through, up to that many times;
 * - `rayTracingLightGridResolution`, 256 — the cells a side of the 2D light grid that culls the lights out of the hit lighting's loop (the lights that reach a hit are found in its cell; the suns are always looped over);
 * - `rayTracingLightGridMaxCount`, 128 — the most lights a cell keeps (the lesser of it and the number of local lights is used);
 * - `rayTracingLightGridAxis`, -1 — the axis the grid is projected along: 0 to 2 forces one, -1 picks, cell by cell, the axis whose cell keeps the fewest lights.
 */

/** The reflection bounces the hit lighting follows: the most a path is given (the reference's bound). */
export const HIT_LIGHTING_MAX_BOUNCES = 64

/** The modes of `hardwareRayTracingLightingMode`. */
export const HIT_LIGHTING_MODES = [
  'surfaceCache',
  'hitLighting',
  'hitLightingForReflections',
] as const
/** The shadow modes of the hit lighting. */
export const HIT_LIGHTING_SHADOW_MODES = ['off', 'hard', 'soft'] as const
/** The sky light modes of the hit lighting. */
export const HIT_LIGHTING_SKYLIGHT_MODES = ['off', 'on', 'standalone'] as const
/** How the shadow rays treat the translucent and masked surfaces. */
export const HIT_LIGHTING_TRANSLUCENCY_MODES = ['opaque', 'masked', 'fractional'] as const

/** The most cells a side of the light grid has. */
const LIGHT_GRID_MAX_RESOLUTION = 2048
/** The most lights a cell of the light grid can keep. */
const LIGHT_GRID_MAX_COUNT = 65536

/** The hit lighting's settings by field, each with the reference's default. */
export const HIT_LIGHTING_RULES = [
  flag('reflectionHardwareRayTracingHitLighting', false),
  flag('reflectionHardwareRayTracingBucketMaterials', true),
  choice('hardwareRayTracingLightingMode', 'surfaceCache', HIT_LIGHTING_MODES),
  flag('hardwareRayTracingHitLightingAllowed', true),
  flag('hardwareRayTracingHitLightingDirectLighting', true),
  choice('hardwareRayTracingHitLightingShadowMode', 'soft', HIT_LIGHTING_SHADOW_MODES),
  choice('hardwareRayTracingHitLightingSkylight', 'standalone', HIT_LIGHTING_SKYLIGHT_MODES),
  flag('hardwareRayTracingHitLightingReflectionCaptures', false),
  flag('hardwareRayTracingHitLightingForceOpaque', false),
  choice(
    'hardwareRayTracingHitLightingShadowTranslucencyMode',
    'masked',
    HIT_LIGHTING_TRANSLUCENCY_MODES,
  ),
  integer('reflectionMaxBounces', 1, [1, HIT_LIGHTING_MAX_BOUNCES]),
  flag('reflectionRayTracedTranslucentRefractions', true),
  integer('reflectionMaxRefractionBounces', 0, [0, HIT_LIGHTING_MAX_BOUNCES - 1]),
  integer('rayTracingLightGridResolution', 256, [1, LIGHT_GRID_MAX_RESOLUTION]),
  integer('rayTracingLightGridMaxCount', 128, [1, LIGHT_GRID_MAX_COUNT]),
  integer('rayTracingLightGridAxis', -1, [-1, 3]),
] as const satisfies readonly SettingRule[]

/** The fields of `HIT_LIGHTING_RULES`. */
export type HitLightingField = (typeof HIT_LIGHTING_RULES)[number]['field']

/** The values of the settings above, as the reflections' resolved values hold them. */
export interface HitLightingValues {
  reflectionHardwareRayTracingHitLighting: boolean
  reflectionHardwareRayTracingBucketMaterials: boolean
  hardwareRayTracingLightingMode: (typeof HIT_LIGHTING_MODES)[number]
  hardwareRayTracingHitLightingAllowed: boolean
  hardwareRayTracingHitLightingDirectLighting: boolean
  hardwareRayTracingHitLightingShadowMode: (typeof HIT_LIGHTING_SHADOW_MODES)[number]
  hardwareRayTracingHitLightingSkylight: (typeof HIT_LIGHTING_SKYLIGHT_MODES)[number]
  hardwareRayTracingHitLightingReflectionCaptures: boolean
  hardwareRayTracingHitLightingForceOpaque: boolean
  hardwareRayTracingHitLightingShadowTranslucencyMode: (typeof HIT_LIGHTING_TRANSLUCENCY_MODES)[number]
  reflectionMaxBounces: number
  reflectionRayTracedTranslucentRefractions: boolean
  reflectionMaxRefractionBounces: number
  rayTracingLightGridResolution: number
  rayTracingLightGridMaxCount: number
  rayTracingLightGridAxis: number
}

/** The light grid's settings: the cells a side, the most lights a cell keeps, and the axis the grid is built along (0 to 2 forces one, 3 picks the best cell by cell). */
export interface LightGridSettings {
  resolution: number
  maxCount: number
  axis: number
}

/** What the reflections' kernels read of the hit lighting. */
export interface HitLightingSettings {
  /** Whether the second pass runs (the scalability switch allowing it, then the lighting mode or the reflections' own setting). */
  on: boolean
  /** Whether every hit is lit again (a lighting mode other than the surface cache), not only the ones the cache could not light. */
  forced: boolean
  /** Whether the rays of the screen probes and of the radiance cache light their hits where they stand: the lighting mode is `'hitLighting'` (not `'hitLightingForReflections'`) and the scalability switch allows it. */
  probes: boolean
  /** Whether the traces of the second pass are sorted by material. */
  bucket: boolean
  direct: boolean
  /** 0 no shadow, 1 a ray to the light's centre, 2 a ray to a point of its source. */
  shadowMode: number
  /** Whether the sky light's irradiance is lit onto the hit in place of the surface cache's indirect light. */
  skylight: boolean
  captures: boolean
  forceOpaque: boolean
  /** 0 every shadow ray sees the surfaces opaque, 1 it cuts the masked ones, 2 it cuts the masked and the translucent ones. */
  translucencyMode: number
  /** The most reflection rays a path of the hit lighting has (1 to `HIT_LIGHTING_MAX_BOUNCES`). */
  bounces: number
  /** The refraction events a path goes through after the first: 0 passes the translucent surfaces by, as the hit lighting always did. */
  refractions: number
  /** The most vertices a path of the hit lighting holds: `bounces` for each of its `1 + refractions` stretches, which sizes its radiance buffer. */
  vertices: number
  /** The grid that culls the lights the hits are lit by. */
  lightGrid: LightGridSettings
}

/** The hit lighting of the reflections' values: the reference's gates (`GetHitLightingMode`, `UseHitLighting`) and the numbers its kernels read. */
export function hitLightingOf(values: HitLightingValues): HitLightingSettings {
  const allowed = values.hardwareRayTracingHitLightingAllowed
  const forced = allowed && values.hardwareRayTracingLightingMode !== 'surfaceCache'
  const skylight = values.hardwareRayTracingHitLightingSkylight
  // The path's refraction stretches, the first included, are at most `HIT_LIGHTING_MAX_BOUNCES`: the setting's bound.
  const refractions = values.reflectionRayTracedTranslucentRefractions
    ? values.reflectionMaxRefractionBounces
    : 0
  return {
    on: forced || (allowed && values.reflectionHardwareRayTracingHitLighting),
    forced,
    probes: allowed && values.hardwareRayTracingLightingMode === 'hitLighting',
    bucket: values.reflectionHardwareRayTracingBucketMaterials,
    direct: values.hardwareRayTracingHitLightingDirectLighting,
    shadowMode: HIT_LIGHTING_SHADOW_MODES.indexOf(values.hardwareRayTracingHitLightingShadowMode),
    skylight: skylight === 'on',
    captures: values.hardwareRayTracingHitLightingReflectionCaptures,
    forceOpaque: values.hardwareRayTracingHitLightingForceOpaque,
    translucencyMode: HIT_LIGHTING_TRANSLUCENCY_MODES.indexOf(
      values.hardwareRayTracingHitLightingShadowTranslucencyMode,
    ),
    bounces: values.reflectionMaxBounces,
    refractions,
    vertices: values.reflectionMaxBounces * (1 + refractions),
    lightGrid: {
      resolution: values.rayTracingLightGridResolution,
      maxCount: values.rayTracingLightGridMaxCount,
      // A negative axis is the automatic one: the builder takes any axis from 3 up as that.
      axis: values.rayTracingLightGridAxis < 0 ? 3 : values.rayTracingLightGridAxis,
    },
  }
}

/** Whether the hit lighting's passes run: it is on, and lights the hit by something that is not the surface cache's own final light (the direct lighting or the sky light — with neither, the reference reads that light as it stands). */
export const hitLightingRuns = (hit: HitLightingSettings) => hit.on && (hit.direct || hit.skylight)

/** Whether the passes that light the hits of the screen probes' and the radiance cache's rays run: the mode lights them, and it lights by something that is not the surface cache's own final light (as `hitLightingRuns`). */
export const hitLightingProbesRun = (hit: HitLightingSettings) =>
  hit.probes && (hit.direct || hit.skylight)
