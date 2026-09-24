import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { buildRenderPipeline } from '../../lighting/deferred/program.ts';
import { BLEND_EQUATIONS, BLEND_MODES } from '../../scene/materialBlending.ts';
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';

/** Source alpha over what the target holds: the normal mode, and the blend of the water surfaces
 *  and of their composite over the frozen backdrop. */
export const ALPHA_BLEND: GPUBlendState = BLEND_EQUATIONS.normal!;

/** The three pipelines a plan entry picks by rank (`plan.ts`): none, front, back. */
export type BlendPipelines = readonly [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline];

/** Pipelines a transparent pass picks by plan rank (`draw.ts`): the water surfaces' three, or the
 *  blend pass's modes. */
export type RankedPipelines = { at(rank: number): GPURenderPipeline | undefined };

/** What a transparent pass compiles per blending mode, kept by mode rank (`BLEND_MODES`): `byMode`
 *  holds those compiled so far; `at` compiles a mode not compiled up front on the first draw that
 *  asks for it, once, so a blending written later draws in its own mode at once. */
export interface ModePipelines<T> {
  readonly byMode: (T | undefined)[];
  at(mode: Blending): T;
}

/** The one lazy set of both transparent paths: the blend pass's three culls per mode, the fallback
 *  pass's one pipeline per mode (`pages/prepare/pipelines.ts`). */
export function pipelinesByMode<T>(build: (mode: Blending) => T): ModePipelines<T> {
  const byMode: (T | undefined)[] = [];
  return { byMode, at: (mode) => (byMode[BLEND_MODES.indexOf(mode)] ??= build(mode)) };
}

/** The blend pass's pipelines by plan rank — mode rank × 3 + cull rank (`plan.ts`), read from its
 *  `ModePipelines`, whose `byMode` holds the three culls of each mode compiled so far. */
export interface BlendModePipelines extends RankedPipelines {
  readonly byMode: readonly (BlendPipelines | undefined)[];
  at(rank: number): GPURenderPipeline;
}

/**
 * The three cull modes of one fragment stage of the blend module, on the blend bind group layout:
 * the forward blend, which writes no depth, and the water surface stage, which writes it so the
 * nearest surface of a pixel is the one composed. Same vertex stage, same rank picks the same side.
 */
export async function blendStagePipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  fragment: GPUFragmentState,
  depthWrite: boolean,
): Promise<BlendPipelines> {
  const stages = stageDescriptors(device, module, layout, fragment, depthWrite);
  const [none, front, back] = await Promise.all(
    stages.map((stage) => buildRenderPipeline(device, stage)),
  );
  return [none, front, back];
}

/** The same three, compiled at once: for a mode first asked for by a draw (`BlendModePipelines`). */
export function blendStagePipelinesNow(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  fragment: GPUFragmentState,
  depthWrite: boolean,
): BlendPipelines {
  const stages = stageDescriptors(device, module, layout, fragment, depthWrite);
  const [none, front, back] = stages.map((stage) => device.createRenderPipeline(stage));
  return [none, front, back];
}

const CULL_MODES: readonly GPUCullMode[] = ['none', 'front', 'back'];

function stageDescriptors(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  fragment: GPUFragmentState,
  depthWrite: boolean,
): GPURenderPipelineDescriptor[] {
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  return CULL_MODES.map((cullMode) => ({
    layout: pipelineLayout,
    vertex: { module, entryPoint: 'vs' },
    fragment,
    primitive: { topology: 'triangle-list', cullMode, frontFace: 'ccw' },
    depthStencil: {
      format: 'depth32float',
      depthWriteEnabled: depthWrite,
      depthCompare: DEPTH_COMPARE,
    },
  }));
}
