/**
 * Per-vertex normals from the faces around each vertex: the cross product of two edges is the
 * face normal scaled by twice its area, so summing them weights each face by its area before the
 * final normalisation. A vertex no face reaches keeps a zero normal. Written into `normals` when
 * given — a list rewritten every frame allocates nothing (#573).
 */
export function computeNormals<T extends Float32Array | Float64Array = Float32Array>(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  normals = new Float32Array(Math.floor(positions.length / 3) * 3) as T,
): T {
  const vertexCount = Math.floor(positions.length / 3);
  normals.fill(0);
  const corners = index ? index.length : vertexCount;
  for (let k = 0; k + 2 < corners; k += 3) {
    const a = (index ? index[k] : k) * 3,
      b = (index ? index[k + 1] : k + 1) * 3,
      c = (index ? index[k + 2] : k + 2) * 3;
    const ax = positions[a],
      ay = positions[a + 1],
      az = positions[a + 2];
    const e1x = positions[b] - ax,
      e1y = positions[b + 1] - ay,
      e1z = positions[b + 2] - az;
    const e2x = positions[c] - ax,
      e2y = positions[c + 1] - ay,
      e2z = positions[c + 2] - az;
    const nx = e1y * e2z - e1z * e2y,
      ny = e1z * e2x - e1x * e2z,
      nz = e1x * e2y - e1y * e2x;
    // Corner by corner, as a repeated index sums twice.
    normals[a] += nx;
    normals[a + 1] += ny;
    normals[a + 2] += nz;
    normals[b] += nx;
    normals[b + 1] += ny;
    normals[b + 2] += nz;
    normals[c] += nx;
    normals[c + 1] += ny;
    normals[c + 2] += nz;
  }
  // `normalizeVector3` written out on this one array: a zero sum stays zero, scaled by one.
  for (let v = 0; v < normals.length; v += 3) {
    const x = normals[v],
      y = normals[v + 1],
      z = normals[v + 2],
      inverse = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    normals[v] = x * inverse;
    normals[v + 1] = y * inverse;
    normals[v + 2] = z * inverse;
  }
  return normals;
}
