import { castsProbes } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import {
  readScreenProbeSetting,
  type ScreenProbeSettings,
} from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { SCREEN_SPACE_TRACING_RULES } from '../../../../../sdk-core/src/contracts/screenSpaceTracingOptions.ts'
import {
  resolveSettings,
  resolveSettingsStamped,
} from '../../../../../sdk-core/src/contracts/settingRules.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { wantsContractLighting } from '../../../frame/prepare/lit.ts'
import { drawsLit } from '../../../visibility/shader/shadeMode.ts'

/** Whether the level draws anything: a level that casts probes does. */
const levelDraws = (rt: WebgpuPagesRuntime) =>
  castsProbes(readScreenProbeSetting(rt, 'screenProbes'))

/** The screen-space tracing's settings, read by the stamped reader into this one object. */
const tracing = resolveSettings(SCREEN_SPACE_TRACING_RULES, {})

/** What gathers the pixels' indirect light: the screen probes (the default), the irradiance field (`finalGatherMethod`) or the screen's own indirect light (`globalIlluminationMethod`). */
export type IndirectSource = 'probes' | 'field' | 'screen'

/**
 * The one reading of what gathers the opaque pixels' indirect light this image: the screen's own light where the global illumination method says so and its level is above 0 (it replaces
 * the radiance cache's whole gather, as the reference's global illumination method does), else the irradiance field where the final gather method says so and the level casts, else the screen probes. The
 * rules of the other two read it, so that one source alone writes the lighting's words (`writeIndirectWords`).
 */
export function indirectSourceOf(rt: WebgpuPagesRuntime): IndirectSource {
  resolveSettingsStamped(SCREEN_SPACE_TRACING_RULES, rt.context, tracing)
  if (tracing.globalIlluminationMethod === 'screen' && tracing.screenGiLevel > 0) return 'screen'
  return readScreenProbeSetting(rt, 'finalGatherMethod') === 'irradianceField' &&
    castsProbes(readScreenProbeSetting(rt, 'screenProbes'))
    ? 'field'
    : 'probes'
}

/**
 * Whether the bounce lights this image's pixels, by whatever gathers them (`indirectSourceOf`): the bounce asked, the indirect light lit by declared lamps, a view of the lit image (not a raw
 * diagnostic one), and a level that draws (`levelDraws`). The rule of what does not depend on the final gather: the vectors the velocity stage draws and the translucency volume are made by it, as the reference's
 * are whichever method gathers the opaque surfaces' light.
 */
export const bounceLitImage = (rt: WebgpuPagesRuntime) =>
  rt.bounce.wanted && wantsContractLighting(rt) && drawsLit(rt.run.diagnostic) && levelDraws(rt)

/**
 * Whether the screen probes' pass runs this image: the bounce lights the image (`bounceLitImage`) and its pixels are gathered by the probes (`indirectSourceOf`). The one reading of that rule: the probes' own pass asks its
 * kernels by it and gives its resources back where it is false.
 */
export const screenProbesCast = (rt: WebgpuPagesRuntime) =>
  bounceLitImage(rt) && indirectSourceOf(rt) === 'probes'

/**
 * Whether the bounce lights this image while the screen probes are switched off (`screenProbes` `'off'`): the reference's indirect light is then black, never the sky light's
 * irradiance (`ScreenProbeGather.cpp:2194-2201`, `r.ScreenProbeGather 0`: black diffuse and rough specular, handed to a diffuse global illumination that has taken the place of the
 * sky light's). A view with no bounce keeps the sky light, as one with no global illumination does.
 */
export const screenProbesCut = (rt: WebgpuPagesRuntime) =>
  rt.bounce.wanted &&
  wantsContractLighting(rt) &&
  drawsLit(rt.run.diagnostic) &&
  indirectSourceOf(rt) === 'probes' &&
  readScreenProbeSetting(rt, 'screenProbes') === 'off'

/** Whether the probes of a level that casts them cast the rays the screen left through the scene's triangles: the scene traces and
 *  `screenProbeHardwareRayTracing` on. The one reading of the rule, from the settings of an image or from the runtime's. */
export const castsThroughTriangles = (
  values: Pick<
    ScreenProbeSettings['values'],
    'screenProbeSceneTraces' | 'screenProbeHardwareRayTracing'
  >,
) => values.screenProbeSceneTraces && values.screenProbeHardwareRayTracing

/**
 * Whether the screen probes of this image may cast the rays the screen left through the scene's triangles (`castsThroughTriangles`): the
 * image casts probes. The scene trace is the surface cache lighting's, which keeps it for them
 * (`sceneRaysOf`) as it does for the radiance cache (`../cache/cacheFrame.ts`).
 */
export const screenProbesTraced = (rt: WebgpuPagesRuntime) =>
  screenProbesCast(rt) &&
  castsProbes(readScreenProbeSetting(rt, 'screenProbes')) &&
  castsThroughTriangles({
    screenProbeSceneTraces: readScreenProbeSetting(rt, 'screenProbeSceneTraces'),
    screenProbeHardwareRayTracing: readScreenProbeSetting(rt, 'screenProbeHardwareRayTracing'),
  })
