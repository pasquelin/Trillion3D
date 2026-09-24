import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { buildRenderPipeline } from '../../lighting/deferred/program.ts';
import { BLEND_EQUATIONS } from '../../scene/materialBlending.ts';

/** Source alpha over what the target holds: the normal mode, and the blend of the water surfaces
 *  and of their composite over the frozen backdrop. */
export const ALPHA_BLEND: GPUBlendState = BLEND_EQUATIONS.normal!;

/** The three pipelines a plan entry picks by rank (`plan.ts`): none, front, back. */
export type BlendPipelines = readonly [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline];

/** The blend pass's pipelines by plan rank — mode rank × 3 + cull rank (`plan.ts`); a mode no
 *  item declared when they were built has none. */
export type BlendModePipelines = readonly (GPURenderPipeline | undefined)[];

/**
 * The three cull modes of one fragment stage of the blend module, on the blend bind group layout:
 * the forward blend, which writes no depth, and the water surface stage, which writes it so the
 * nearest surface of a pixel is the one composed. Same vertex stage, same rank picks the same side.
 */
export function blendStagePipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  fragment: GPUFragmentState,
  depthWrite: boolean,
): Promise<BlendPipelines> {
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const make = (cullMode: GPUCullMode) =>
    buildRenderPipeline(device, {
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'vs' },
      fragment,
      primitive: { topology: 'triangle-list', cullMode, frontFace: 'ccw' },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: depthWrite,
        depthCompare: DEPTH_COMPARE,
      },
    });
  return Promise.all([make('none'), make('front'), make('back')]);
}
