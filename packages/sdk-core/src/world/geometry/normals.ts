import { normalizeVector3 } from '../../math/primitives/vector.ts';

/**
 * Per-vertex normals from the faces around each vertex: the cross product of two edges is the
 * face normal scaled by twice its area, so summing them weights each face by its area before the
 * final normalisation. A vertex no face reaches keeps a zero normal.
 */
export function computeNormals(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
): Float32Array {
  const vertexCount = Math.floor(positions.length / 3);
  const normals = new Float32Array(vertexCount * 3);
  const corners = index ? index.length : vertexCount;
  const at = (k: number) => (index ? index[k] : k);
  for (let k = 0; k + 2 < corners; k += 3) {
    const a = at(k) * 3,
      b = at(k + 1) * 3,
      c = at(k + 2) * 3;
    const e1x = positions[b] - positions[a],
      e1y = positions[b + 1] - positions[a + 1],
      e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a],
      e2y = positions[c + 1] - positions[a + 1],
      e2z = positions[c + 2] - positions[a + 2];
    const nx = e1y * e2z - e1z * e2y,
      ny = e1z * e2x - e1x * e2z,
      nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }
  // A zero sum stays zero: `normalizeVector3` scales it by one.
  for (let v = 0; v < normals.length; v += 3) normalizeVector3(normals, v);
  return normals;
}
