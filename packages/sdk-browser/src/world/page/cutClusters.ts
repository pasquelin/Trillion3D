/** The texture spans that set the run-time cutter's grid (`runtimeCut.ts`), and a compiled
 *  primitive's own clusters; the clusters themselves are the compiler's clusterer's
 *  (`../../page/codec/clusterTriangles.ts`). */

/** The widest range of either texture coordinate over the corners of one cluster; with no
 *  `indices`, a range runs over the vertices themselves. */
export function widestUvSpan(
  uvs: Float32Array,
  indices: Uint32Array | null,
  ranges: [number, number][],
) {
  let widest = 0
  for (const [start, end] of ranges)
    for (let c = 0; c < 2; c++) {
      let lo = Infinity,
        hi = -Infinity
      for (let i = start; i < end; i++) {
        const value = uvs[(indices ? indices[i] : i) * 2 + c]
        lo = Math.min(lo, value)
        hi = Math.max(hi, value)
      }
      widest = Math.max(widest, hi - lo)
    }
  return widest
}

/** The widest range of either texture coordinate over every vertex: the span the compiler sets a
 *  primitive's texture grid by (`primitive_uv_exponent`). */
export const primitiveUvSpan = (uvs: Float32Array) => widestUvSpan(uvs, null, [[0, uvs.length / 2]])

/** The index ranges a compiled primitive's own clusters take, `ends[k]` the end of cluster `k`. */
export const givenClusters = (ends: Uint32Array): [number, number][] =>
  Array.from(ends, (end, k) => [k ? ends[k - 1] : 0, end])
