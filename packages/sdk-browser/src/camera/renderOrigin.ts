import { FRUSTUM_PLANE_VALUES } from '../../../math/src/geometry/frustum/frustum.ts'
import { viewFrustum } from '../../../math/src/projection/camera.ts'
import { viewToRenderOrigin } from '../../../math/src/projection/renderOrigin.ts'

/**
 * THE CAMERA HALF OF THE RENDER FRAME (`../../../math/src/projection/renderOrigin.ts` carries the rule and
 * its why). The frame origin is the eye of the frame; the camera is therefore set at zero,
 * and its view is only its orientation. These three matrices are computed ONCE per frame, in
 * double precision, in the engine camera, at the same time as their absolute twins.
 *
 * THE TWO HALVES DO NOT MIX. What leaves for the GPU with world matrices brought back to the
 * eye reads `viewRelative` and `planesRelative`; what stays in double precision on the CPU
 * — exact cut, Hi-Z, stream priority, lighting, diagnostics — keeps `view`,
 * `viewProjection` and `planes`, which describe the same world without losing anything at
 * that distance.
 *
 * WHAT THIS DOES NOT CHANGE. Camera at the world origin, `viewRelative` is `view` bit for bit
 * and the relative planes are the planes: already-rendered frames keep their pixels exactly.
 */
export interface RenderOriginFrame {
  /** The view stripped of its translation: the camera's orientation, set at the frame origin. */
  viewRelative: Float64Array
  /** Projection × relative view. */
  viewProjectionRelative: Float64Array
  /** The six frustum planes of `viewProjectionRelative`, laid out like `frustumPlanesFromMatrix`. */
  planesRelative: Float64Array
}

export function createRenderOriginFrame(): RenderOriginFrame {
  return {
    viewRelative: new Float64Array(16),
    viewProjectionRelative: new Float64Array(16),
    planesRelative: new Float64Array(FRUSTUM_PLANE_VALUES),
  }
}

/**
 * Rewrites the three matrices from the frame's absolute view and projection. The relative
 * frustum has no far plane, like the absolute one (`updateCameraFrame`): the engine projection
 * is infinite. It is read from the RELATIVE view, the very one whose frustum these planes
 * describe.
 */
export function updateRenderOriginFrame(
  frame: RenderOriginFrame,
  view: Float64Array,
  projection: Float64Array,
) {
  viewToRenderOrigin(frame.viewRelative, view)
  viewFrustum(frame.viewProjectionRelative, frame.planesRelative, projection, frame.viewRelative)
  return frame
}

/** Copies the three matrices of an engine camera into another, without recomputing anything. */
export function holdRenderOriginFrame(into: RenderOriginFrame, from: RenderOriginFrame) {
  into.viewRelative.set(from.viewRelative)
  into.viewProjectionRelative.set(from.viewProjectionRelative)
  into.planesRelative.set(from.planesRelative)
  return into
}
