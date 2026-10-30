import { feedbackConstants } from '../../materials/virtual/requestWgsl.ts'
import { blendLightingConstant } from '../../materials/surface/blendLightSource.ts'
import { blendModeConstant } from '../../materials/surface/materialBlending.ts'
import { reflectionForwardLayout } from '../../lighting/reflections/reflectionPipelines.ts'
import { FEEDBACK_FORMAT } from '../../scene/targetFormats.ts'
import {
  blendingOf,
  cullOf,
  transmitsRank,
  variantBlending,
  variantLighting,
  variantOf,
  waterRank,
} from '../plan/planCull.ts'
import { pipelinesByVariant, stageDescriptors, type RankedPipelines } from '../stagePipelines.ts'
import { oitLayouts } from './oitResources.ts'

/** Whether a plan rank draws a layer of a mode the pixels sort: a blend of mode `normal` or `additive`, not a transmissive layer nor the water. */
export const oitRank = (rank: number) => {
  if (transmitsRank(rank) || waterRank(rank)) return false
  const mode = blendingOf(rank)
  return mode === 'normal' || mode === 'additive'
}

/**
 * The sorted pass's pipelines: the stage that collects (`at`, `collects` the same as the set of ranks the pass draws alone) and, for each set of
 * blends, the same set without the ranks the stage draws (`apart`): the pass that blends leaves them to the pass that collects. A rank the stage has no
 * compiled pipeline for stays blended.
 */
export interface OitPipelines extends RankedPipelines {
  readonly collects: RankedPipelines
  apart(set: RankedPipelines): RankedPipelines
}

/** The sorted pass's pipelines from what compiles each rank (`at`, `undefined` where the stage has none yet). */
export function oitPipelineSet(at: RankedPipelines['at']): OitPipelines {
  const apart = new WeakMap<RankedPipelines, RankedPipelines>()
  return {
    at,
    collects: { at, skips: (rank) => !at(rank) },
    apart(set) {
      let made = apart.get(set)
      if (!made)
        apart.set(set, (made = { at: set.at, skips: (rank) => !!set.skips?.(rank) || !!at(rank) }))
      return made
    },
  }
}

/**
 * The stage that collects the layers of the modes the pixels sort (`oitWgsl.ts`), the pipelines of the blend module by variant and cull, made
 * at their first ask: the group after the blend's and the reflection's is the buffer. Its only target is the virtual textures' request
 * where `feedback` writes it: the translucency target is not attached, the pass writes none of it. A rank it has no
 * pipeline for yet, or that is not one of the modes it sorts, is `undefined`: the pass that blends draws it.
 */
export function createOitPipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  feedback: boolean,
  foldedDepth = false,
): OitPipelines {
  const set = pipelinesByVariant(device, (variant) => {
    const mode = variantBlending(variant)
    if (mode !== 'normal' && mode !== 'additive') return []
    return stageDescriptors(
      device,
      module,
      layout,
      {
        module,
        entryPoint: 'fsBlendOit',
        constants: {
          ...feedbackConstants(feedback),
          ...blendModeConstant(mode),
          ...blendLightingConstant(variantLighting(variant)),
        },
        targets: [null, feedback ? { format: FEEDBACK_FORMAT } : null],
      },
      false,
      [
        reflectionForwardLayout(device),
        foldedDepth ? oitLayouts(device).foldedCollect : oitLayouts(device).collect,
      ],
    )
  })
  return oitPipelineSet((rank) =>
    oitRank(rank) ? set.at(variantOf(rank), cullOf(rank)) : undefined,
  )
}
