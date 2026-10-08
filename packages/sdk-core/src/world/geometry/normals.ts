import { normalizeVector3 } from '../../../../math/src/vector/vector.ts'
import { triangleCross } from '../../../../math/src/geometry/triangle.ts'

/** One face's edge cross product, reused across faces. */
const face = new Float64Array(3)

/**
 * Per-vertex normals from the faces around each vertex: the cross product of two edges is the
 * face normal scaled by twice its area, so summing them weights each face by its area before the
 * final normalisation. A vertex no face reaches keeps a zero normal. Written into `normals` when
 * given — a list rewritten every frame allocates nothing.
 */
export function computeNormals<T extends Float32Array | Float64Array = Float32Array>(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  normals = new Float32Array(Math.floor(positions.length / 3) * 3) as T,
): T {
  const vertexCount = Math.floor(positions.length / 3)
  normals.fill(0)
  const corners = index ? index.length : vertexCount
  for (let k = 0; k + 2 < corners; k += 3) {
    const a = (index ? index[k] : k) * 3,
      b = (index ? index[k + 1] : k + 1) * 3,
      c = (index ? index[k + 2] : k + 2) * 3
    triangleCross(face, 0, positions, a, b, c)
    const nx = face[0],
      ny = face[1],
      nz = face[2]
    // Corner by corner, as a repeated index sums twice.
    normals[a] += nx
    normals[a + 1] += ny
    normals[a + 2] += nz
    normals[b] += nx
    normals[b + 1] += ny
    normals[b + 2] += nz
    normals[c] += nx
    normals[c + 1] += ny
    normals[c + 2] += nz
  }
  for (let v = 0; v < normals.length; v += 3) normalizeVector3(normals, v)
  return normals
}
