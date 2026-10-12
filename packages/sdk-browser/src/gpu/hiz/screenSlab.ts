import { length3 } from '../../../../math/src/vector/vector.ts'

/**
 * The geometry of a surface's thickness (`screenBack`) under the view-projection `m`
 * (column-major) of an image `height` pixels high: `[scale, A, step, perspective]`, a pixel `scale`
 * wide at a unit clip `w` — 2 / (height · |row y of the view-projection|), the projection's
 * vertical scale. A clip depth is affine in the point, `z_c = a · w_view + b`, and the clip `w` is
 * `c · w_view + e`: under a perspective (`c` not zero) the depth is `A + B / w`, with `A = a / c`
 * the depth at an infinite distance; under an orthographic projection a pixel spans `scale · |a|`
 * of depth, at every distance. A translation changes neither gradient: the matrix of a shifted
 * world gives the same words.
 */
export function screenSlab(m: ArrayLike<number>, height: number) {
  const scale = 2 / (height * length3(m[1], m[5], m[9]))
  const gradientZ = [m[2], m[6], m[10]],
    gradientW = [m[3], m[7], m[11]]
  const perspective = gradientW.some((component) => component !== 0)
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  return [
    scale,
    perspective ? dot(gradientZ, gradientW) / dot(gradientW, gradientW) : 0,
    perspective ? 0 : scale * length3(gradientZ[0], gradientZ[1], gradientZ[2]),
    perspective ? 1 : 0,
  ]
}
