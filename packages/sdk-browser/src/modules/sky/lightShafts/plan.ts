import type { SkyQualityValues } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import type { LightShaftLight } from '../../../../../sdk-core/src/modules/sky/lightShafts.ts'
import type { Size } from '../clouds/reconstructLayout.ts'
import type { LightShaftPass, LightShaftTechnique } from './describe.ts'
import { LIGHT_SHAFT_MASK_FORMAT, lightShaftPassSizes, type LightShaftOrigin } from './layout.ts'

/**
 * THE LIGHT SHAFTS' PLAN: the order a frame runs the passes of `describe.ts` in, one chain for each
 * light and technique. Nothing here touches the GPU.
 */

/** A step of a chain. */
export type LightShaftStep =
  | {
      readonly kind: 'pass'
      readonly pass: LightShaftPass
      /** The blur pass's rank, from 0. */
      readonly index: number
    }
  | {
      /** The shafts' image filtered over time with the history `history` names: the occlusion's is
       *  the view's, a bloom's is its light's. */
      readonly kind: 'temporal'
      readonly history: 'occlusion' | number
    }

/** One light's chain, in the order its steps run. */
export interface LightShaftChain {
  readonly technique: LightShaftTechnique
  /** The light's rank among the `lights` the plan was made from. */
  readonly light: number
  readonly steps: readonly LightShaftStep[]
}

/** A light as the plan is made from it: a directional light's settings, and where its shafts' light
 *  stands in the view (`lightShaftOrigin`). */
export interface LightShaftLightInput {
  readonly settings: LightShaftLight
  readonly origin: LightShaftOrigin
}

/** What the plan is made from. */
export interface LightShaftPlanInput {
  /** The sky's quality settings: the switch, the reduction, the temporal filter and the blur passes. */
  readonly quality: Pick<
    SkyQualityValues,
    'lightShafts' | 'lightShaftDownsample' | 'lightShaftTemporalFilter' | 'lightShaftBlurPasses'
  >
  /** The target the lit image is allocated at, and the view's pixels. */
  readonly allocated: Size
  readonly view: Size
  /** The directional lights, in the order the renderer meets them. */
  readonly lights: readonly LightShaftLightInput[]
  /** Whether the view's anti-aliasing is temporal and keeps its history. */
  readonly temporal: boolean
}

/**
 * The frame's light shafts: nothing when they are off; else, for each directional light in front of
 * the eye (`origin.w` above 0), an occlusion chain if it occludes, in `occlusion`, and a bloom
 * chain if it blooms, in `bloom`. `maskTarget` is the one texture every occlusion chain ends in
 * (`LIGHT_SHAFT_MASK_FORMAT`), none when no chain runs. Each chain's steps are: the reduction, the
 * temporal filter when it applies, one blur pass per `lightShaftBlurPasses`, then the end.
 */
export function planLightShafts(input: LightShaftPlanInput) {
  const { quality, lights } = input
  const sizes = lightShaftPassSizes(input.allocated, input.view, quality.lightShaftDownsample)
  const occlusion: LightShaftChain[] = [],
    bloom: LightShaftChain[] = []
  const chain = (technique: LightShaftTechnique, light: number): LightShaftChain => {
    const steps: LightShaftStep[] = [{ kind: 'pass', pass: technique, index: 0 }]
    if (input.temporal && quality.lightShaftTemporalFilter) {
      steps.push({ kind: 'temporal', history: technique === 'occlusion' ? 'occlusion' : light })
    }
    for (let index = 0; index < quality.lightShaftBlurPasses; index++) {
      steps.push({ kind: 'pass', pass: 'blur', index })
    }
    steps.push({ kind: 'pass', pass: technique === 'occlusion' ? 'finish' : 'apply', index: 0 })
    return { technique, light, steps }
  }
  if (quality.lightShafts)
    lights.forEach(({ settings, origin }, light) => {
      if (origin.w <= 0) return
      if (settings.shaftOcclusion) occlusion.push(chain('occlusion', light))
      if (settings.shaftBloom) bloom.push(chain('bloom', light))
    })
  return {
    sizes,
    occlusion,
    bloom,
    maskTarget: occlusion.length ? { format: LIGHT_SHAFT_MASK_FORMAT, size: sizes.shaft } : null,
  }
}
