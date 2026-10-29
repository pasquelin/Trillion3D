import type { Blending } from '../../../sdk-core/src/world/constants/index.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { displayMaskLayout, MASK_FORMAT } from './display/displayFilter.ts'
import { displayRoute, filtersDisplay } from './equations.ts'
import {
  pipelinesByVariant,
  reflectedGroups,
  stageDescriptors,
  type FilteredProgram,
} from './stagePipelines.ts'
import {
  blendingOf,
  cullOf,
  lightingOf,
  variantBlending,
  variantLighting,
} from './plan/planCull.ts'
import {
  BLEND_LIGHTINGS,
  LIGHTING_RANK,
  blendLightingConstant,
} from '../materials/surface/blendLightSource.ts'
import { blendModeConstant } from '../materials/surface/materialBlending.ts'
import { feedbackConstants } from '../materials/virtual/requestWgsl.ts'

/**
 * The blend pass's pipelines in an image with display layers (`display/displayFilter.ts`): each variant's
 * `fsFiltered`, which reads the mask and routes by `DISPLAY_ROUTE`, and the mask pass's, which
 * draws the filtering modes' coverage alone — `fs` at its default route writes 1 as tint, and the
 * mask is the one target, at the tint's slot — in the lighting program of each layer. Compiled only when a plan holds a filtering mode.
 */
export function createRoutedPipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  display: FilteredProgram,
  feedback: boolean,
  targets: (mode: Blending) => (GPUColorTargetState | null)[],
) {
  const constants = feedbackConstants(feedback)
  const filtered = pipelinesByVariant(device, (variant) => {
    const mode = variantBlending(variant)!
    const filteredModule = display.module()
    return stageDescriptors(
      device,
      filteredModule,
      display.layout,
      {
        module: filteredModule,
        entryPoint: 'fsFiltered',
        targets: targets(mode),
        constants: {
          ...constants,
          DISPLAY_ROUTE: displayRoute(mode),
          ...blendModeConstant(mode),
          ...blendLightingConstant(variantLighting(variant)),
        },
      },
      false,
      reflectedGroups(device, displayMaskLayout(device)),
    )
  })
  // The tint's slot: the request's location stays, its target left empty without the feedback.
  const slot = 3
  const culls = BLEND_LIGHTINGS.map((lighting) =>
    stageDescriptors(
      device,
      module,
      layout,
      {
        module,
        entryPoint: 'fs',
        constants: { ...constants, ...blendLightingConstant(lighting) },
        targets: [...Array(slot).fill(null), { format: MASK_FORMAT }],
      },
      false,
      reflectedGroups(device),
    ).map((stage) => preparedPipeline(device, stage)),
  )
  /** The lighting programs whose mask pass the filtering modes among `variants` draw. */
  const maskedLightings = (variants: readonly number[]) =>
    new Set(
      variants.filter((variant) => filtersDisplay(variantBlending(variant)!)).map(variantLighting),
    )
  return {
    filtered,
    mask: {
      slot,
      at: (rank: number) => culls[LIGHTING_RANK[lightingOf(rank)]][cullOf(rank)].get(),
      skips: (rank: number) => {
        const mode = blendingOf(rank)
        return !mode || !filtersDisplay(mode)
      },
    },
    ask(variants: readonly number[]) {
      filtered.ask(variants)
      for (const lighting of maskedLightings(variants))
        for (const cull of culls[LIGHTING_RANK[lighting]]) cull.ask()
    },
    async precompile(variants: readonly number[]) {
      const masked = maskedLightings(variants)
      await Promise.all([
        filtered.precompile(variants),
        ...[...masked].flatMap((lighting) =>
          culls[LIGHTING_RANK[lighting]].map((cull) => cull.prepare()),
        ),
      ])
    },
  }
}
