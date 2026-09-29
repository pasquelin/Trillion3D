import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import { BLEND_MODES } from '../../scene/materialBlending.ts';
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts';
import { displayMaskLayout, MASK_FORMAT } from './displayFilter.ts';
import { displayRoute, filtersDisplay } from './equations.ts';
import { pipelinesByMode, stageDescriptors } from './stagePipelines.ts';

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
  const suffix = feedback ? '' : 'WithoutFeedback';
  const filtered = pipelinesByMode(device, (mode) =>
    stageDescriptors(
      device,
      module,
      layout,
      {
        module,
        entryPoint: `fsFiltered${suffix}`,
        targets: targets(mode),
        constants: { DISPLAY_ROUTE: displayRoute(mode) },
      },
      false,
      displayMaskLayout(device),
    ),
  );
  const slot = feedback ? 3 : 2;
  const culls = stageDescriptors(
    device,
    module,
    layout,
    {
      module,
      entryPoint: `fs${suffix}`,
      targets: [...Array(slot).fill(null), { format: MASK_FORMAT }],
    },
    false,
  ).map((stage) => preparedPipeline(device, stage));
  return {
    filtered,
    mask: {
      slot,
      at: (rank: number) => culls[rank % 3].get(),
      skips: (rank: number) => !filtersDisplay(BLEND_MODES[Math.floor(rank / 3)]),
    },
    async precompile(modes: readonly Blending[]) {
      await Promise.all([filtered.precompile(modes), ...culls.map((cull) => cull.prepare())]);
    },
  };
}
