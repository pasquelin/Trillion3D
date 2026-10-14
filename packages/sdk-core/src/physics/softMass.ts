/**
 * THE MASS A SOFT BODY'S VERTICES HOLD (`soft.ts`): each its share of the scaled area of the
 * triangles it corners — a rope's vertex, of the length of the segments it ends.
 */
import { EngineError } from '../contracts/cache.ts'
import type { XYZLike } from '../world/math/likes.ts'
import { crossVector3, length3 } from '../../../math/src/vector/vector.ts'
import { SOFT_VERTEX_WORDS } from './softLayout.ts'

const edgeU = new Float64Array(3),
  edgeV = new Float64Array(3)

/** Writes in each vertex's mass word the scaled area (no triangle: length) it holds; returns the
 *  whole. Each scaled edge is written into a scratch vector, the cross product into the first:
 *  the operations of fresh arrays, in their order, with no array made per triangle. */
export function spreadMass(vertices: Float32Array, indices: number[], count: number, s: XYZLike) {
  const scale = [s.x, s.y, s.z]
  /** `out` = the scaled edge from vertex `a` to vertex `b`. */
  const edge = (out: Float64Array, a: number, b: number) => {
    for (let k = 0; k < 3; k++)
      out[k] =
        vertices[b * SOFT_VERTEX_WORDS + k] * scale[k] -
        vertices[a * SOFT_VERTEX_WORDS + k] * scale[k]
    return out
  }
  const share = (i: number, amount: number) => (vertices[i * SOFT_VERTEX_WORDS + 3] += amount)
  let whole = 0
  if (!indices.length)
    for (let i = 0; i + 1 < count; i++) {
      const u = edge(edgeU, i, i + 1),
        length = length3(u[0], u[1], u[2])
      share(i, length / 2)
      share(i + 1, length / 2)
      whole += length
    }
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]]
    const n = crossVector3(edgeU, edge(edgeU, a, b), edge(edgeV, a, c)),
      area = length3(n[0], n[1], n[2]) / 2
    share(a, area / 3)
    share(b, area / 3)
    share(c, area / 3)
    whole += area
  }
  if (!(whole > 0)) throw new EngineError('PHYSICS_FAILED', 'A soft body has no area or length.')
  return whole
}
