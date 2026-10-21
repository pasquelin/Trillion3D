/**
 * THE PROJECTION A CUT'S BOXES ARE TESTED WITH, written into its uniform block
 * (`SelectionUniforms`, `selection.ts`): the render matrix at the eye, the projection's clip depth
 * along its clip weight and the view's size — what a box is projected to the pixel centres it
 * covers with (`../../geometry/dag/shader/occlusionWgsl.ts`).
 */
import { matrixAtRenderOrigin } from '../../../../math/src/projection/renderOrigin.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { SelectionUniforms } from './selection.ts'

/** Writes into `into` the render matrix `viewProj` — the camera's, or the image's jittered one —
 *  at `cam`'s eye, the projection's depth map and the view's `size`: what a box is projected with
 *  (`SelectionUniforms.viewProj`). The matrix at the eye is computed in doubles and rounded once, as
 *  the block takes it. */
export function writeSelectionProjection(
  into: SelectionUniforms,
  cam: EngineCamera,
  viewProj: ArrayLike<number>,
  size: readonly [number, number],
) {
  matrixAtRenderOrigin(into.viewProj, viewProj, cam.eye)
  writeClipDepth(into.depthMap, cam.projection)
  into.viewSize[0] = size[0]
  into.viewSize[1] = size[1]
}

/** The clip depth of `projection` along its clip weight, written into `into`: `w = -z` under a
 *  perspective projection, so `z_clip = -P[10]·w + P[14]`; an orthographic box is mapped whole
 *  (`clipBox`, `../../geometry/dag/shader/occlusionWgsl.ts`). */
export function writeClipDepth(into: [number, number], projection: ArrayLike<number>) {
  into[0] = -projection[10]
  into[1] = projection[14]
}
