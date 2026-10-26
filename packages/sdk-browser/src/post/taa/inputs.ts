import { TAA_BINDINGS } from './bindingsWgsl.ts'
import type { DisplayLayers } from './layers.ts'
import type { HistoryFrame } from './historyTargets.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
  namedEntries,
} from '../../gpu/core/computeBindings.ts'
import { atlasLayoutEntries, type AtlasBindings } from '../../gpu/bind/bindLayout.ts'
import type { AtlasResources } from '../../gpu/bind/bindEntries.ts'
import { VELOCITY_INPUT_BINDINGS as AT } from './nearestSurfaceWgsl.ts'
import type { FusedFlatten } from '../effects/motionBlur/motionBlurLayout.ts'
import { graphFrameEntry } from '../../visibility/shader/graphFrameWgsl.ts'

/** What the pass reads in the frame: the lit and blended image, depth, visibility-buffer
 *  identifiers, the page-record table, the placements' poses now and as the last drawn frame drew
 *  them. */
export interface TaaInputs {
  current: GPUTextureView
  depth: GPUTextureView
  ids: GPUTextureView
  pages: GPUBuffer
  /** The cut's placement records (`../../geometry/dag/worlds/worldTable.ts`) and the poses the last
   *  drawn frame drew (`../../geometry/dag/previousPoses.ts`), the worlds' layout. */
  worlds: GPUTextureView
  previous: GPUTextureView
  /** Each render texel's own reprojection vector, the velocity stage's (`../velocity.ts`): the
   *  history's reprojection dilates it by the closest surface of each texel's 3×3. */
  vectors: GPUTextureView
  /** The translucency the image was composed with (`../../blend/translucency.ts`): the light its
   *  layers add and the transmittance, which the thin geometry and the flicker measure read
   *  (`translucencyWgsl.ts`); absent, a 1×1 of no light and 1 is bound. */
  translucency?: GPUTextureView
  /** The responsiveness the blends and transmissive layers over each pixel carry, in red
   *  (`RESPONSIVE_TARGET`, `../../blend/responsive.ts`): the nearest velocity reads it as
   *  the flags of the pixel; absent, none (the same 1×1 zero is bound). */
  responsive?: GPUTextureView
  /** Where the nearest velocity flattens the motion blur's motion, set by the frame when the blur
   *  asks for it (`../effects/motionBlur/motionBlurLayout.ts`); absent, the blur flattens its own. */
  flatten?: FusedFlatten
  /** The display layers of a frame whose blends filter (`../../blend/display/displayFilter.ts`). */
  filter?: DisplayLayers
  /** The page pool, the float pool — positions, texture coordinates — and its normal atlas a
   *  deformed or displaced pixel's triangle is read from (`deformWgsl.ts`). */
  pool: GPUBuffer
  positions: GPUBuffer
  uvs: GPUBuffer
  normals: GPUTextureView
  /** The surfaces' records, which hold the values of the offsets that move the vertices the velocity
   *  places a pixel on (`../../materials/graph/wpoProgram.ts`), and the graph frame they are evaluated
   *  at (`../../frame/render/graphFrame.ts`). */
  material: GPUTextureView
  frame: GPUBuffer
  /** The colour atlas and the sampler an offset reads a texture through (`WpoSet.atlas`). */
  textures: AtlasResources['textures']
  sampler: GPUSampler
}
/** What the history update's groups name, in their identity order. */
export const INPUTS = ['current', 'filter'] as const

/**
 * The history update's bindings but the display layers', reading the last image's frame `image` and
 * the frame `resurrected` a pixel may be resurrected from: their colour and their validity
 * (`resolveWgsl.ts`); the analysis's
 * outputs (`analysis.ts`): each render texel's scene colour, hole-filled reprojection vector, shading rejection,
 * the spatial anti-aliaser's offset and noise filtering, and the reprojection field's jacobian and
 * boundary.
 */
export function taaGroupEntries(
  inputs: TaaInputs,
  image: HistoryFrame,
  resurrected: HistoryFrame,
  sampler: GPUSampler,
  uniform: GPUBuffer,
  analysis: {
    sceneColor: GPUBuffer
    vectors: GPUTextureView
    rejection: GPUTextureView
    antiAliasing: GPUTextureView
    jacobian: GPUTextureView
    boundary: GPUTextureView
  },
): GPUBindGroupEntry[] {
  return namedEntries(TAA_BINDINGS, {
    sceneColor: { buffer: analysis.sceneColor },
    history: image.color,
    historySampler: sampler,
    rejection: analysis.rejection,
    vectors: analysis.vectors,
    antiAliasing: analysis.antiAliasing,
    view: { buffer: uniform },
    validityHistory: image.validity,
    historyResurrected: resurrected.color,
    validityResurrected: resurrected.validity,
    jacobian: analysis.jacobian,
    boundary: analysis.boundary,
  })
}

/** The layout entries of what the velocity passes read of the frame (`VELOCITY_INPUT_BINDINGS`):
 *  the pass uniform, the depth, the identifiers, the page records, the placements' two poses, the
 *  pools, the normal atlas, the surfaces' records and the graph frame — the
 *  last two whatever offsets the session holds, so that one that joins later is a module and no
 *  layout. */
export const velocityInputEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(AT.view),
  computeTextureEntry(AT.depth, 'depth'),
  computeTextureEntry(AT.ids, 'uint'),
  computeBufferEntry(AT.pages, 'read-only-storage'),
  computeTextureEntry(AT.worlds, 'uint', '2d-array'),
  ...[AT.indices, AT.positions, AT.uvs].map((binding) =>
    computeBufferEntry(binding, 'read-only-storage'),
  ),
  computeTextureEntry(AT.normals, 'unfilterable-float', '2d-array'),
  // The surfaces' records, which hold the values of the offsets that move vertices, the frame, and
  // the colour atlas and its sampler where an offset reads a texture.
  computeTextureEntry(AT.material, 'uint', '2d-array'),
  graphFrameEntry(AT.frame, COMPUTE),
  ...atlasLayoutEntries(VELOCITY_ATLAS, COMPUTE),
  computeSamplerEntry(AT.sampler, 'filtering'),
  computeTextureEntry(AT.previous, 'uint', '2d-array'),
]

/** The colour atlas's bindings in the velocity passes' group. */
export const VELOCITY_ATLAS: AtlasBindings = {
  lanes: [AT.colorPool0, AT.colorPool1, AT.colorPool2],
  pages: AT.colorPages,
}

/** What the velocity passes read of the frame: its depth, identifiers, page records, poses,
 *  pools and normal atlas, the surfaces' records and the graph frame. */
export type VelocityInputs = Pick<
  TaaInputs,
  | 'depth'
  | 'ids'
  | 'pages'
  | 'worlds'
  | 'previous'
  | 'pool'
  | 'positions'
  | 'uvs'
  | 'normals'
  | 'material'
  | 'frame'
  | 'textures'
  | 'sampler'
>

/** What a velocity group binds of the colour atlas — its lanes' views and its page table —, in its
 *  identity's order: a resize of the pool replaces them in the same atlas object (`relayout`), so a
 *  group keyed on the atlas would keep the pool retired and destroyed after the submit. */
export const velocityAtlasBound = ({ textures }: Pick<VelocityInputs, 'textures'>) => {
  const color = textures.color!
  return [color.views[0], color.views[1], color.views[2], color.pages.buffer] as const
}

/** What a group of a velocity pass names of the frame's `inputs`, the pass `uniform` beside
 *  them. */
export const velocityInputResources = (inputs: VelocityInputs, uniform: GPUBuffer) => ({
  view: { buffer: uniform },
  depth: inputs.depth,
  ids: inputs.ids,
  pages: { buffer: inputs.pages },
  worlds: inputs.worlds,
  previous: inputs.previous,
  indices: { buffer: inputs.pool },
  positions: { buffer: inputs.positions },
  uvs: { buffer: inputs.uvs },
  normals: inputs.normals,
  material: inputs.material,
  frame: { buffer: inputs.frame },
  colorPool0: inputs.textures.color!.views[0],
  colorPool1: inputs.textures.color!.views[1],
  colorPool2: inputs.textures.color!.views[2],
  colorPages: { buffer: inputs.textures.color!.pages.buffer },
  sampler: inputs.sampler,
})
