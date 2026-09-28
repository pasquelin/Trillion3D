/** The clusters of the runtime cutter (`runtimeCut.ts`) and the texture spans that set its grid. */

/** A cluster holds at most this many triangles and vertices: the page format's cluster, the one
 *  the compiler cuts (`docs/FORMAT.md`). */
const CLUSTER_TRIANGLES = 128,
  CLUSTER_VERTICES = 255;

/** The widest range of either texture coordinate over the corners of one cluster; with no
 *  `indices`, a range runs over the vertices themselves. */
export function widestUvSpan(
  uvs: Float32Array,
  indices: Uint32Array | null,
  ranges: [number, number][],
) {
  let widest = 0;
  for (const [start, end] of ranges)
    for (let c = 0; c < 2; c++) {
      let lo = Infinity,
        hi = -Infinity;
      for (let i = start; i < end; i++) {
        const value = uvs[(indices ? indices[i] : i) * 2 + c];
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
      widest = Math.max(widest, hi - lo);
    }
  return widest;
}

/** The widest range of either texture coordinate over every vertex: the span the compiler sets a
 *  primitive's texture grid by (`primitive_uv_exponent`). */
export const primitiveUvSpan = (uvs: Float32Array) =>
  widestUvSpan(uvs, null, [[0, uvs.length / 2]]);

/** The index ranges a compiled primitive's own clusters take, `ends[k]` the end of cluster `k`. */
export const givenClusters = (ends: Uint32Array): [number, number][] =>
  Array.from(ends, (end, k) => [k ? ends[k - 1] : 0, end]);

/** Index ranges of consecutive triangles, each within the cluster's triangle and vertex bounds.
 *  A vertex is marked with the number of the cluster that last took it: no set per triangle. */
export function* clusters(indices: Uint32Array, vertexCount: number): Generator<[number, number]> {
  const taken = new Uint32Array(vertexCount);
  let start = 0,
    cluster = 1,
    held = 0;
  const take = (v: number) => {
    if (taken[v] === cluster) return;
    taken[v] = cluster;
    held++;
  };
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t],
      b = indices[t + 1],
      c = indices[t + 2];
    const fresh =
      Number(taken[a] !== cluster) +
      Number(taken[b] !== cluster && b !== a) +
      Number(taken[c] !== cluster && c !== a && c !== b);
    const full = (t - start) / 3 >= CLUSTER_TRIANGLES;
    if (full || held + fresh > CLUSTER_VERTICES) {
      yield [start, t];
      start = t;
      cluster++;
      held = 0;
    }
    take(a);
    take(b);
    take(c);
  }
  if (start < indices.length) yield [start, indices.length];
}
