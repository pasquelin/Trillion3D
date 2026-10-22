import { castsProbes } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import {
  SCREEN_PROBE_RULES,
  searchesOcclusion,
} from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { contextReader } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { wantsContractLighting } from '../../../frame/prepare/contractLight.ts'
import { drawsLit } from '../../../visibility/shader/shadeMode.ts'

/** The screen probes' settings the session holds (`screenProbeOptions.ts`), read at each image. */
export const screenProbeSetting = contextReader(SCREEN_PROBE_RULES)

/** Whether the level draws anything: a level that casts probes does, `'low'` where its short-range occlusion is searched. */
function levelDraws(rt: WebgpuPagesRuntime) {
  const level = screenProbeSetting(rt, 'screenProbes')
  return (
    castsProbes(level) ||
    (level === 'low' &&
      searchesOcclusion(
        screenProbeSetting(rt, 'screenProbeShortRangeOcclusion'),
        screenProbeSetting(rt, 'screenProbeOcclusionIntensity'),
      ))
  )
}

/**
 * Whether the screen probes' pass runs this image: the bounce asked, the indirect light lit by declared lamps, a view of the
 * lit image (not a raw diagnostic one), and a level that draws (`levelDraws`). The one reading of that rule: the velocity stage
 * reads the vectors by it, the occlusion draws where it is false (`ambientOcclusionMode`), the probes' own pass asks its
 * kernels by it and gives its resources back where it is false.
 */
export const screenProbesCast = (rt: WebgpuPagesRuntime) =>
  rt.bounce.wanted && wantsContractLighting(rt) && drawsLit(rt.run.diagnostic) && levelDraws(rt)
