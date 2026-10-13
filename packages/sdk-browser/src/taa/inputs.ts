import { TAA_BINDINGS } from './bindingsWgsl.ts'
import type { DisplayLayers } from './layers.ts'
import type { AccumulatedImage } from '../lighting/deferred/program.ts'
import { namedEntries } from '../gpu/core/computeBindings.ts'

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
  return namedEntries(TAA_BINDINGS, {
    current: inputs.current,
    history: image.color,
    historySampler: sampler,
    texelSampler,
    depth: inputs.depth,
    ids: inputs.ids,
    pages: { buffer: inputs.pages },
    motion: { buffer: inputs.motion },
    view: { buffer: uniform },
    reactive: inputs.reactive ?? noReactive,
    shareHistory: image.share,
    geometryHistory: geometry,
    shadingHistory: shading,
    indices: { buffer: inputs.pool },
    positions: { buffer: inputs.positions },
    uvs: { buffer: inputs.uvs },
    ...((inputs.flags || inputs.share) && { flags: inputs.share ?? inputs.flags! }),
  })
}
