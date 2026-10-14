/**
 * Oracle D1/D2: `viewProj * world` product computed once and re-read for multiple vertices, against
 * the same product recomputed for each vertex. Both shaders (packages/sdk-browser/src/gpu/raster/shader.ts,
 * packages/sdk-browser/src/visibility/shader/visWgsl.ts) apply exactly this transformation; this
 * module applies it with the maths library's product and point transform (column-major, like WGSL)
 * on hostile matrices — mirrored, near-singular, large scale — without depending on GPU execution.
 */
import { multiplyMatrix4 } from '../../../packages/math/src/matrix/matrix4.ts'
import { transformHomogeneousPoint } from '../../../packages/math/src/vector/vector.ts'

export type Mat4 = readonly number[] // 16 numbers, column-major: m[col*4+row]
export type Point = readonly [number, number, number]

const product = (a: Mat4, b: Mat4) =>
  multiplyMatrix4(new Float64Array(16), Float64Array.from(a), Float64Array.from(b))
const project = (m: ArrayLike<number>, [x, y, z]: Point) =>
  transformHomogeneousPoint(new Float64Array(4), m, x, y, z)

/** Product computed once (`vp`), applied to each vertex. */
export function hoisted(viewProj: Mat4, world: Mat4, points: readonly Point[]) {
  const vp = product(viewProj, world)
  return points.map((p) => project(vp, p))
}

/** Product recomputed for each vertex — legacy kernel replaced by D1/D2. */
export function perVertex(viewProj: Mat4, world: Mat4, points: readonly Point[]) {
  return points.map((p) => project(product(viewProj, world), p))
}

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
/** Mirror on X: negative determinant, like an imported cluster with negative scale. */
export const MIRROR_X: Mat4 = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, -5, 1]
/** Near-singular: column nearly collinear to another. */
export const NEAR_SINGULAR: Mat4 = [
  1,
  0,
  0,
  0,
  1 + 1e-9,
  1e-9,
  0,
  0,
  0,
  0,
  1e-6,
  0,
  10,
  -10,
  100,
  1,
]
/** Large scale, like a world imported in millimeters then composed with a distant camera. */
export const LARGE_SCALE: Mat4 = [1e5, 0, 0, 0, 0, 1e5, 0, 0, 0, 0, 1e5, 0, -1e6, 2e6, 3e6, 1]
