import { DEG2RAD, RAD2DEG } from '../../../../math/src/constants.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import {
  PLANAR_REFLECTION_EXTENT,
  type ResolvedPlanarReflection,
} from '../../../../sdk-core/src/scene/planarReflection/contracts.ts'

/**
 * THE GEOMETRY OF A PLANAR REFLECTION, in the world's metres: the plane its object stands for, the box that bounds what it reflects for, and
 * the camera the mirrored view is drawn from.
 *
 * The mirrored view is the main camera reflected across the plane. A reflection turns the camera's frame inside out (its determinant
 * is -1), which a renderer's winding and culling do not take; the frame is turned back by negating its right axis, so the mirrored view
 * is the true mirror image flipped left to right, and a reader of the image flips the screen's horizontal back (`mirrorFlip`).
 */

/** The plane of a planar reflection and the box it reaches over. */
export interface PlanarPlane {
  /** A point of the plane, and its unit normal (the side the viewer must stand on). */
  readonly origin: readonly [number, number, number]
  readonly normal: readonly [number, number, number]
  /** The plane's offset: the normal dotted with the origin, so a point is on the plane where `normal . p = w`. */
  readonly w: number
  /** The plane's two axes: unit directions, and the half extents the box reaches along them. */
  readonly xAxis: readonly [number, number, number]
  readonly xReach: number
  readonly zAxis: readonly [number, number, number]
  readonly zReach: number
  /** How far the box reaches along the normal: the fade-out distance, times the length of the normal's column. */
  readonly normalReach: number
}

const unit = (matrix: readonly number[], at: number): [[number, number, number], number] => {
  const length = length3(matrix[at], matrix[at + 1], matrix[at + 2])
  return [[matrix[at] / length, matrix[at + 1] / length, matrix[at + 2] / length], length]
}

/** The plane of `reflection` (its object's local XZ plane, the second column its normal) and the box around it; the resolved matrix has no column of no length. */
export function planarPlane(reflection: ResolvedPlanarReflection): PlanarPlane {
  const m = reflection.matrix
  const [xAxis, xLength] = unit(m, 0)
  const [zAxis, zLength] = unit(m, 8)
  const [normal, normalLength] = unit(m, 4)
  return {
    origin: [m[12], m[13], m[14]],
    normal,
    w: normal[0] * m[12] + normal[1] * m[13] + normal[2] * m[14],
    xAxis,
    xReach: xLength * PLANAR_REFLECTION_EXTENT,
    zAxis,
    zReach: zLength * PLANAR_REFLECTION_EXTENT,
    normalReach: reflection.distanceFromPlaneFadeoutEnd * normalLength,
  }
}

/** The signed distance of the world point `(x, y, z)` to the plane, positive on the normal's side. */
export const planeDistance = (plane: PlanarPlane, x: number, y: number, z: number) =>
  plane.normal[0] * x + plane.normal[1] * y + plane.normal[2] * z - plane.w

/** Whether the box of `plane` meets the frustum of the six unit `planes` (a camera frame's, in their order): no plane has the whole box behind it. */
export function planarBoxInFrustum(plane: PlanarPlane, planes: ArrayLike<number>) {
  const { origin: o, normal: n, xAxis: x, zAxis: z } = plane
  for (let at = 0; at < 24; at += 4) {
    const a = planes[at],
      b = planes[at + 1],
      c = planes[at + 2]
    const reach =
      Math.abs(a * x[0] + b * x[1] + c * x[2]) * plane.xReach +
      Math.abs(a * z[0] + b * z[1] + c * z[2]) * plane.zReach +
      Math.abs(a * n[0] + b * n[1] + c * n[2]) * plane.normalReach
    if (a * o[0] + b * o[1] + c * o[2] + planes[at + 3] < -reach) return false
  }
  return true
}

/**
 * The world matrix (column-major) of the mirrored camera, written into `out`: the camera of `world` reflected across `plane`, its right axis
 * negated to give back a frame of determinant +1 (the mirrored view flipped left to right). `out` may be `world`.
 */
export function mirroredCameraMatrix(
  out: Float64Array,
  world: ArrayLike<number>,
  plane: Pick<PlanarPlane, 'origin' | 'normal'>,
) {
  const { origin: o, normal: n } = plane
  // Each column is reflected from its three numbers read at once (a column of `world` is never written before it is read, `out` may be `world`);
  // a point (the eye) is reflected about the plane's origin, a direction about nothing.
  const put = (at: number, sign: number, about: readonly number[]) => {
    const x = world[at],
      y = world[at + 1],
      z = world[at + 2]
    const k = 2 * (n[0] * (x - about[0]) + n[1] * (y - about[1]) + n[2] * (z - about[2]))
    out[at] = sign * (x - k * n[0])
    out[at + 1] = sign * (y - k * n[1])
    out[at + 2] = sign * (z - k * n[2])
  }
  put(0, -1, NOWHERE)
  put(4, 1, NOWHERE)
  put(8, 1, NOWHERE)
  put(12, 1, o)
  out[3] = out[7] = out[11] = 0
  out[15] = 1
  return out
}

/** The point a direction is reflected about: none. */
const NOWHERE = [0, 0, 0] as const

/** The widest half field the mirrored camera is given: 89.5 degrees, where the tangent still means something. */
const MOST_HALF_FIELD = 89.5 * DEG2RAD

/**
 * The optics of the mirrored camera: the main view's horizontal half field widened by `extraFov` degrees, the picture's shape kept. `projection`
 * is the main engine projection (column-major): its first and sixth entries are the x and y scales. Returns the vertical field in degrees.
 */
export function widenedField(projection: ArrayLike<number>, aspect: number, extraFov: number) {
  const half = Math.min(Math.atan(1 / projection[0]) + extraFov * DEG2RAD, MOST_HALF_FIELD)
  return 2 * Math.atan(Math.tan(half) / aspect) * RAD2DEG
}

/** The size of the planar image for a main view drawn at `width × height` pixels and `percentage` (25 to 100): the share of each side, rounded up, at least 1. */
export const planarImageSize = (width: number, height: number, percentage: number) => {
  const share = clamp(percentage / 100, 0.25, 1)
  return [
    clamp(Math.ceil(width * share), 1, width),
    clamp(Math.ceil(height * share), 1, height),
  ] as const
}
