import { DEG2RAD } from '../constants.ts'
import { FRUSTUM_PLANE_VALUES, frustumPlanesFromMatrix } from '../geometry/frustum/frustum.ts'
import {
  determinantMatrix4,
  IDENTITY_MATRIX4,
  multiplyMatrix4,
  type NumberSink,
} from '../matrix/matrix4.ts'
import { invertMatrix4 } from '../matrix/matrix4Inverse.ts'
import { length2 } from '../vector/vector.ts'

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
 * value. Far plane does not enter the formula — no `far - near` in denominator,
 * hence nothing to tune and nothing that saturates: `ndc = near / distance`.
 *
 * The perspective looks straight down its axis: no shift of the picture off that axis enters
 * here. An orthographic camera composes `orthographicProjection`, below, in the same depth
 * convention.
 */

// Radians in half a degree: a field of `fov` degrees opens `fov` of them on each side of the axis.
const HALF_DEGREE = DEG2RAD / 2

/** The least vertical field a perspective camera opens, in degrees: a smaller one is read as this,
 *  so the projection never divides by a zero tangent. */
const MIN_FIELD = 0.001

/** The nearest distance a perspective camera draws when it declares none (a near plane that is
 *  not above zero), in metres. */
export const DEFAULT_NEAR = 0.1

/** The size under which an axis of a camera's world is taken for nothing, in metres. */
const NEARLY_ZERO = 1e-8

/** The nine entries of the three axes of a column-major world matrix. */
const AXES = [0, 1, 2, 4, 5, 6, 8, 9, 10]

/** The near plane a perspective camera draws: `near` where it is above zero, `DEFAULT_NEAR`
 *  otherwise (zero, negative or NaN). */
export const perspectiveNear = (near: number) => (near > 0 ? near : DEFAULT_NEAR)

/** The vertical field a perspective camera of declared field `fov` degrees opens: `fov`, or
 *  `MIN_FIELD` where it is smaller (or NaN). */
export const perspectiveField = (fov: number) => (fov >= MIN_FIELD ? fov : MIN_FIELD)

/** Half the height a perspective camera of vertical field `fov` degrees (`perspectiveField`),
 *  zoomed by `zoom`, sees one unit ahead: `tan(fov / 2) / zoom`. Its projection, its rays and a
 *  pixel's size read it. */
export function perspectiveSlope(fov: number, zoom = 1) {
  return Math.tan(perspectiveField(fov) * HALF_DEGREE) / zoom
}

/** The diagonal slope of that camera at picture `aspect`: `perspectiveSlope(fov, zoom) ·
 *  length2(1, aspect)`, how far off its axis, per unit ahead, a corner of its picture lies. */
export function perspectiveDiagonalSlope(fov: number, aspect: number, zoom = 1) {
  return perspectiveSlope(fov, zoom) * length2(1, aspect)
}

/** The projection scale of a perspective of half field `half` radians: `1 / Math.tan(half)`, the
 *  cotangent its first two diagonal entries hold. */
export const focalScale = (half: number) => 1 / Math.tan(half)

/**
 * Pixels per unit of view-space extent at unit depth under projection `p`, at a viewport `w × h`
 * pixels: `[(w·|p[0]|) / 2, (h·|p[5]|) / 2]` into `out`, the half viewport times the projection's
 * scale on each axis. Under an orthographic projection, pixels per unit of extent at any depth.
 */
export function pixelScale<T extends NumberSink>(out: T, p: ArrayLike<number>, w = 1, h = 1) {
  out[0] = axisPixels(w, p[0])
  out[1] = axisPixels(h, p[5])
  return out
}

/** Pixels per unit on one axis of `size` pixels whose projection scale is `scale`:
 *  `(size·|scale|) / 2`, `pixelScale`'s term. */
const axisPixels = (size: number, scale: number) => (size * Math.abs(scale)) / 2

/** The larger of `pixelScale`'s two (`axisPixels`): the focal length in pixels a screen-space
 *  error is measured with. */
export function focalPixels(p: ArrayLike<number>, w = 1, h = 1) {
  return Math.max(axisPixels(w, p[0]), axisPixels(h, p[5]))
}

type Box = { left: number; right: number; top: number; bottom: number }

/** The view of an orthographic camera: its `box` scaled by `zoom` about the box centre, as
 *  `[centre x, centre y, half width, half height]` written into `out`. */
function orthographicView(box: Box, zoom: number, out = new Float64Array(4)) {
  out[0] = (box.right + box.left) / 2
  out[1] = (box.top + box.bottom) / 2
  out[2] = (box.right - box.left) / (2 * zoom)
  out[3] = (box.top - box.bottom) / (2 * zoom)
  return out
}

/** `orthographicView` of the box an orthographic camera draws at a picture of `aspect`: its own,
 *  or with `fitAspect` as high about the same centre, its half width the half height times
 *  `aspect`. */
export function drawnView(
  box: Box & { fitAspect?: boolean },
  aspect: number,
  zoom: number,
  out = new Float64Array(4),
) {
  orthographicView(box, zoom, out)
  if (box.fitAspect) out[2] = out[3] * aspect
  return out
}

/**
 * Perspective projection of a camera with vertical `fov` degrees (`perspectiveField`), ratio
 * `aspect`, near plane `near` (`perspectiveNear`), zoom `zoom`. Reversed depth, infinite far
 * plane: the near plane projects to 1, infinity to 0. No far plane enters here, hence no
 * division by it.
 */
export function perspectiveProjection<T extends NumberSink>(
  out: T,
  fov: number,
  aspect: number,
  declaredNear: number,
  zoom: number,
) {
  const near = perspectiveNear(declaredNear)
  // The eye looks down −z: a view point (X, Y, Z) lies δ = −Z ahead, and clip w = δ divides it
  // by that distance. Through the near plane it lands at (X, Y) · near / δ, inside a rectangle
  // centred on the axis, of half height hy = near · tan(fov / 2) / zoom and half width
  // hx = aspect · hy. Its edges must reach ±1, so clip x = (near / hx) X and clip y = (near / hy) Y;
  // centred, neither reads Z. Clip z = near for every point, so depth z / w = near / δ: 1 on the
  // near plane, falling towards 0 with distance and never reaching it.
  const hy = (near * perspectiveSlope(fov)) / zoom, // this rounding order is fixed, bit for bit
    hx = aspect * hy
  // All sixteen slots, in index order, zeros included: no zeroing pass written over again.
  out[0] = near / hx
  out[1] = 0
  out[2] = 0
  out[3] = 0
  out[4] = 0
  out[5] = near / hy
  out[6] = 0
  out[7] = 0
  out[8] = 0
  out[9] = 0
  out[10] = 0
  out[11] = -1
  out[12] = 0
  out[13] = 0
  out[14] = near
  out[15] = 0
  return out
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
  // w = 1: nothing shrinks with distance. Each axis carries its faces lo and hi onto −1 and 1,
  // v ↦ (2v − (lo + hi)) / (hi − lo): a scale and an offset over the box's extent on that axis.
  // Depth counts δ = −z ahead and falls linearly from 1 at `near` to 0 at `far`, over the
  // extent dz = far − near: (far − δ) / dz = z / dz + far / dz.
  const dx = right - left,
    dy = top - bottom,
    dz = far - near
  // All sixteen slots, in index order, zeros included: no zeroing pass written over again.
  out[0] = 2 / dx
  out[1] = 0
  out[2] = 0
  out[3] = 0
  out[4] = 0
  out[5] = 2 / dy
  out[6] = 0
  out[7] = 0
  out[8] = 0
  out[9] = 0
  out[10] = 1 / dz
  out[11] = 0
  // `+ 0` keeps a centred box's offsets at +0, never −0.
  out[12] = -(left + right) / dx + 0
  out[13] = -(bottom + top) / dy + 0
  out[14] = far / dz
  out[15] = 1
  return out
}

/** Matrices of a camera frame, allocated once and rewritten each frame. */
export interface CameraFrame {
  /** View: inverse of the camera world matrix. */
  view: Float64Array
  /** Projection × view. */
  viewProjection: Float64Array
  /** The six normalized planes of the `viewProjection` frustum, ordered like `frustumPlanesFromMatrix`. */
  planes: Float64Array
}

/** A camera frame's matrices and planes, made once and rewritten each frame. */
export function createCameraFrame(): CameraFrame {
  return {
    view: new Float64Array(16),
    viewProjection: new Float64Array(16),
    planes: new Float64Array(FRUSTUM_PLANE_VALUES),
  }
}

/** The `view` of a camera standing at `world`, into `out`: its inverse, or the identity (a camera at
 *  the origin looking down −z) where `world` has no inverse — its determinant zero or not finite,
 *  or its three axes all within `NEARLY_ZERO` of nothing — so a camera scaled away never makes a
 *  view of zeros or NaN. */
function viewOf(out: Float64Array, world: Float64Array) {
  const determinant = determinantMatrix4(world)
  let largest = 0
  for (const entry of AXES) largest = Math.max(largest, Math.abs(world[entry]))
  if (determinant === 0 || !Number.isFinite(determinant) || largest <= NEARLY_ZERO)
    return out.set(IDENTITY_MATRIX4)
  return invertMatrix4(out, world)
}

/**
 * Rewrites frame: view = inverse of `world` (`viewOf`), view-projection = `projection · view`, and
 * the six planes of this view-projection frustum. A single depth convention crosses all three.
 *
 * The projection has no far plane — it is infinite, which is the whole point of reversed Z — and
 * the frustum adds none: an object is culled by what the camera sees of it, never by a distance.
 * An orthographic projection holds its own, in its depth row.
 *
 * Projection and world pose are owned `Float64Array`, like the frame's three buffers:
 * product only reads a single buffer type (`../matrix/matrix4.ts`), and caller starting from
 * a host matrix copies it before entering here — `readCameraWorld` already does this.
 */
export function updateCameraFrame(
  frame: CameraFrame,
  projection: Float64Array,
  world: Float64Array,
) {
  viewOf(frame.view, world)
  viewFrustum(frame.viewProjection, frame.planes, projection, frame.view)
  return frame
}

/** The frustum of `view` under `projection` into `viewProjection` (`projection · view`) and its
 *  six normalized `planes`. */
export function viewFrustum(
  viewProjection: Float64Array,
  planes: Float32Array | Float64Array,
  projection: Float64Array,
  view: Float64Array,
) {
  multiplyMatrix4(viewProjection, projection, view)
  frustumPlanesFromMatrix(planes, viewProjection)
}

/** The clip w of a point at view depth `depth`: `perspective·depth + (1 − perspective)` — its
 *  depth under a perspective projection, 1 under an orthographic one (`EngineCamera.perspective`). */
export const clipWeight = (perspective: number, depth: number) =>
  perspective * depth + (1 - perspective)
