/**
 * THE PROJECTION A CUT'S BOXES ARE TESTED WITH, written into its uniform block
 * (`SelectionUniforms`, `selection.ts`): the render matrix at the eye, the projection's clip depth
 * along its clip weight and the view's size — what a box is projected to the pixel centres it
 * covers with (`../../geometry/dag/shader/occlusionWgsl.ts`) — and the planes of that same matrix,
 * which reject a box before it is projected.
 */
import { matrixAtRenderOrigin } from '../../../../math/src/projection/renderOrigin.ts'
import {
  FAR_PLANE_SLOT,
  frustumPlanesFromMatrix,
} from '../../../../math/src/geometry/frustum/frustum.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { SelectionUniforms } from './selection.ts'

/** The render matrix at the eye in doubles, between its composition and the planes read off it. */
const AT_EYE = /* @__PURE__ */ new Float64Array(16)

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

/** Writes into `into` the six planes the cut's boxes are rejected by: those of the render matrix
 *  `viewProj` at `cam`'s eye — the image's jittered one, so a box the raster covers in the half
 *  pixel the jitter moves is never rejected before it —, the far one the camera's, which the host
 *  declares and the matrix does not hold. The camera's own matrix: its planes (`planesRelative`). */
export function writeSelectionPlanes(
  into: SelectionUniforms,
  cam: EngineCamera,
  viewProj: ArrayLike<number>,
) {
  if (viewProj === cam.viewProjection) return void into.planes.set(cam.planesRelative)
  matrixAtRenderOrigin(AT_EYE, viewProj, cam.eye)
  frustumPlanesFromMatrix(into.planes, AT_EYE)
  const far = FAR_PLANE_SLOT * 4
  for (let k = 0; k < 4; k++) into.planes[far + k] = cam.planesRelative[far + k]
}

/** The clip depth of `projection` along its clip weight, written into `into`: `w = -z` under a
 *  perspective projection, so `z_clip = -P[10]·w + P[14]`; an orthographic box is mapped whole
 *  (`clipBox`, `../../geometry/dag/shader/occlusionWgsl.ts`). */
export function writeClipDepth(into: [number, number], projection: ArrayLike<number>) {
  into[0] = -projection[10]
  into[1] = projection[14]
}
