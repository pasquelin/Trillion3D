import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import { BLEND_MODES } from '../../scene/materialBlending.ts'
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { displayMaskLayout, MASK_FORMAT } from './displayFilter.ts'
import { displayRoute, filtersDisplay } from './equations.ts'
import { pipelinesByMode, stageDescriptors } from './stagePipelines.ts'
import { cullOf, modeOf } from './planCull.ts'
import { feedbackConstants } from '../tile/requestWgsl.ts'

/**
 * The blend pass's pipelines in an image with display layers (`displayFilter.ts`): each mode's
 * `fsFiltered`, which reads the mask and routes by `DISPLAY_ROUTE`, and the mask pass's, which
 * draws the filtering modes' coverage alone — `fs` at its default route writes 1 as tint, and the
 * mask is the one target, at the tint's slot. Compiled only when a plan holds a filtering mode.
 */
export function createRoutedPipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  feedback: boolean,
  targets: (mode: Blending) => (GPUColorTargetState | null)[],
) {
  const constants = feedbackConstants(feedback)
  const filtered = pipelinesByMode(device, (mode) =>
    stageDescriptors(
      device,
      module,
      layout,
      {
        module,
        entryPoint: 'fsFiltered',
        targets: targets(mode),
        constants: { ...constants, DISPLAY_ROUTE: displayRoute(mode) },
      },
      false,
      displayMaskLayout(device),
    ),
  )
  // The tint's slot: the request's location stays, its target left empty without the feedback.
  const slot = 3
  const culls = stageDescriptors(
    device,
    module,
    layout,
    {
      module,
      entryPoint: 'fs',
      constants,
      targets: [...Array(slot).fill(null), { format: MASK_FORMAT }],
    },
    false,
  ).map((stage) => preparedPipeline(device, stage))
  return {
    filtered,
    mask: {
      slot,
      at: (rank: number) => culls[cullOf(rank)].get(),
      skips: (rank: number) => !filtersDisplay(BLEND_MODES[modeOf(rank)]),
    },
    async precompile(modes: readonly Blending[]) {
      await Promise.all([filtered.precompile(modes), ...culls.map((cull) => cull.prepare())])
    },
  }
}
