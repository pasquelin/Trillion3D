import type { CutPyramid } from '../../geometry/dag/occlusion.ts'
import { twoPassOf } from '../../geometry/dag/shader/occlusionWgsl.ts'
import { prepared } from '../backend/state/prepared.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * What each view's last built pyramid was built from, and the pyramids the cut and the patches read
 * (`cutPyramid`, `previousPyramid`): the sources `./cutPyramid.ts` notes and writes the occlusion
 * from. Read by the passes beside the cut (`../../visibility/tessellation/`) without the frame's
 * encoders.
 */
export type PyramidSource = {
  /** The image's render matrix, its jitter included, from the world to clip space, in doubles. */
  viewProj: Float64Array
  depthMap: [number, number]
  size: [number, number]
  /** The pyramid's texture view it was built in. */
  view: GPUTextureView
  /** The levels uniform it was built with (`hizLevelWords`), this source's own. */
  levels: GPUBuffer
}

/** Each view's last built pyramid's source, by its record (`rt.views.active`). */
export const pyramidSources = new WeakMap<object, PyramidSource>()

/** The frame's pyramid as the cut binds it: its texture's view and its levels uniform; none once
 *  the Hi-Z is released. */
export function cutPyramid(rt: WebgpuPagesRuntime): CutPyramid | undefined {
  const gpuHiz = prepared(rt.vis, 'gpuHiz'),
    view = gpuHiz.pyramidView()
  return view && { view, levels: gpuHiz.levelTable }
}

/** The pyramid the drawn view's main pass tests against, as `writeCutOcclusion` bound it to the cut:
 *  the previous image's, its texture through the levels it was built with; none for a cut in one
 *  pass, which tests no box and no patch (`../../visibility/tessellation/`). */
export function previousPyramid(rt: WebgpuPagesRuntime): CutPyramid | undefined {
  if (!twoPassOf(rt.run.selectionUniforms)) return undefined
  const source = standingSource(rt)
  return source && { view: source.view, levels: source.levels }
}

/** The drawn view's last pyramid's source while it stands for this image's cut — its texture is the
 *  one in place (`writeCutOcclusion`) —, none otherwise. */
export function standingSource(rt: WebgpuPagesRuntime) {
  const source = pyramidSources.get(rt.views.active),
    pyramid = cutPyramid(rt)
  return source && pyramid && source.view === pyramid.view ? source : undefined
}

/** Whether the drawn view's last pyramid stands for this image's cut: what the primed pyramid's
 *  `'whenMissing'` waits on. */
export const pyramidStands = (rt: WebgpuPagesRuntime) => !!standingSource(rt)
