import { TAA_BINDINGS } from './shaderWgsl.ts';
import type { DisplayLayers } from './layers.ts';
import type { AccumulatedImage } from '../lighting/deferred/program.ts';

/** What the pass reads in the frame: the lit and blended image, depth, visibility-buffer
 *  identifiers, the page-record table, placement motion matrices and the surface flags — absent
 *  when no as-is pixel is in the frame, which the flagless resolve reads none of (OMB-11). */
export interface TaaInputs {
  current: GPUTextureView;
  depth: GPUTextureView;
  ids: GPUTextureView;
  pages: GPUBuffer;
  motion: GPUBuffer;
  flags?: GPUTextureView;
  share?: GPUTextureView;
  /** The reactive value the blends and particles wrote, in its green channel
   *  (`../lighting/deferred/asIsShare.ts`); absent, none is (a 1×1 zero is bound). */
  reactive?: GPUTextureView;
  /** The frame was drawn below the display: the resolve reconstructs it (`upscaleWgsl.ts`). */
  upscale?: boolean;
  /** The display layers of a frame whose blends filter (`../webgpu/blend/displayFilter.ts`). */
  filter?: DisplayLayers;
}
export const INPUTS = [
  'current',
  'depth',
  'ids',
  'pages',
  'motion',
  'flags',
  'share',
  'reactive',
  'filter',
] as const;

/**
 * The pass's bindings but the display layers', reading history `image`: its colour, and its share
 * texture as the placement tags (`historyWgsl.ts`) and, with flags or a blended share, as the share
 * history; `noReactive` when the frame hands no reactive value.
 */
export function taaGroupEntries(
  inputs: TaaInputs,
  image: AccumulatedImage,
  sampler: GPUSampler,
  uniform: GPUBuffer,
  noReactive: GPUTextureView,
): GPUBindGroupEntry[] {
  const entries: GPUBindGroupEntry[] = [
    { binding: TAA_BINDINGS.current, resource: inputs.current },
    { binding: TAA_BINDINGS.history, resource: image.color },
    { binding: TAA_BINDINGS.historySampler, resource: sampler },
    { binding: TAA_BINDINGS.depth, resource: inputs.depth },
    { binding: TAA_BINDINGS.ids, resource: inputs.ids },
    { binding: TAA_BINDINGS.pages, resource: { buffer: inputs.pages } },
    { binding: TAA_BINDINGS.motion, resource: { buffer: inputs.motion } },
    { binding: TAA_BINDINGS.view, resource: { buffer: uniform } },
    { binding: TAA_BINDINGS.reactive, resource: inputs.reactive ?? noReactive },
    { binding: TAA_BINDINGS.tagHistory, resource: image.share },
  ];
  if (inputs.flags || inputs.share)
    entries.push(
      { binding: TAA_BINDINGS.flags, resource: inputs.share ?? inputs.flags! },
      { binding: TAA_BINDINGS.shareHistory, resource: image.share },
    );
  return entries;
}
