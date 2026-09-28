import { reflectionLayout } from '../../reflections/gpu.ts';
import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts';
import { BLEND_EQUATIONS, BLEND_MODES } from '../../scene/materialBlending.ts';
import { refreshSurface } from '../../page/surface.ts';
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import type { BlendGpuItem } from './state.ts';

/** Source alpha over what the target holds: the normal mode, and the blend of the water surfaces
 *  and of their composite over the frozen backdrop. */
export const ALPHA_BLEND: GPUBlendState = BLEND_EQUATIONS.normal!;

/** The three pipelines a plan entry picks by rank (`plan.ts`): none, front, back. */
export type BlendPipelines = readonly [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline];

/** Pipelines a transparent pass picks by plan rank (`draw.ts`): the water surfaces' three, or the
 *  blend pass's modes, `filtered` in an image with a display filter (`displayFilter.ts`). */
export type RankedPipelines = {
  at(rank: number, filtered?: boolean): GPURenderPipeline | undefined;
};

/** What a transparent pass compiles per blending mode, kept by mode rank (`BLEND_MODES`): `byMode`
 *  holds those compiled so far; `precompile` compiles modes off the frame, and `at` compiles a mode
 *  not compiled up front on the first draw that asks for it, once, so a blending written later
 *  draws in its own mode at once. */
export interface ModePipelines {
  readonly byMode: (readonly GPURenderPipeline[] | undefined)[];
  at(mode: Blending): readonly GPURenderPipeline[];
  precompile(modes: readonly Blending[]): Promise<void>;
}

/** The one lazy set of both transparent paths: the blend pass's three culls per mode, the fallback
 *  pass's one pipeline per mode (`pages/prepare/pipelines.ts`). `describe` gives a mode's
 *  descriptors once: a draw compiles them at once, `precompile` without blocking the thread, and a
 *  draw that came first keeps its own. */
export function pipelinesByMode(
  device: GPUDevice,
  describe: (mode: Blending) => readonly GPURenderPipelineDescriptor[],
): ModePipelines {
  const byMode: (readonly GPURenderPipeline[] | undefined)[] = [];
  return {
    byMode,
    at: (mode) =>
      (byMode[BLEND_MODES.indexOf(mode)] ??= describe(mode).map((descriptor) =>
        device.createRenderPipeline(descriptor),
      )),
    async precompile(modes) {
      const missing = modes.filter((mode) => !byMode[BLEND_MODES.indexOf(mode)]);
      const built = await Promise.all(
        missing.map((mode) =>
          Promise.all(describe(mode).map((descriptor) => buildRenderPipeline(device, descriptor))),
        ),
      );
      missing.forEach((mode, at) => (byMode[BLEND_MODES.indexOf(mode)] ??= built[at]));
    },
  };
}

/** Normal always — a transmissive item draws in it —, then every mode a blend item declares: what
 *  both transparent paths compile up front. A scene of plain glass compiles normal alone. */
export const declaredBlendModes = (items: readonly BlendGpuItem[]) =>
  BLEND_MODES.filter(
    (mode, rank) =>
      !rank ||
      items.some((item) => !item.transmissive && refreshSurface(item.surface).blending === mode),
  );

/** The blend pass's pipelines by plan rank — mode rank × 3 + cull rank (`plan.ts`), read from its
 *  `ModePipelines`, whose `byMode` holds the three culls of each mode compiled so far. */
export interface BlendModePipelines extends RankedPipelines {
  readonly byMode: readonly (readonly GPURenderPipeline[] | undefined)[];
  at(rank: number, filtered?: boolean): GPURenderPipeline;
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
  const [none, front, back] = await Promise.all(
    stageDescriptors(device, module, layout, fragment, depthWrite).map((stage) =>
      buildRenderPipeline(device, stage),
    ),
  );
  return [none, front, back];
}

const CULL_MODES: readonly GPUCullMode[] = ['none', 'front', 'back'];

/** The descriptors of those three, one per cull mode: what a blend mode compiles. */
export function stageDescriptors(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  fragment: GPUFragmentState,
  depthWrite: boolean,
): GPURenderPipelineDescriptor[] {
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [layout, reflectionLayout(device)],
  });
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
