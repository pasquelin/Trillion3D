import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { CENTIMETRES_PER_METRE } from '../../../../../sdk-core/src/page/format.ts'
import { dotScalar3, length3 } from '../../../../../math/src/vector/vector.ts'

/**
 * The geometry of a surface's thickness (`screenBack`), written into the four words of `out` from `at` on (nothing is
 * allocated: the staged view of a frame, `createReflectionViewWriter`, takes it straight), under the view-projection `m`
 * (column-major) of an image `height` pixels high, the eye at `eye` (the world `m` takes):
 * `[scale, y, z, perspective]`, a pixel `scale` wide at a unit clip `w` — 2 / (height · |row y of
 * the view-projection|), the projection's vertical scale. A clip depth is affine in the point,
 * `z_c = a · w_view + b`, and the clip `w` is `c · w_view + e`. Under a perspective (`c` not zero)
 * the depth is `A + B / w`, with `A = a / c` the depth at an infinite distance (`y`) and `B`
 * (`z`) its numerator over the distance in world units, `w / |c|`. Under an orthographic
 * projection a pixel spans `scale · |a|` of depth (`z`), at every distance, and `y` is the depth
 * of the eye's plane, the clip depth at the eye. A translation changes neither gradient: the
 * matrix of a shifted world, with the eye shifted likewise, gives the same words.
 */
export function screenSlabInto(
  out: { [index: number]: number },
  at: number,
  m: ArrayLike<number>,
  height: number,
  eye: ArrayLike<number>,
) {
  const scale = 2 / (height * length3(m[1], m[5], m[9]))
  out[at] = scale
  // The clip depth's gradient (row z: m[2], m[6], m[10]) and the clip w's (row w: m[3], m[7], m[11]).
  const perspective = m[3] !== 0 || m[7] !== 0 || m[11] !== 0
  if (!perspective) {
    out[at + 1] = dotScalar3(m[2], m[6], m[10], eye[0], eye[1], eye[2]) + m[14]
    out[at + 2] = scale * length3(m[2], m[6], m[10])
    out[at + 3] = 0
    return
  }
  const infinite =
    dotScalar3(m[2], m[6], m[10], m[3], m[7], m[11]) /
    dotScalar3(m[3], m[7], m[11], m[3], m[7], m[11])
  out[at + 1] = infinite
  out[at + 2] = (m[14] - infinite * m[15]) / length3(m[3], m[7], m[11])
  out[at + 3] = 1
}

/**
 * The angle one pixel spans at the eye (`eyeToPixelSpread`), the reference's `EyeToPixelSpreadAngle`: the arctangent of
 * 2 · tan(half the horizontal field of view) over the image's HEIGHT in pixels — the horizontal field of view the
 * view-projection `m` (column-major) holds in its row x, the projection's horizontal scale —, none under an orthographic projection, which has no field of view.
 */
export function eyeToPixelSpread(m: ArrayLike<number>, height: number) {
  if (m[3] === 0 && m[7] === 0 && m[11] === 0) return 0
  return Math.atan(2 / (height * length3(m[0], m[4], m[8])))
}

/**
 * The thickness the reference walk (`screenMarchReference`) gives a surface under the view-projection
 * `m`: `relative` (`reflectionRelativeDepthThickness`, `screenProbeRelativeDepthThickness`) times the projection's depth scale. Under a
 * perspective the scale is 1. Under an orthographic projection depth does not shrink with distance,
 * so the scale falls with the depth range, a power of ten: ten to the minus whole digits of the
 * range's size past one, up to nine — a range of 1 or less keeps 1, one of 1000 gives 0.001. The
 * range is counted in centimetres (the world is in metres): 10 m is a range of 1000.
 */
export function screenRelativeThickness(m: ArrayLike<number>, relative: number) {
  if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0) return relative
  const range = CENTIMETRES_PER_METRE / length3(m[2], m[6], m[10])
  return relative * 10 ** -Math.trunc(clamp(Math.log10(range), 0, 9))
}
