// THE CONTRACT of the bins pass (`rowBinsWgsl.ts`), not its steps, as the oracle the bound's tests
// land their histograms from: over the parameters a frame asks (`rowBinsRequest`) and a scene's
// rows, each row's s and e worked in doubles with the pass's room, its bin the one whose edges hold
// them (`sLeast`, `eMost`), its joint sums the first edges at or above them, counted one by one —
// the histogram the GPU copies back, landed at once (`landRowBins`). And what the tests weigh a
// bound against: the sums of the k heaviest rows of the brute force.
import { CLUSTER_SPHERE_FLOATS } from '../gpu/shadow/sphereContract.ts'
import {
  BIN_SPAN,
  E_BINS,
  eMost,
  MEET_EDGES,
  PAIR_EDGES,
  ROOM,
  rowBinTables,
  S_TOP,
  sLeast,
} from './rowBins.ts'
import { rowBinsRequest } from './rowBinsParams.ts'
import { landRowBins } from './rowBinsRecord.ts'
import { ROW_BINS_HEAD, ROW_BINS_LAMP, ROW_BINS_SHAPE } from './rowBinsWgsl.ts'
import type { VsmBoundLight, VsmRowBound } from './rowPageBound.ts'
import type { SceneRows } from './rowPageBound.fixture.ts'

const tables = rowBinTables()

/** How many of the ascending `edges` are at most `v` (`strict`: below it). */
function edgesUnder(edges: ArrayLike<number>, v: number, strict: boolean) {
  let n = 0
  while (n < edges.length && (strict ? edges[n] < v : edges[n] <= v)) n++
  return n
}

/** The (s, e) bin of the sphere `c` (high then low halves), radius `r`, by the shape at `at`: s
 *  the light-space Chebyshev distance to the reference less the extent, both widened by the room,
 *  in the bin whose least s is at most it and whose greatest e exceeds e. */
function binOf(p: Uint32Array, w: Float32Array, at: number, c: number[], r: number) {
  const d = [0, 1, 2].map((a) => c[a] - w[at + 9 + a] + (c[3 + a] - w[at + 12 + a]))
  const dot = (o: number) => w[at + o] * d[0] + w[at + o + 1] * d[1] + w[at + o + 2] * d[2]
  const x = dot(0),
    y = dot(3),
    z = dot(6)
  const rr = r * w[at + 15],
    e = rr + 2 * ROOM * (w[at + 16] * (Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2])) + rr)
  const reach = Math.max(Math.abs(x), Math.abs(y))
  // A row leaving the pyramid past every range lies in the last s bin.
  const s =
    p[at + 17] !== 0 && reach - z > 2 * e ? S_TOP : Math.max(reach, Math.abs(z)) - 2 * e + rr
  const j = edgesUnder(sLeast, s, false) - 1,
    k = Math.min(E_BINS - 1, edgesUnder(eMost, e, false))
  return j * E_BINS + k
}

/** The first of `edges` at or above `v`. */
const edgeAbove = (edges: ArrayLike<number>, v: number) => edgesUnder(edges, v, true)

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
      r = pop ? p[b + 3] + w[4] : p[b + 3]
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
      const met = params[at + 17] ? 1 : j >= tables[BIN_SPAN + k] ? 3 : 6
      meets += met
      pairs += met * tables[bin]
    }
    const n = PAIR_EDGES.length
    out[joint + pop * n + edgeAbove(PAIR_EDGES, pairs)]++
    out[joint + 2 * n + pop * MEET_EDGES.length + edgeAbove(MEET_EDGES, meets)]++
  }
  return out
}

const STAND_IN = {} as GPUBuffer
/** What the pass reads of `rows`: their spheres, on stand-in buffers the histogram never reads
 *  here (`binRows` reads the rows). */
export const onBuffers = (rows: SceneRows) => ({
  spheres: STAND_IN,
  mobility: STAND_IN,
  rowSpheres: rows.spheres,
})

/** The bins pass of `bound` over rows `[first, end)` of `rows` under `lights`, landed at once:
 *  whether one was asked. */
export function landBins(
  bound: VsmRowBound,
  rows: SceneRows,
  range: { first: number; end: number },
  lights: readonly VsmBoundLight[],
) {
  const request = rowBinsRequest(bound.bins, onBuffers(rows), range, lights)
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
