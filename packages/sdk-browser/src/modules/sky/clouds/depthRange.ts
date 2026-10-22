import { computeTextureEntry, computeUniformEntry } from '../../../gpu/core/computeBindings.ts'
import { cloudSizes, type Size } from './reconstructLayout.ts'
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
 * tracing reads (`CLOUD_DEPTH_RANGE_FORMAT`, `traceWgsl.ts`).
 */

/** `GPUTextureUsage`'s flags, written in the clear. */
const TEXTURE_BINDING = 4,
  RENDER_ATTACHMENT = 16

/** Both textures are drawn by a pass and read by the next. */
export const DEPTH_RANGE_USAGE = TEXTURE_BINDING | RENDER_ATTACHMENT

/** The two textures' sizes, and the part of each the view fills, for a view of `view` pixels drawn
 *  in a target allocated at `allocated`: each divides the one before by two, rounding up. */
export function depthRangeSizes(allocated: Size, view: Size) {
  const { reconstructed, traced } = cloudSizes(allocated, view)
  return { half: reconstructed, quarter: traced }
}

/** The pass's uniform (`DEPTH_RANGE_VIEW`) into `out`, `DEPTH_RANGE_VIEW.words` words: `scale` is
 *  the source texture's size over the written one's, per axis, not the rounded 2 an odd size
 *  leaves; `source` the last pixel of the source's view. */
export function writeDepthRangeView(
  out: Float32Array,
  pass: DepthRangePass,
  allocated: Size,
  view: Size,
) {
  const { half, quarter } = depthRangeSizes(allocated, view)
  const from = pass === 'depth' ? { texture: allocated, view } : half
  const to = pass === 'depth' ? half : quarter
  const { at } = DEPTH_RANGE_VIEW
  const ints = new Int32Array(out.buffer, out.byteOffset, out.length)
  out.set(
    [from.texture.width / to.texture.width, from.texture.height / to.texture.height],
    at.scale,
  )
  ints.set([0, 0, from.view.width - 1, from.view.height - 1], at.source)
  return out
}

/** What a pass draws: a full-screen triangle over the written texture's view, into `rg16float`,
 *  its one group and its entries. */
export function describeDepthRange(pass: DepthRangePass, allocated: Size, view: Size) {
  const { half, quarter } = depthRangeSizes(allocated, view)
  const stage = GPUShaderStage.FRAGMENT
  return {
    code: depthRangeProgram(pass),
    vertexEntry: DEPTH_RANGE_ENTRY.vertex,
    fragmentEntry: DEPTH_RANGE_ENTRY.fragment,
    entries: [
      computeUniformEntry(DEPTH_RANGE_BINDING.view, {}, stage),
      computeTextureEntry(
        DEPTH_RANGE_BINDING.source,
        pass === 'depth' ? 'depth' : 'unfilterable-float',
        '2d',
        stage,
      ),
    ],
    target: CLOUD_DEPTH_RANGE_FORMAT,
    viewport: (pass === 'depth' ? half : quarter).view,
    uniformFloats: DEPTH_RANGE_VIEW.words,
  }
}
