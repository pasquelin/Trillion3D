// The shipped pool sort's parts (`sortWgsl.ts`) as the JavaScript run of it (`sortRun.fixture.ts`)
// calls them: each part's signature, and the names of every part the run lifts from the text.

/** The sort's parts, and the host's words they read. */
export type Parts = {
  poolCount: (id: number[], n: number[], lane: number) => void
  poolRankAt: (d: number) => number
  poolPlaceAt: (r: number, cursor: number, taken: number) => void
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
export const SORT_PARTS = [
  'poolCount',
  'poolRankAt',
  'poolPlaceAt',
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
