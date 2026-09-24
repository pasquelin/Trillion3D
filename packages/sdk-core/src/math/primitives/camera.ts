import {
  FRUSTUM_PLANE_VALUES,
  frustumFarPlane,
  frustumPlanesFromMatrix,
} from '../frustum/frustum.ts';
import { multiplyMatrix4, type NumberSink } from '../matrix/matrix4.ts';
import { invertMatrix4 } from '../matrix/matrix4Inverse.ts';

/**
 * Engine perspective camera, in REVERSED DEPTH and infinite far plane: near plane
 * projects to 1, infinity to 0, and clip bounds remain `[0, 1]`. This is the single
 * engine convention, published by `depthConvention.ts` (sdk-browser) to pipelines and depth
 * readers; no other is supported here.
 *
 * WHY. Single-precision depth concentrates its bits near zero, and perspective
 * division already concentrates depth near the near plane: both effects cancel out when
 * near plane is 1 and far is 0, so that at a thousand kilometers two adjacent surfaces
 * still retain distinct depth values where direct convention squashed them to the same
 * value. Far plane no longer enters the formula — no `far - near` in denominator,
 * hence nothing to tune and nothing that saturates: `ndc = near / distance`.
 *
 * Neither offset view (`setViewOffset`) nor film offset: the engine sets none. An orthographic
 * camera composes `orthographicProjection`, below, in the same depth convention.
 */

const DEG2RAD = Math.PI / 180;

/** Half the height a perspective camera of vertical field `fov` degrees, zoomed by `zoom`, sees
 *  one unit ahead: `tan(fov / 2) / zoom`. Its projection, its rays and a pixel's size read it. */
export function perspectiveSlope(fov: number, zoom = 1) {
  return Math.tan(DEG2RAD * 0.5 * fov) / zoom;
}

/** The view of an orthographic camera: its `box` scaled by `zoom` about the box centre, as
 *  `[centre x, centre y, half width, half height]` written into `out`. */
export function orthographicView(
  box: { left: number; right: number; top: number; bottom: number },
  zoom: number,
  out = new Float64Array(4),
) {
  out[0] = (box.right + box.left) / 2;
  out[1] = (box.top + box.bottom) / 2;
  out[2] = (box.right - box.left) / (2 * zoom);
  out[3] = (box.top - box.bottom) / (2 * zoom);
  return out;
}

/**
 * Perspective projection of a camera with vertical `fov` degrees, ratio `aspect`, near plane
 * `near`, zoom `zoom`. Reversed depth, infinite far plane: `near` projects to
 * 1, infinity to 0. No far plane enters here, hence no division by it.
 */
export function perspectiveProjection<T extends NumberSink>(
  out: T,
  fov: number,
  aspect: number,
  near: number,
  zoom: number,
) {
  const top = (near * perspectiveSlope(fov)) / zoom; // this order, bit for bit the reference's
  const height = 2 * top,
    width = aspect * height;
  const left = -0.5 * width,
    right = left + width,
    bottom = top - height;
  out[0] = (2 * near) / (right - left);
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = (2 * near) / (top - bottom);
  out[6] = 0;
  out[7] = 0;
  out[8] = (right + left) / (right - left);
  out[9] = (top + bottom) / (top - bottom);
  // `z_clip = near` and `w_clip = -z_view`: normalized depth equals `near / distance`,
  // which equals 1 at near plane and approaches 0 without reaching it.
  out[10] = 0;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = near;
  out[15] = 0;
  return out;
}

/**
 * Orthographic projection of the box `[left, right] × [bottom, top]` between `near` and `far`,
 * in the same REVERSED depth: `near` projects to 1 and `far` to 0 — an orthography has a finite
 * far plane, depth being affine in distance. The box may sit off the axis (`left ≠ −right`).
 */
export function orthographicProjection<T extends NumberSink>(
  out: T,
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
) {
  for (let i = 0; i < 16; i++) out[i] = 0;
  out[0] = 2 / (right - left);
  out[5] = 2 / (top - bottom);
  out[10] = 1 / (far - near);
  // `+ 0` keeps a centred box's offsets at +0, never −0.
  out[12] = -(right + left) / (right - left) + 0;
  out[13] = -(top + bottom) / (top - bottom) + 0;
  out[14] = far / (far - near);
  out[15] = 1;
  return out;
}

/** Matrices of a camera frame, allocated once and rewritten each frame. */
export interface CameraFrame {
  /** View: inverse of camera world matrix (`matrixWorldInverse`). */
  view: Float64Array;
  /** Projection × view. */
  viewProjection: Float64Array;
  /** The six normalized planes of the `viewProjection` frustum, ordered like `frustumPlanesFromMatrix`. */
  planes: Float64Array;
}

/** A camera frame's matrices and planes, made once and rewritten each frame. */
export function createCameraFrame(): CameraFrame {
  return {
    view: new Float64Array(16),
    viewProjection: new Float64Array(16),
    planes: new Float64Array(FRUSTUM_PLANE_VALUES),
  };
}

/**
 * Rewrites frame: view = inverse of `world` (zero for a singular world matrix, like
 * reference), view-projection = `projection · view`, and the six planes of this
 * view-projection frustum. A single depth convention crosses all three.
 *
 * `far` is the far plane DECLARED by host. Projection has none — it is infinite,
 * which is the whole point of reversed Z —, but frustum keeps it: without it, a frame would
 * suddenly gain all objects camera was not showing. Omitted or non-finite, far remains
 * unbounded (`frustumFarPlane`).
 *
 * Projection and world pose are owned `Float64Array`, like the frame's three buffers:
 * product only reads a single buffer type (`../matrix/matrix4.ts`), and caller starting from
 * a host matrix copies it before entering here — `readCameraWorld` already does this.
 */
export function updateCameraFrame(
  frame: CameraFrame,
  projection: Float64Array,
  world: Float64Array,
  far = Infinity,
) {
  invertMatrix4(frame.view, world);
  multiplyMatrix4(frame.viewProjection, projection, frame.view);
  frustumPlanesFromMatrix(frame.planes, frame.viewProjection);
  frustumFarPlane(frame.planes, 16, frame.view, far, true);
  return frame;
}

/** The clip w of a point at view depth `depth`: `perspective·depth + (1 − perspective)` — its
 *  depth under a perspective projection, 1 under an orthographic one (`EngineCamera.perspective`). */
export const clipWeight = (perspective: number, depth: number) =>
  perspective * depth + (1 - perspective);
