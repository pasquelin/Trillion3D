/**
 * THE WEIGHT OF THE K HEAVIEST ROWS of a landed histogram (`rowPageBound.ts`), pairs then commands:
 * a sun's bins each read at their least s and greatest e over this frame's levels (`sunWeights`),
 * the joint bins of the full-map lights at their edges (`Ascending`). Weights are counts (pages,
 * commands), whole numbers: every sum is exact, in any order.
 */
import { lastTrue } from '../../../math/src/scalar/search.ts'
import { BIN_SPAN, E_BINS, eMost, S_BINS, sideOf, sLeast } from './rowBins.ts'

/** The weight of the k heaviest rows. */
export interface Top {
  top(k: number): number
}

/** The rows of a sun's bins by weight, heaviest first, as prefix sums over that order. Its arrays
 *  are kept and refilled (`fill`). Each bin's key `weight · BIN_SPAN + bin` sorts as a number, with
 *  no comparator; bins of one weight take any order among themselves, which changes no top. */
export class Heaviest implements Top {
  private n = 0
  private rows = new Float64Array(1)
  private sums = new Float64Array(1)
  private weight = new Float64Array(0)
  private order = new Float64Array(0)
  fill(weight: Float64Array, rows: Uint32Array, n: number) {
    if (this.weight.length < n) {
      this.rows = new Float64Array(n + 1)
      this.sums = new Float64Array(n + 1)
      this.weight = new Float64Array(n)
      this.order = new Float64Array(n)
    }
    this.n = n
    const order = this.order.subarray(0, n)
    for (let i = 0; i < n; i++) order[i] = weight[i] * BIN_SPAN + i
    order.sort()
    this.rows[0] = this.sums[0] = 0
    for (let i = 0; i < n; i++) {
      const t = order[n - 1 - i] % BIN_SPAN
      this.weight[i] = weight[t]
      this.rows[i + 1] = this.rows[i] + rows[t]
      this.sums[i + 1] = this.sums[i] + rows[t] * weight[t]
    }
    return this
  }
  top(k: number) {
    const { rows, sums, weight, n } = this
    if (k >= rows[n]) return sums[n]
    const lo = lastTrue(0, n, (mid) => rows[mid] <= k)
    return sums[lo] + (k - rows[lo]) * weight[lo]
  }
}

/** The weight of the k heaviest rows of `counts`, a row of bin i weighing `edges[i] · scale`, at
 *  most `most`, which grows with i: read from the top bin down, no sort. */
export class Ascending implements Top {
  most = Infinity
  counts: Uint32Array
  private readonly edges: Float64Array
  private readonly scale: number
  constructor(edges: Float64Array, scale: number) {
    this.counts = new Uint32Array(edges.length)
    this.edges = edges
    this.scale = scale
  }
  top(k: number) {
    const { counts, edges, scale, most } = this
    let sum = 0
    for (let i = counts.length - 1; i >= 0 && k > 0; i--) {
      const n = Math.min(counts[i], k)
      sum += n * Math.min(edges[i] * scale, most)
      k -= n
    }
    return sum
  }
}

/** At most `rows` rows weighing `weight` each: the rows a histogram cannot place. */
export class Unplaced implements Top {
  rows = 0
  weight = 0
  top(k: number) {
    return Math.min(k, this.rows) * this.weight
  }
}

// Each non-empty bin's pairs and commands a row and its rows (`sunWeights`): `Heaviest` reads them.
const binPairs = new Float64Array(BIN_SPAN),
  binCmds = new Float64Array(BIN_SPAN),
  binHeld = new Uint32Array(BIN_SPAN)
let spans = new Float64Array(0),
  levelOrder = new Uint32Array(0)

/** Level i's reach with its room: an s past it meets the level no more. */
const reachOf = (levels: Float64Array, i: number) => levels[i * 4] + levels[i * 4 + 1]

/**
 * A sun's rows of `counts` (`BIN_SPAN` bins) as two tops, pairs then commands, over `levels` (four
 * numbers a level: its reach from the reference, its room, its page's width and height): each bin
 * read at its least s and greatest e. The levels a bin meets are those its least s does not pass:
 * in the order of their reach, farthest first (a reach NaN no s passes), a prefix, which shortens
 * as s grows. A bin's pages are then that prefix's sum of the pages its e spans.
 */
export function sunWeights(
  counts: Uint32Array,
  levels: Float64Array,
  pages: number,
  into: [Heaviest, Heaviest],
) {
  const count = levels.length / 4,
    stride = count + 1
  if (levelOrder.length < count) levelOrder = new Uint32Array(count)
  const order = levelOrder.subarray(0, count)
  for (let i = 0; i < count; i++) order[i] = i
  order.sort((a, b) => {
    const ra = reachOf(levels, a),
      rb = reachOf(levels, b)
    return Number.isNaN(ra) ? -1 : Number.isNaN(rb) ? 1 : rb - ra
  })
  // Pages a row of e-bin k spans over the first m levels of that order.
  if (spans.length < E_BINS * stride) spans = new Float64Array(E_BINS * stride)
  for (let k = 0; k < E_BINS; k++) {
    spans[k * stride] = 0
    for (let m = 0; m < count; m++) {
      const i = order[m],
        e = eMost[k] + levels[i * 4 + 1]
      spans[k * stride + m + 1] =
        spans[k * stride + m] + sideOf(e, levels[i * 4 + 2]) * sideOf(e, levels[i * 4 + 3])
    }
  }
  let n = 0,
    met = count
  for (let j = 0; j < S_BINS; j++) {
    while (met > 0 && sLeast[j] > reachOf(levels, order[met - 1])) met--
    for (let k = 0; k < E_BINS; k++) {
      const held = counts[j * E_BINS + k]
      if (held === 0) continue
      binPairs[n] = Math.min(spans[k * stride + met], pages)
      binCmds[n] = met
      binHeld[n++] = held
    }
  }
  into[0].fill(binPairs, binHeld, n)
  into[1].fill(binCmds, binHeld, n)
  return into
}
