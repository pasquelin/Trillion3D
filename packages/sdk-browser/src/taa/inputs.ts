import { TAA_BINDINGS } from './bindingsWgsl.ts'
import type { DisplayLayers } from './layers.ts'
import type { AccumulatedImage } from '../lighting/deferred/program.ts'

/** What the pass reads in the frame: the lit and blended image, depth, visibility-buffer
 *  identifiers, the page-record table, placement motion matrices and the surface flags — absent
 *  when no as-is pixel is in the frame, which the flagless resolve reads none of. */
export interface TaaInputs {
  current: GPUTextureView
  depth: GPUTextureView
  ids: GPUTextureView
  pages: GPUBuffer
  motion: GPUBuffer
  flags?: GPUTextureView
  share?: GPUTextureView
  /** The reactive value the blends, particles and water wrote, in its green channel
   *  (`../lighting/deferred/asIsShare.ts`); absent, none is (a 1×1 zero is bound). */
  reactive?: GPUTextureView
  /** The frame was drawn below the display: the resolve reconstructs it (`upscaleWgsl.ts`). */
  upscale?: boolean
  /** The display layers of a frame whose blends filter (`../webgpu/blend/displayFilter.ts`). */
  filter?: DisplayLayers
  /** The page pool and the float pool — positions, texture coordinates — a deformed pixel's
   *  triangle is read from (`deformWgsl.ts`). */
  pool: GPUBuffer
  positions: GPUBuffer
  uvs: GPUBuffer
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
  'pool',
  'positions',
  'uvs',
] as const

/**
 * The pass's bindings but the display layers', reading history `image`: its colour and its share
 * target (`historyWgsl.ts`); the flags, or a blended share, when the frame has them; `noReactive`
 * when the frame hands no reactive value; `texelSampler`, the resolve's gathers'.
 */
export function taaGroupEntries(
  inputs: TaaInputs,
  image: AccumulatedImage,
  sampler: GPUSampler,
  texelSampler: GPUSampler,
  uniform: GPUBuffer,
  noReactive: GPUTextureView,
  geometry: GPUTextureView,
  shading: GPUTextureView,
): GPUBindGroupEntry[] {
  const entries: GPUBindGroupEntry[] = [
    { binding: TAA_BINDINGS.current, resource: inputs.current },
    { binding: TAA_BINDINGS.history, resource: image.color },
    { binding: TAA_BINDINGS.historySampler, resource: sampler },
    { binding: TAA_BINDINGS.texelSampler, resource: texelSampler },
    { binding: TAA_BINDINGS.depth, resource: inputs.depth },
    { binding: TAA_BINDINGS.ids, resource: inputs.ids },
    { binding: TAA_BINDINGS.pages, resource: { buffer: inputs.pages } },
    { binding: TAA_BINDINGS.motion, resource: { buffer: inputs.motion } },
    { binding: TAA_BINDINGS.view, resource: { buffer: uniform } },
    { binding: TAA_BINDINGS.reactive, resource: inputs.reactive ?? noReactive },
    { binding: TAA_BINDINGS.shareHistory, resource: image.share },
    { binding: TAA_BINDINGS.geometryHistory, resource: geometry },
    { binding: TAA_BINDINGS.shadingHistory, resource: shading },
    { binding: TAA_BINDINGS.indices, resource: { buffer: inputs.pool } },
    { binding: TAA_BINDINGS.positions, resource: { buffer: inputs.positions } },
    { binding: TAA_BINDINGS.uvs, resource: { buffer: inputs.uvs } },
  ]
  if (inputs.flags || inputs.share)
    entries.push({ binding: TAA_BINDINGS.flags, resource: inputs.share ?? inputs.flags! })
  return entries
}
