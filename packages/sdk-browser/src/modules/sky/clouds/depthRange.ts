import { computeTextureEntry, computeUniformEntry } from '../../../gpu/core/computeBindings.ts'
import { dividedSize, type ImageSize, type Size } from './reconstructLayout.ts'
import { CLOUD_DEPTH_RANGE_FORMAT } from './traceWgsl.ts'
import {
  DEPTH_RANGE_BINDING,
  DEPTH_RANGE_ENTRY,
  DEPTH_RANGE_VIEW,
  depthRangeProgram,
  type DepthRangePass,
} from './depthRangeWgsl.ts'

/**
 * THE SCENE DEPTH RANGE, described: two full-screen passes that turn the finished opaque depth into
 * a texture a quarter of the view's size per axis, a texel of which holds the lowest and the
 * highest device depth of the 4×4 block of the view it stands for (`depthRangeWgsl.ts`). Nothing
 * here touches the GPU; the pass's owner makes the two textures, the groups and the draws, the
 * view's rect being the target's origin.
 *
 * The first pass writes the half-size texture (`depthRangeSizes().half`) from the depth, the second
 * the quarter-size one (`.quarter`) from the first's; the quarter-size texture is what the view
 * tracing of two surfaces reads (`CLOUD_DEPTH_RANGE_FORMAT`, `traceWgsl.ts`). The traces of one
 * surface that read the half-size depth (`CloudSetup.depth` is `checkerboard`) have a single pass
 * instead, the checkerboard, which writes the half-size texture from the depth; the traces that
 * read the whole depth (`scene`) need none. The sizes follow the scene's, not the mode's.
 */

/** `GPUTextureUsage`'s flags, written in the clear. */
const TEXTURE_BINDING = 4,
  RENDER_ATTACHMENT = 16

/** Both textures are drawn by a pass and read by the next. */
export const DEPTH_RANGE_USAGE = TEXTURE_BINDING | RENDER_ATTACHMENT

/** The two textures' sizes, and the part of each the view fills, for a view of `view` pixels drawn
 *  in a target allocated at `allocated`: each divides the one before by two, rounding up. */
export function depthRangeSizes(allocated: Size, view: Size) {
  const half: ImageSize = {
    texture: dividedSize(allocated, 2),
    view: dividedSize(view, 2),
  }
  const quarter: ImageSize = {
    texture: dividedSize(half.texture, 2),
    view: dividedSize(half.view, 2),
  }
  return { half, quarter }
}

/** What each pass reads and writes: the kind of texture it samples, the image it samples and the
 *  image whose view it draws, of the sizes of `depthRangeSizes` and the depth's own. The checkerboard
 *  reads the depth and writes the half-size texture as the first pass does. */
const SCENE_TO_HALF = {
  sampleType: 'depth',
  reads: (_sizes: DepthRangeSizes, allocated: Size, view: Size): ImageSize => ({
    texture: allocated,
    view,
  }),
  writes: (sizes: DepthRangeSizes) => sizes.half,
} as const

const PASSES = {
  depth: SCENE_TO_HALF,
  checkerboard: SCENE_TO_HALF,
  range: {
    sampleType: 'unfilterable-float',
    reads: (sizes: DepthRangeSizes) => sizes.half,
    writes: (sizes: DepthRangeSizes) => sizes.quarter,
  },
} as const

type DepthRangeSizes = ReturnType<typeof depthRangeSizes>

/** The pass's uniform (`DEPTH_RANGE_VIEW`) into `out`, `DEPTH_RANGE_VIEW.words` words: `scale` is
 *  the source texture's size over the written one's, per axis, not the rounded 2 an odd size
 *  leaves; `source` the last pixel of the source's view. */
export function writeDepthRangeView(
  out: Float32Array,
  pass: DepthRangePass,
  allocated: Size,
  view: Size,
) {
  const sizes = depthRangeSizes(allocated, view)
  const from = PASSES[pass].reads(sizes, allocated, view)
  const to = PASSES[pass].writes(sizes)
  const { at } = DEPTH_RANGE_VIEW
  const ints = new Int32Array(out.buffer, out.byteOffset, out.length)
  out[at.scale] = from.texture.width / to.texture.width
  out[at.scale + 1] = from.texture.height / to.texture.height
  ints[at.source] = 0
  ints[at.source + 1] = 0
  ints[at.source + 2] = from.view.width - 1
  ints[at.source + 3] = from.view.height - 1
  return out
}

/** What a pass draws: a full-screen triangle over the written texture's view, into `rg16float`,
 *  its one group and its entries. */
export function describeDepthRange(pass: DepthRangePass, allocated: Size, view: Size) {
  const stage = GPUShaderStage.FRAGMENT
  return {
    code: depthRangeProgram(pass),
    vertexEntry: DEPTH_RANGE_ENTRY.vertex,
    fragmentEntry: DEPTH_RANGE_ENTRY.fragment,
    entries: [
      computeUniformEntry(DEPTH_RANGE_BINDING.view, {}, stage),
      computeTextureEntry(DEPTH_RANGE_BINDING.source, PASSES[pass].sampleType, '2d', stage),
    ],
    target: CLOUD_DEPTH_RANGE_FORMAT,
    viewport: PASSES[pass].writes(depthRangeSizes(allocated, view)).view,
    uniformFloats: DEPTH_RANGE_VIEW.words,
  }
}
