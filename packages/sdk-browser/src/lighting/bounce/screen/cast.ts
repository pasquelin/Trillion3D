import { castsProbes } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import {
  readScreenProbeSetting,
  searchesOcclusion,
  type ScreenProbeSettings,
} from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { wantsContractLighting } from '../../../frame/prepare/lit.ts'
import { drawsLit } from '../../../visibility/shader/shadeMode.ts'

/** Whether the level draws anything: a level that casts probes does, `'low'` where its short-range occlusion is searched. */
function levelDraws(rt: WebgpuPagesRuntime) {
  const level = readScreenProbeSetting(rt, 'screenProbes')
  return (
    castsProbes(level) ||
    (level === 'low' &&
      searchesOcclusion(
        readScreenProbeSetting(rt, 'screenProbeShortRangeOcclusion'),
        readScreenProbeSetting(rt, 'screenProbeOcclusionIntensity'),
      ))
  )
}

/**
 * Whether the screen probes' pass runs this image: the bounce asked, the indirect light lit by declared lamps, a view of the
 * lit image (not a raw diagnostic one), and a level that draws (`levelDraws`). The one reading of that rule: the velocity stage
 * reads the vectors by it, the probes' own pass asks its
 * kernels by it and gives its resources back where it is false.
 */
export const screenProbesCast = (rt: WebgpuPagesRuntime) =>
  rt.bounce.wanted && wantsContractLighting(rt) && drawsLit(rt.run.diagnostic) && levelDraws(rt)

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
