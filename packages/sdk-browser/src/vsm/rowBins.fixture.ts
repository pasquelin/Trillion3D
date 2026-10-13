// The bins pass on the CPU (`rowBinsWgsl.ts`), step for step in single precision, as the oracle the
// bound's tests land their histograms from: the parameters a frame asks (`rowBinsRequest`) over a
// scene's rows, the histogram the GPU would copy back, landed at once (`landRowBins`). And what
// the tests weigh a bound against: the sums of the k heaviest rows of the brute force.
import { f32Bits } from '../../../math/src/float/bits.ts'
import { CLUSTER_SPHERE_FLOATS } from '../gpu/shadow/sphereContract.ts'
import {
  BIN_SPAN,
  E_BINS,
  E_TOP,
  MEET_EDGES,
  PAIR_EDGES,
  ROOM,
  rowBinTables,
  S_TOP,
  TABLE_DEPTH,
  TABLE_MEET_EDGES,
  TABLE_PAIR_EDGES,
  UNIT,
  UNIT_BITS,
} from './rowBins.ts'
import { rowBinsRequest } from './rowBinsParams.ts'
import { landRowBins } from './rowBinsRecord.ts'
import { ROW_BINS_HEAD, ROW_BINS_LAMP, ROW_BINS_SHAPE } from './rowBinsWgsl.ts'
import type { VsmBoundLight, VsmRowBound } from './rowPageBound.ts'
import type { SceneRows } from './rowPageBound.fixture.ts'

const f = Math.fround
const tables = rowBinTables()

/** The (s, e) bin of the sphere `c` (high then low halves), radius `r`, by the shape at `at`. */
function binOf(p: Uint32Array, w: Float32Array, at: number, c: number[], r: number) {
  const d = [0, 1, 2].map((a) => f(f(c[a] - w[at + 9 + a]) + f(c[3 + a] - w[at + 12 + a])))
  const dot = (o: number) =>
    f(f(f(w[at + o] * d[0]) + f(w[at + o + 1] * d[1])) + f(w[at + o + 2] * d[2]))
  const x = dot(0),
    y = dot(3),
    z = dot(6)
  const rr = f(r * w[at + 15]),
    l1 = f(f(Math.abs(d[0]) + Math.abs(d[1])) + Math.abs(d[2]))
  const e = f(rr + f(f(2 * ROOM) * f(f(w[at + 16] * l1) + rr)))
  const reach = Math.max(Math.abs(x), Math.abs(y))
  let least = f(f(Math.max(reach, Math.abs(z)) - e) - f(e - rr))
  if (p[at + 17] !== 0 && f(reach - z) > f(2 * e)) least = S_TOP
  const s = least >= UNIT ? Math.min(least, S_TOP) : 0
  const top = e < E_TOP ? e : E_TOP
  const j = (f32Bits(s) - UNIT_BITS) >> 21,
    k = (f32Bits(top) - UNIT_BITS) >> 22
  return (j < 0 ? 0 : j + 1) * E_BINS + (k < 0 ? 0 : k + 1)
}

/** The first of `n` edges at `at` of the tables at or above `v`: `v` itself below `exact`. */
function edgeOf(v: number, at: number, n: number, exact: number) {
  if (v < exact) return v
  let lo = exact,
    hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (tables[at + mid] >= v) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** The histogram of `words` words the pass writes for `params` over `rows`. */
export function binRows(params: Uint32Array, rows: SceneRows, words: number) {
  const w = new Float32Array(params.buffer, params.byteOffset, params.length)
  const [first, end, suns, lamps] = params,
    joint = params[5],
    out = new Uint32Array(words)
  for (let row = first; row < end; row++) {
    const b = row * CLUSTER_SPHERE_FLOATS,
      p = rows.packed
    const c = [p[b], p[b + 1], p[b + 2], p[b + 4], p[b + 5], p[b + 6]],
      pop = rows.moving[row] ? 1 : 0,
      r = pop ? f(p[b + 3] + w[4]) : p[b + 3]
    for (let s = 0; s < suns; s++)
      out[(s * 2 + pop) * BIN_SPAN + binOf(params, w, ROW_BINS_HEAD + s * ROW_BINS_SHAPE, c, r)]++
    if (!lamps) continue
    let pairs = 0,
      meets = 0
    for (let l = 0; l < lamps; l++) {
      const at = ROW_BINS_HEAD + suns * ROW_BINS_SHAPE + l * ROW_BINS_LAMP,
        bin = binOf(params, w, at, c, r)
      const j = Math.floor(bin / E_BINS),
        k = bin % E_BINS
      if (j >= params[at + ROW_BINS_SHAPE + k]) continue
      const met = params[at + 17] ? 1 : j >= tables[TABLE_DEPTH + k] ? 3 : 6
      meets += met
      pairs += met * tables[bin]
    }
    const n = PAIR_EDGES.length
    out[joint + pop * n + edgeOf(pairs, TABLE_PAIR_EDGES, n, 128)]++
    const m = MEET_EDGES.length
    out[joint + 2 * n + pop * m + edgeOf(meets, TABLE_MEET_EDGES, m, 64)]++
  }
  return out
}

/** The bins pass of `bound` over rows `[first, end)` of `rows` under `lights`, landed at once:
 *  whether one was asked. */
export function landBins(
  bound: VsmRowBound,
  rows: SceneRows,
  range: { first: number; end: number },
  lights: readonly VsmBoundLight[],
) {
  const request = rowBinsRequest(bound.bins, rows.spheres, range, lights)
  if (!request) return false
  const counts = binRows(request.params, rows, request.tag.words)
  landRowBins(bound.bins, request.tag, counts.buffer)
  return true
}

/** Sums of the k largest of `v`, for every k (index k). */
export function topSums(v: Float64Array) {
  const sorted = Float64Array.from(v).sort().reverse()
  const out = new Float64Array(v.length + 1)
  for (let k = 0; k < v.length; k++) out[k + 1] = out[k] + sorted[k]
  return out
}
