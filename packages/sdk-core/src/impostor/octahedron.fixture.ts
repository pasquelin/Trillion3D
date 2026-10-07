/**
 * The octahedral mapping of the impostor atlas on the CPU: a port of the compiler's
 * `packages/asset-compiler-rust/src/impostor/octahedron.rs` (and its tests), used as the oracle the
 * runtime's WGSL card is proven against. Object space, +Y up, pivot at the bounding-sphere
 * centre. Direction `d` to the plane `[-1, 1]²`, the full octahedron or the upper hemi-octahedron.
 */

import { unit } from '../../../math/src/vector/vectorTuple.ts'

/** ±1, never 0: the fold of the lower half needs a side even on an axis, where `sign(0) = 0`. */
function side(x: number): number {
  return x < 0 ? -1 : 1
}

/** Direction `d` to the plane `[-1, 1]²`: the full octahedron, or the upper hemi-octahedron. */
export function octEncode(d: readonly number[], hemi: boolean): [number, number] {
  if (hemi) {
    const y = Math.max(d[1], 0)
    const norm = Math.abs(d[0]) + y + Math.abs(d[2])
    if (norm <= 0) return [0, 0]
    const x = d[0] / norm,
      z = d[2] / norm
    return [x + z, z - x]
  }
  const norm = Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2])
  const o = [d[0] / norm, d[1] / norm, d[2] / norm]
  if (o[1] < 0) return [side(o[0]) * (1 - Math.abs(o[2])), side(o[2]) * (1 - Math.abs(o[0]))]
  return [o[0], o[2]]
}

/** Grid coordinates `f ∈ [0, 1]²` back to a unit direction, the inverse of `octEncode`. */
export function octDecode(f: readonly number[], hemi: boolean): [number, number, number] {
  if (hemi) {
    const x = f[0] - f[1],
      z = f[0] + f[1] - 1
    return unit([x, 1 - Math.abs(x) - Math.abs(z), z])
  }
  const u = f[0] * 2 - 1,
    v = f[1] * 2 - 1,
    y = 1 - Math.abs(u) - Math.abs(v)
  // At `y = 0` the fold is the identity bit for bit: `u = 2f − 1` is exact, so is `1 − |u|`, and
  // `1 − |v|` gives `|u|` back; `y <= 0` would draw the same equator.
  if (y < 0) return unit([side(u) * (1 - Math.abs(v)), y, side(v) * (1 - Math.abs(u))])
  return unit([u, y, v])
}

/** The three frames a view at grid position `g` blends, and their barycentric weights. */
export function cellWeights(
  g: readonly number[],
  n: number,
): Array<{ frame: [number, number]; weight: number }> {
  const last = n - 1,
    i = Math.min(Math.floor(g[0]), last - 1),
    j = Math.min(Math.floor(g[1]), last - 1),
    fx = g[0] - i,
    fy = g[1] - j,
    middle: [number, number] = fx > fy ? [i + 1, j] : [i, j + 1]
  return [
    { frame: [i, j], weight: Math.min(1 - fx, 1 - fy) },
    { frame: middle, weight: Math.abs(fx - fy) },
    { frame: [i + 1, j + 1], weight: Math.min(fx, fy) },
  ]
}
