import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import { BLEND_MODES } from '../../scene/materialBlending.ts';
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts';
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
  targets: (mode: Blending) => GPUColorTargetState[],
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
  const maskStages = () =>
    stageDescriptors(
      device,
      module,
      layout,
      {
        module,
        entryPoint: `fs${suffix}`,
        targets: [...Array(slot).fill(null), { format: MASK_FORMAT }],
      },
      false,
    );
  let culls: GPURenderPipeline[] | undefined;
  const modeOf = (rank: number) => BLEND_MODES[Math.floor(rank / 3)];
  return {
    filtered,
    mask: {
      slot,
      at: (rank: number) =>
        (culls ??= maskStages().map((stage) => device.createRenderPipeline(stage)))[rank % 3],
      skips: (rank: number) => !filtersDisplay(modeOf(rank)),
    },
    async precompile(modes: readonly Blending[]) {
      const [, made] = await Promise.all([
        filtered.precompile(modes),
        Promise.all(maskStages().map((stage) => buildRenderPipeline(device, stage))),
      ]);
      culls ??= made;
    },
  };
}
