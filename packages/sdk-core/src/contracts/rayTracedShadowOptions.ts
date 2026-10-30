import {
  flagSetting as flag,
  integerSetting as integer,
  INT32_MAX,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  rulesOf,
  type SettingValues,
} from './settingRules.ts'

/**
 * THE VIEW'S SETTINGS OF THE RAY-TRACED SHADOWS: a light's shadow found by casting a ray from each pixel to a point of the light
 * through the scene's triangles (`packages/sdk-browser/src/lighting/shadows/rayTraced/`) instead of reading the shadow maps. The scene's triangles come
 * from the ray-tracing file (`rayTracingFile`); a scene without them keeps every light's shadow maps.
 * Run-time settings, as `./settingRules.ts` says; the quality levels write none of them.
 *
 * - `rayTracedShadows` (off): the lights that follow the view's setting (`castRayTracedShadow` `'useProjectSetting'`, the default of a
 *   light) cast their shadow by rays;
 * - `rayTracedShadowsDirectionalLights`, `rayTracedShadowsPointLights`, `rayTracedShadowsSpotLights`, `rayTracedShadowsRectLights` (all
 *   on): which kinds of light cast ray-traced shadows at all, whatever a light or `rayTracedShadows` ask;
 * - `rayTracedShadowsSamplesPerPixel` (-1): the rays a pixel casts to each light; -1 leaves it to the light
 *   (`rayTracedShadowSamplesPerPixel`, 1 by default);
 * - `rayTracedShadowsNormalBias` (0.1 cm, at least 0.01): the most the ray's start is moved along the surface's normal, to leave the
 *   triangle it starts on;
 * - `rayTracedShadowsAvoidSelfIntersectionTraceDistance` (1 cm): the length of the first, short ray that leaves the pixel's own surface
 *   behind (it culls back faces); 0 casts no such ray;
 * - `rayTracedShadowsTwoSidedGeometry` (on): the geometry casts from both faces; off, back faces are passed;
 * - `rayTracedShadowsAcceptFirstHit` (on): a shadow ray ends at the first primitive it meets, not the nearest;
 * - `rayTracedShadowsLODTransitionStart` (4000 cm) and `rayTracedShadowsLODTransitionEnd` (5000 cm): the distance from the eye, in
 *   centimetres, where the shadow of a subsurface or hair pixel starts to take the light's transmission through it in place of its occlusion,
 *   and where it takes only that;
 * - `rayTracedShadowsDirectionalLightTraceDistance` (10000 cm, from 1000 to 1000000): how far from a pixel a directional light's ray goes
 *   back toward it, to measure the thickness of a subsurface or hair pixel;
 * - `rayTracedShadowsDenoiser` (on): a light with a size has its ray-traced shadow denoised, the penumbra found from the distance to
 *   the nearest occluder (the shadow denoiser: reconstruction, pre-convolution, temporal accumulation); off keeps the raw rays;
 * - `rayTracedShadowsDenoiserReconstructionSamples` (8, from 1 to 56): the most samples of the denoiser's reconstruction;
 * - `rayTracedShadowsDenoiserPreConvolution` (1, from 0 to 4): the pre-convolution passes after the reconstruction;
 * - `rayTracedShadowsDenoiserTemporalAccumulation` (on): the denoised shadow is accumulated over the images;
 * - `rayTracedShadowsDenoiserHistoryConvolutionSamples` (1, from 1 to 56): the samples of the convolution of the accumulated history; 1 runs none.
 */
export const RAY_TRACED_SHADOW_RULES = /* @__PURE__ */ (() =>
  [
    flag('rayTracedShadows', false),
    flag('rayTracedShadowsDirectionalLights', true),
    flag('rayTracedShadowsPointLights', true),
    flag('rayTracedShadowsSpotLights', true),
    flag('rayTracedShadowsRectLights', true),
    integer('rayTracedShadowsSamplesPerPixel', -1, [-1, INT32_MAX]),
    nonNegative('rayTracedShadowsNormalBias', 0.1),
    nonNegative('rayTracedShadowsAvoidSelfIntersectionTraceDistance', 1),
    flag('rayTracedShadowsTwoSidedGeometry', true),
    flag('rayTracedShadowsAcceptFirstHit', true),
    nonNegative('rayTracedShadowsLODTransitionStart', 4000),
    nonNegative('rayTracedShadowsLODTransitionEnd', 5000),
    number('rayTracedShadowsDirectionalLightTraceDistance', 10000, [1000, 1000000]),
    flag('rayTracedShadowsDenoiser', true),
    integer('rayTracedShadowsDenoiserReconstructionSamples', 8, [1, 56]),
    integer('rayTracedShadowsDenoiserPreConvolution', 1, [0, 4]),
    flag('rayTracedShadowsDenoiserTemporalAccumulation', true),
    integer('rayTracedShadowsDenoiserHistoryConvolutionSamples', 1, [1, 56]),
  ] as const)()

/** The same rules by their field. */
export const RAY_TRACED_SHADOW_VIEW_RULES = /* @__PURE__ */ rulesOf(RAY_TRACED_SHADOW_RULES)
/** The field of one ray-traced shadow setting of the view. */
export type RayTracedShadowField = (typeof RAY_TRACED_SHADOW_RULES)[number]['field']
/** The ray-traced shadow settings of the view, every field set. */
export type RayTracedShadowSettings = SettingValues<typeof RAY_TRACED_SHADOW_VIEW_RULES>

/** What a light asks of the ray-traced shadows: none, the view's setting, or always (`castRayTracedShadow`). */
export const CAST_RAY_TRACED_SHADOW_CHOICES = ['disabled', 'useProjectSetting', 'enabled'] as const
export type CastRayTracedShadow = (typeof CAST_RAY_TRACED_SHADOW_CHOICES)[number]

/** The kinds of light the view's switches name. */
export type RayTracedShadowLightKind = 'directional' | 'point' | 'spot' | 'rect'

/** Whether a light of `kind` that asks `cast` casts its shadow by rays under `settings`: its kind is allowed, then
 *  `'enabled'` always, `'useProjectSetting'` where the view's `rayTracedShadows` is on, `'disabled'` never. */
export function lightRayTraced(
  settings: Pick<
    RayTracedShadowSettings,
    | 'rayTracedShadows'
    | 'rayTracedShadowsDirectionalLights'
    | 'rayTracedShadowsPointLights'
    | 'rayTracedShadowsSpotLights'
    | 'rayTracedShadowsRectLights'
  >,
  kind: RayTracedShadowLightKind,
  cast: CastRayTracedShadow,
) {
  const allowed = {
    directional: settings.rayTracedShadowsDirectionalLights,
    point: settings.rayTracedShadowsPointLights,
    spot: settings.rayTracedShadowsSpotLights,
    rect: settings.rayTracedShadowsRectLights,
  }[kind]
  return (
    allowed && (cast === 'enabled' || (cast === 'useProjectSetting' && settings.rayTracedShadows))
  )
}
