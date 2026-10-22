import { TAA_BINDINGS } from './bindingsWgsl.ts'
import type { DisplayLayers } from './layers.ts'
import type { AccumulatedImage } from '../../lighting/deferred/program.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
  namedEntries,
} from '../../gpu/core/computeBindings.ts'
import { VELOCITY_INPUT_BINDINGS as AT } from './nearestSurfaceWgsl.ts'

/** What the pass reads in the frame: the lit and blended image, depth, visibility-buffer
 *  identifiers, the page-record table, placement motion matrices, and the as-is flags — absent
 *  when no as-is pixel is in the frame, which the flagless resolve reads none of. */
export interface TaaInputs {
  current: GPUTextureView
  depth: GPUTextureView
  ids: GPUTextureView
  pages: GPUBuffer
  motion: GPUBuffer
  /** Each render texel's reprojection vector, the velocity stage's (`../velocity.ts`): the
   *  history's reprojection reads it. */
  vectors: GPUTextureView
  flags?: GPUTextureView
  share?: GPUTextureView
  /** The reactive value the blends, particles and water wrote, in its green channel — their
   *  accumulated opacity over the pixel (`../../lighting/deferred/asIsShare.ts`); absent, none is (a
   *  1×1 zero is bound). */
  reactive?: GPUTextureView
  /** What the blends and transmissive layers over each pixel give up of its history, in red
   *  (`GIVEN_UP_TARGET`, `../../lighting/deferred/asIsShare.ts`); absent, nothing (the same 1×1 zero
   *  is bound). */
  givenUp?: GPUTextureView
  /** The display layers of a frame whose blends filter (`../../blend/display/displayFilter.ts`). */
  filter?: DisplayLayers
  /** The page pool and the float pool — positions, texture coordinates — a deformed pixel's
   *  triangle is read from (`deformWgsl.ts`). */
  pool: GPUBuffer
  positions: GPUBuffer
  uvs: GPUBuffer
  /** The roots' world boxes (`rootBoxes`, `../../placement/roots/rootWorlds.ts`), which tell how
   *  large an object is on the screen (`perObjectSize`); a buffer of no root while the world holds
   *  none. */
  boxes: GPUBuffer
}
/** What the history update's groups name, in their identity order. */
export const INPUTS = ['current', 'flags', 'share', 'filter', 'givenUp'] as const

/**
 * The history update's bindings but the display layers', reading history `image`: its colour and
 * its share target (`resolveWgsl.ts`); the flags, or a blended share, when the frame has them; what
 * the transparents give up of the history;
 * the analysis's outputs (`analysis.ts`): each render texel's hole-filled reprojection vector,
 * shading rejection, and the spatial anti-aliaser's offset and noise filtering.
 */
export function taaGroupEntries(
  inputs: TaaInputs,
  image: AccumulatedImage,
  sampler: GPUSampler,
  uniform: GPUBuffer,
  analysis: {
    vectors: GPUTextureView
    rejection: GPUTextureView
    antiAliasing: GPUTextureView
  },
): GPUBindGroupEntry[] {
  return namedEntries(TAA_BINDINGS, {
    current: inputs.current,
    history: image.color,
    historySampler: sampler,
    rejection: analysis.rejection,
    vectors: analysis.vectors,
    antiAliasing: analysis.antiAliasing,
    view: { buffer: uniform },
    shareHistory: image.share,
    givenUp: inputs.givenUp!,
    ...((inputs.flags || inputs.share) && { flags: inputs.share ?? inputs.flags! }),
  })
}

/** The layout entries of what the nearest velocity reads of the frame (`VELOCITY_INPUT_BINDINGS`):
 *  the pass uniform, the depth, the identifiers, the page records, the placements' motion, the
 *  pools and the roots' world boxes. */
export const velocityInputEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(AT.view),
  computeTextureEntry(AT.depth, 'depth'),
  computeTextureEntry(AT.ids, 'uint'),
  ...[AT.pages, AT.motion, AT.indices, AT.positions, AT.uvs, AT.boxes].map((binding) =>
    computeBufferEntry(binding, 'read-only-storage'),
  ),
]

/** What the nearest velocity reads of the frame: its depth, identifiers, page records, motion,
 *  pools and roots' world boxes. */
export type VelocityInputs = Pick<
  TaaInputs,
  'depth' | 'ids' | 'pages' | 'motion' | 'pool' | 'positions' | 'uvs' | 'boxes'
>

/** What a group of the nearest velocity names of the frame's `inputs`, the pass `uniform` beside
 *  them. */
export const velocityInputResources = (inputs: VelocityInputs, uniform: GPUBuffer) => ({
  view: { buffer: uniform },
  depth: inputs.depth,
  ids: inputs.ids,
  pages: { buffer: inputs.pages },
  motion: { buffer: inputs.motion },
  indices: { buffer: inputs.pool },
  positions: { buffer: inputs.positions },
  uvs: { buffer: inputs.uvs },
  boxes: { buffer: inputs.boxes },
})
