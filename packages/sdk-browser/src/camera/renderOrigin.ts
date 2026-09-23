import {
  FRUSTUM_PLANE_VALUES,
  frustumFarPlane,
  frustumPlanesFromMatrix,
  multiplyMatrix4,
  viewToRenderOrigin,
} from '../../../sdk-core/src/index.ts';

/**
 * THE CAMERA HALF OF THE RENDER FRAME (`sdk-core/mathRenderOrigin.ts` carries the rule and
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
  viewRelative: Float64Array;
  /** Projection × relative view. */
  viewProjectionRelative: Float64Array;
  /** The six frustum planes of `viewProjectionRelative`, laid out like `frustumPlanesFromMatrix`. */
  planesRelative: Float64Array;
}

export function createRenderOriginFrame(): RenderOriginFrame {
  return {
    viewRelative: new Float64Array(16),
    viewProjectionRelative: new Float64Array(16),
    planesRelative: new Float64Array(FRUSTUM_PLANE_VALUES),
  };
}

/**
 * Rewrites the three matrices from the frame's absolute view and projection. `far` is the
 * far plane the host declares: the engine projection no longer has one — it is infinite —
 * and the relative frustum keeps it exactly as the absolute frustum (`updateCameraFrame`).
 * It is read from the RELATIVE view, the very one whose frustum these planes describe.
 */
export function updateRenderOriginFrame(
  frame: RenderOriginFrame,
  view: Float64Array,
  projection: Float64Array,
  far = Infinity,
) {
  viewToRenderOrigin(frame.viewRelative, view);
  multiplyMatrix4(frame.viewProjectionRelative, projection, frame.viewRelative);
  frustumPlanesFromMatrix(frame.planesRelative, frame.viewProjectionRelative);
  frustumFarPlane(frame.planesRelative, 16, frame.viewRelative, far, true);
  return frame;
}

/**
 * True when two render-frame origins are the same point, bit for bit. An origin never
 * set — three `NaN`s — differs from everything, including itself: the first frame rebases.
 */
export function sameRenderOrigin(a: ArrayLike<number>, b: ArrayLike<number>) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** Copies the three matrices of an engine camera into another, without recomputing anything. */
export function holdRenderOriginFrame(into: RenderOriginFrame, from: RenderOriginFrame) {
  into.viewRelative.set(from.viewRelative);
  into.viewProjectionRelative.set(from.viewProjectionRelative);
  into.planesRelative.set(from.planesRelative);
  return into;
}
