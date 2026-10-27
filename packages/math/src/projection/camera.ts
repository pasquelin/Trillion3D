import { DEG2RAD, HALF_MAX } from '../constants.ts'
import { FRUSTUM_PLANE_VALUES, frustumPlanesFromMatrix } from '../geometry/frustum/frustum.ts'
import {
  determinantMatrix4,
  IDENTITY_MATRIX4,
  multiplyMatrix4,
  type NumberSink,
} from '../matrix/matrix4.ts'
import { invertMatrix4 } from '../matrix/matrix4Inverse.ts'
import { clampCompare } from '../scalar/reals.ts'
import { isZeroVector3, length2 } from '../vector/vector.ts'

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

/** The nearest and farthest distance an orthographic view draws, along its view. */
export interface DepthRange {
  near: number
  far: number
}

/** What the automatic range of an orthographic view reads of the view (`autoOrthoPlanes`), in
 *  centimetres. */
export interface AutoOrthoView {
  /** The vertical part of the unit direction the view looks along: ±1 straight down or up, 0 level. */
  forwardUp: number
  /** The width the box draws, and the picture's width over its height. */
  width: number
  aspect: number
  /** The distance from the view's origin to the point it frames; 0 where it frames none. */
  targetDistance: number
  /** The picture's size in pixels. */
  viewportWidth: number
  viewportHeight: number
}

/** What the automatic range reads of the settings (`autoOrthoPlanes`), in centimetres. */
export interface AutoOrthoSettings {
  /** Whether the far plane is scaled by the size of a pixel in the world, for depth kept in half
   *  floats, instead of by the view's angle alone. */
  halfFloatDepth: boolean
  /** Whether that scale follows the logarithm of the pixel's size, which lets the far plane reach
   *  the largest world; read where `halfFloatDepth` is. */
  scaleUnits: boolean
  /** The depth the half-float scale starts from where above 0, no more than the half float's own. */
  depthScale: number
  /** Both planes shifted along the view by this: positive away, negative toward. */
  shift: number
}

/** The reach of a world, in centimetres (2^21): the deepest an automatic range goes. */
const WORLD_MAX = 2097152
/** The reach of the largest world, in centimetres (2^43). */
const LARGE_WORLD_MAX = 8796093022208
/** The least a divisor of an automatic range is: a zero aspect ratio or a level view reads as this. */
const SMALL_DIVISOR = 1e-5
/** The cosine and the sine of an eighth of a turn, to seven digits: the bound the near plane's
 *  reach is taken at. */
const EIGHTH_TURN = 0.707107

/**
 * The near and far plane an orthographic view draws between when it works them out itself, written
 * into `range`, all in centimetres. In this order:
 *  1. `depth`, the depth the far plane scales from: the half float's largest value with
 *     `halfFloatDepth`, else the world's; `depthScale` above 0 replaces it, between 1 and that.
 *     `maxDepth` is the largest world's with `halfFloatDepth` and `scaleUnits`, else the world's.
 *  2. `height = width / aspect`, a zero aspect read as `SMALL_DIVISOR`; `cosine`, the unsigned
 *     `forwardUp`.
 *  3. The far plane. With `halfFloatDepth` and a picture to draw: the pixel, `height` over the
 *     picture's rows rounded down (its logarithm with `scaleUnits`), times `depth`, held between
 *     `depth` and `maxDepth`. Else `height / cosine`, a level view reading `SMALL_DIVISOR`.
 *  4. The arm, the distance to the framed point times `cosine`.
 *  5. The near plane: the larger of `width` and `height` times the greater of −0.5 and the clamp of
 *     `cosine` to [0.707107, 1] less the reciprocal of the clamp of `1 − cosine` to [0.707107, 1];
 *     less the arm.
 *  6. The far plane held between `height` and `maxDepth` past the near plane.
 *  7. Both shifted by `shift`.
 */
export function autoOrthoPlanes(
  range: DepthRange,
  view: AutoOrthoView,
  { halfFloatDepth, scaleUnits, depthScale, shift }: AutoOrthoSettings,
) {
  const scaled = scaleUnits && halfFloatDepth,
    maxDepth = scaled ? LARGE_WORLD_MAX : WORLD_MAX
  let depth = halfFloatDepth ? HALF_MAX : WORLD_MAX
  if (depthScale > 0) depth = clampCompare(depthScale, 1, depth)
  const height = view.width / (view.aspect === 0 ? SMALL_DIVISOR : view.aspect),
    cosine = Math.abs(view.forwardUp)
  let far: number
  if (halfFloatDepth && height > 0 && view.viewportWidth * view.viewportHeight > 0) {
    let pixel = Math.floor(height / view.viewportHeight)
    if (scaled) pixel = Math.log2(pixel)
    far = clampCompare(depth * pixel, depth, maxDepth)
  } else far = height / (cosine === 0 ? SMALL_DIVISOR : cosine)
  const arm = view.targetDistance * cosine,
    sine = clampCompare(1 - cosine, EIGHTH_TURN, 1),
    near =
      Math.max(view.width, height) *
        Math.max(clampCompare(cosine, EIGHTH_TURN, 1) - 1 / sine, -0.5) -
      arm
  range.near = near + shift
  range.far = clampCompare(far, height, maxDepth + near) + shift
}

/** What the correction of an orthographic view's planes reads (`correctOrthoPlanes`). */
export interface OrthoPlaneCorrection {
  /** The near plane the corrected view starts at, in metres. */
  nearPlane: number
  /** Whether a view that frames no target takes its height above the ground for one. */
  heightAsViewTarget: boolean
}

/**
 * An orthographic camera can stand far behind what it shows, with its near plane behind it. This
 * moves its origin onto the near plane and starts the range there, so the origin is no farther from
 * what is drawn than the range needs, and what resolves light at the origin's side of the picture
 * (the shadows' clipmaps among it) resolves it where the picture begins. In this order:
 *  1. `forward`, the unit direction the view looks along; the range's length is kept.
 *  2. A view that frames a target (`target`, the offset from the origin to it, in the world's
 *     axes, not zero) puts its origin onto the target, then along the view by `range.near`, and
 *     `target` is made the offset from that origin to the same point.
 *  3. A view that frames none (`target` zero) moves its origin along the view by `range.near`
 *     and, with `heightAsViewTarget`, by one more length: the origin's height (`world[13]`) or
 *     `halfWidth`, the box's half width as drawn, the lesser, taken without its sign, times the
 *     view's slope against the vertical.
 *  4. The range starts at `nearPlane` and ends as far on as it was long.
 * `world` (column-major) has its translation moved; `target` and `range` are rewritten.
 */
export function correctOrthoPlanes(
  world: Float64Array,
  forward: ArrayLike<number>,
  target: Float64Array,
  range: DepthRange,
  halfWidth: number,
  { nearPlane, heightAsViewTarget }: OrthoPlaneCorrection,
) {
  const length = range.far - range.near
  if (!isZeroVector3(target)) {
    for (let axis = 0; axis < 3; axis++) {
      const place = world[12 + axis] + target[axis]
      world[12 + axis] += target[axis] + forward[axis] * range.near
      target[axis] = place - world[12 + axis]
    }
  } else {
    const height = heightAsViewTarget
      ? Math.abs(Math.min(world[13], halfWidth)) * Math.abs(forward[1])
      : 0
    for (let axis = 0; axis < 3; axis++) world[12 + axis] += forward[axis] * (height + range.near)
  }
  range.near = nearPlane
  range.far = nearPlane + length
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
