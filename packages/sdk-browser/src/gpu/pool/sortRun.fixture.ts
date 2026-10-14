// The shipped pool sort (`sortWgsl.ts`) run in JavaScript, stage by stage, workgroup by workgroup:
// each stage's text between two barriers is a function of its own, run for every lane before the
// next part starts, the workgroups and the lanes in an order `shuffle` draws — as a GPU may run
// them. Only the glue of each entry point is written here: who calls the parts, and the lane scan.
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import type { WgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { POOL_RANKS } from './rank.ts'
import { POOL_SORT_BOUND } from './sortWords.ts'

const LANES = 256,
  THREADS = 64
const BARRIER = Symbol('barrier')

/** The sort's parts, and the host's words they read. */
type Parts = {
  poolCount: (id: number[], n: number[], lane: number) => void
  poolPlaceSum: (span: number[]) => number
  poolPlaceRun: (span: number[], first: number) => number
  poolPlaceTotal: (total: number) => void
  poolGroupRun: (g: number, lane: number, bound: number) => number[]
  poolGroupAt: (g: number, half: number) => number
  poolOffsetSum: (span: number[], half: number) => number
  poolOffsetRun: (span: number[], half: number, first: number) => void
  poolSpreadRun: (g: number, lane: number, bound: number, first: number[]) => void
  poolStagedCount: () => number
  poolStagedAt: (i: number, staged: number) => number[]
  poolChunkPeers: (lane: number, rank: number) => number[]
  poolChunkTake: (entry: number[], at: number, peers: number[]) => void
  poolCountLoad: (i: number) => number
  poolScratchLoad: (i: number) => number
  poolScratchStore: (i: number, v: number) => void
  poolSlotCount: () => number
  laneRun: (lane: number, len: number) => number[]
}

/** The parts the sort runs, beside the host's `names`. */
const SORT_PARTS = [
  'poolCount',
  'poolRankAt',
  'poolPlaceSum',
  'poolPlaceRun',
  'poolPlaceTotal',
  'poolSlotPart',
  'poolGroupRun',
  'poolGroupAt',
  'poolOffsetSum',
  'poolOffsetRun',
  'poolSpreadRun',
  'poolStagedCount',
  'poolStagedAt',
  'poolChunkPeers',
  'poolChunkTake',
  'laneRun',
  'flatIndex',
]

/** `0 … count − 1` in an order `random` draws. */
function order(count: number, random: () => number) {
  const out = Array.from({ length: count }, (_, i) => i)
  for (let i = count - 1; i > 0; i--) {
    const k = Math.floor(random() * (i + 1))
    ;[out[i], out[k]] = [out[k], out[i]]
  }
  return out
}

/** The exclusive prefix of `values` and their total: what the lane scan gives each lane. */
function scan(values: number[]) {
  let total = 0
  const before = values.map((v) => ((total += v), total - v))
  return { before, total }
}

/**
 * One sort of `code` over `slots` dispatched slots: `names` are the host's functions in the text,
 * `scope` its bindings and stand-ins. The workgroups and lanes of each part run in the order
 * `random` draws.
 */
export function runPoolSort(
  code: WgslSource,
  names: string[],
  scope: object,
  slots: number,
  random: () => number,
) {
  const poolLocal = new Array<number>(POOL_RANKS).fill(0),
    poolChunk = new Array<number>(LANES).fill(0)
  const all = [...SORT_PARTS, ...names]
  const base = {
    ceilDiv: (a: number, n: number) => Math.ceil(a / n),
    poolLocal,
    poolChunk,
    ...scope,
  }
  // The count's halves either side of its barrier: every lane's local count, then every lane's
  // flush of the group's counts, a lane counting nothing. The host's words are its text's when
  // `names` lists them, else its `scope`'s.
  const run: Parts = {
    ...(scope as Partial<Parts>),
    ...shaderRun<Parts>(code, all, {
      ...base,
      workgroupBarrier() {
        throw BARRIER
      },
    }),
  }
  const flushing = shaderRun<Parts>(
    code,
    all.filter((name) => name !== 'poolSlotRank'),
    { ...base, workgroupBarrier() {}, poolSlotRank: () => POOL_RANKS },
  )
  const groups = Math.ceil(slots / LANES),
    n = [groups, 1, 1]
  for (const g of order(groups, random)) {
    poolLocal.fill(0)
    for (const lane of order(LANES, random))
      try {
        run.poolCount([g * LANES + lane, 0, 0], n, lane)
      } catch (stop) {
        if (stop !== BARRIER) throw stop
      }
    for (const lane of order(LANES, random)) flushing.poolCount([g * LANES + lane, 0, 0], n, lane)
  }
  const lanes = order(THREADS, random)
  // `poolPlace`: the runs summed, scanned, placed; the last lane's end the total.
  const placeSpans = lanes.map(() => [0, 0])
  for (const lane of lanes) placeSpans[lane] = run.laneRun(lane, POOL_RANKS)
  const placeSums: number[] = []
  for (const lane of lanes) placeSums[lane] = run.poolPlaceSum(placeSpans[lane])
  const placed = scan(placeSums)
  for (const lane of lanes) run.poolPlaceRun(placeSpans[lane], placed.before[lane])
  run.poolPlaceTotal(placed.total)
  const bound = run.poolCountLoad(POOL_SORT_BOUND)
  // `poolGroups`, `poolOffsets`, `poolSpread`.
  const groupParts = (g: number) => {
    const parts: number[][] = []
    for (const lane of order(THREADS, random)) parts[lane] = run.poolGroupRun(g, lane, bound)
    return parts
  }
  for (const g of order(groups, random)) {
    const parts = groupParts(g)
    run.poolScratchStore(run.poolGroupAt(g, 0), scan(parts.map((p) => p[0])).total)
    run.poolScratchStore(run.poolGroupAt(g, 1), scan(parts.map((p) => p[1])).total)
  }
  const counted = Math.ceil(run.poolSlotCount() / LANES)
  for (const half of [0, 1]) {
    const spans: number[][] = [],
      sums: number[] = []
    for (const lane of order(THREADS, random)) spans[lane] = run.laneRun(lane, counted)
    for (const lane of order(THREADS, random)) sums[lane] = run.poolOffsetSum(spans[lane], half)
    const offsets = scan(sums).before
    for (const lane of order(THREADS, random)) run.poolOffsetRun(spans[lane], half, offsets[lane])
  }
  for (const g of order(groups, random)) {
    const parts = groupParts(g)
    if (g * LANES >= run.poolSlotCount()) continue
    const staged = scan(parts.map((p) => p[0])).before,
      bounded = scan(parts.map((p) => p[1])).before
    const firsts = [
      run.poolScratchLoad(run.poolGroupAt(g, 0)),
      run.poolScratchLoad(run.poolGroupAt(g, 1)),
    ]
    for (const lane of order(THREADS, random))
      run.poolSpreadRun(g, lane, bound, [firsts[0] + staged[lane], firsts[1] + bounded[lane]])
  }
  // `poolScatter`: the staged slots a chunk at a time.
  const staged = run.poolStagedCount()
  for (let first = 0; first < staged; first += LANES) {
    const entries: number[][] = []
    for (const lane of order(LANES, random)) {
      entries[lane] = run.poolStagedAt(first + lane, staged)
      poolChunk[lane] = entries[lane][0]
    }
    const peers: number[][] = [],
      at: number[] = []
    for (const lane of order(LANES, random)) {
      peers[lane] = run.poolChunkPeers(lane, entries[lane][0])
      at[lane] =
        run.poolCountLoad(POOL_RANKS + Math.min(entries[lane][0], POOL_RANKS - 1)) + peers[lane][0]
    }
    for (const lane of order(LANES, random)) run.poolChunkTake(entries[lane], at[lane], peers[lane])
  }
}
