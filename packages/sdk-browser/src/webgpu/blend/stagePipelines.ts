import { reflectionLayout } from '../../reflections/layout.ts';
import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import {
  buildRenderPipeline,
  preparedPipeline,
  started,
} from '../../lighting/deferred/fullscreen.ts';
import { BLEND_EQUATIONS, BLEND_MODES } from '../../scene/materialBlending.ts';
import { refreshSurface } from '../../page/surface.ts';
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import type { BlendGpuItem } from './state.ts';
import type { ContractKey } from '../../lighting/deferred/contractVariants.ts';

/** Source alpha over what the target holds: the normal mode, and the blend of the water surfaces
 *  and of their composite over the frozen backdrop. */
export const ALPHA_BLEND: GPUBlendState = BLEND_EQUATIONS.normal!;

/** The three pipelines a plan entry picks by rank (`plan.ts`): none, front, back. */
export type BlendPipelines = readonly [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline];

/** Pipelines a transparent pass picks by plan rank (`draw.ts`): the water surfaces' three, or the
 *  blend pass's modes, `filtered` in an image with display layers (`displayFilter.ts`); a rank
 *  the pass `skips` is not drawn (the display mask draws the filtering modes alone); `share`,
 *  those that write the as-is share of a debug view (`blendTargets`). */
export type RankedPipelines = {
  at(rank: number, filtered?: boolean, share?: boolean): GPURenderPipeline | undefined;
  skips?(rank: number): boolean;
};

/** What a transparent pass compiles per blending mode (`BLEND_MODES`): each mode's pipelines, one
 *  per descriptor its `describe` gives, prepared off the frame (`preparedPipeline`). `precompile`
 *  compiles modes without blocking the thread; `at` gives a mode's pipeline at `rank` of its
 *  descriptors, and a pipeline nothing prepared is made by the draw that asks for it, alone, once:
 *  a blending written later draws in its own mode at once, its other pipelines compiling off the
 *  thread from that draw on. */
export interface ModePipelines {
  at(mode: Blending, rank: number): GPURenderPipeline;
  precompile(modes: readonly Blending[]): Promise<void>;
}

/** The one lazy set of both transparent paths: the blend pass's three culls per mode, the fallback
 *  pass's one pipeline per mode (`pages/prepare/pipelines.ts`). A mode's descriptors are described
 *  once, at its first use. */
export function pipelinesByMode(
  device: GPUDevice,
  describe: (mode: Blending) => readonly GPURenderPipelineDescriptor[],
): ModePipelines {
  const byMode: (readonly ReturnType<typeof preparedPipeline>[] | undefined)[] = [];
  const of = (mode: Blending) =>
    (byMode[BLEND_MODES.indexOf(mode)] ??= describe(mode).map((descriptor) =>
      preparedPipeline(device, descriptor),
    ));
  return {
    at(mode, rank) {
      const first = !byMode[BLEND_MODES.indexOf(mode)],
        set = of(mode);
      // A mode a draw describes first: its other pipelines start off the thread, once.
      if (first) for (const [at, pipeline] of set.entries()) if (at !== rank) started(pipeline);
      return set[rank].get();
    },
    async precompile(modes) {
      await Promise.all(modes.flatMap((mode) => of(mode).map((pipeline) => pipeline.prepare())));
    },
  };
}

/** Normal as soon as a transparent item exists — a transmissive one draws in it —, then every mode a
 *  blend item declares: what both transparent paths compile up front. A scene of plain glass
 *  compiles normal alone; one with no transparent item compiles no blend program (#1362), a mode
 *  asked later compiles at its first draw (`at`). */
export const declaredBlendModes = (items: readonly BlendGpuItem[]) =>
  BLEND_MODES.filter(
    (mode, rank) =>
      (!rank && items.length > 0) ||
      items.some((item) => !item.transmissive && refreshSurface(item.surface).blending === mode),
  );

/** The blend pass's pipelines by plan rank — mode rank × 3 + cull rank (`plan.ts`), read from its
 *  `ModePipelines`, each mode's three culls. */
export interface BlendModePipelines extends RankedPipelines {
  /** The display mask's, whose target is attachment `slot` (`routedPipelines.ts`). */
  readonly mask: RankedPipelines & { slot: number };
  /** The pipelines of the program a frame of key `key` is lit with (`createForwardVariants`). */
  lit(key: Partial<ContractKey>): BlendModePipelines;
  /** Starts the compile of what a change of the scene or of a setting now reaches (`reach.ts`). */
  reach(next: { modes?: readonly Blending[]; share?: boolean; filtered?: boolean }): void;
  at(rank: number, filtered?: boolean, share?: boolean): GPURenderPipeline;
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
  group2?: GPUBindGroupLayout,
): Promise<BlendPipelines> {
  const [none, front, back] = await Promise.all(
    stageDescriptors(device, module, layout, fragment, depthWrite, group2).map((stage) =>
      buildRenderPipeline(device, stage),
    ),
  );
  return [none, front, back];
}

const CULL_MODES: readonly GPUCullMode[] = ['none', 'front', 'back'];

/** The descriptors of those three, one per cull mode: what a blend mode compiles; `group2`, the
 *  display mask's layout of a filtered image's pipelines. */
export function stageDescriptors(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  fragment: GPUFragmentState,
  depthWrite: boolean,
  group2?: GPUBindGroupLayout,
): GPURenderPipelineDescriptor[] {
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [layout, reflectionLayout(device), ...(group2 ? [group2] : [])],
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
