import { boundWords, type BoundBuffer } from './fakeBuffers.ts'
import { fakeTileSort } from './fakeTileEvict.ts'
import { sortPool } from '../../../packages/sdk-browser/src/gpu/pool/sort.fixture.ts'
import { poolRank } from '../../../packages/sdk-browser/src/gpu/pool/rank.fixture.ts'
import { SELECTION_HEADER_WORDS } from '../../../packages/sdk-browser/src/gpu/dag/readoutWords.ts'
import { TILE_SORT_WGSL } from '../../../packages/sdk-browser/src/webgpu/tile/evictSortWgsl.ts'
import {
  ROW_IN_USE,
  ROW_SORT_WGSL,
} from '../../../packages/sdk-browser/src/webgpu/row/rowEvictSortWgsl.ts'
import {
  ROW_PAGE,
  ROW_USE,
  ROW_USE_WORDS,
} from '../../../packages/sdk-browser/src/webgpu/row/rowWords.ts'

type PoolSortReplay = (entries: readonly BoundBuffer[], offsets?: readonly number[]) => void

/**
 * The rows' queue, replayed on its last dispatch (`poolScatter`) over the words the kernels read
 * (`rowEvictSortWgsl.ts`): each of the uniform's live rows ranked on its age at the clock in one
 * tier (`poolRank`), one used less than `ROW_IN_USE` frames ago never, the highest ranks first, at
 * most the uniform's burst; at the queue's word, its count, the rows ranked in all and the clock
 * plus one, then the page of each row taken.
 */
function fakeRowSort(entries: readonly BoundBuffer[], offsets: readonly number[] = [0]) {
  const use = boundWords(entries, 0),
    out = boundWords(entries, 2),
    [clock, slots, queueAt, burst] = boundWords(entries, 3).subarray(offsets[0] / 4)
  const age = (j: number) => clock - Math.min(use[ROW_USE_WORDS * j + ROW_USE], clock)
  const { queue, total } = sortPool(slots, (j) => poolRank(age(j), 0, ROW_IN_USE), burst)
  out[queueAt] = Math.min(total, burst)
  out[queueAt + 1] = total
  out[queueAt + 2] = clock + 1
  for (const [at, j] of queue.entries())
    out[queueAt + SELECTION_HEADER_WORDS + at] = use[ROW_USE_WORDS * j + ROW_PAGE]
}

/** The pool sorts the double replays apart from the selection's, by the program their pipeline
 *  runs: the tile pools' (`webgpu/tile/evictSort.ts`) and the rows' (`webgpu/row/rowEvictSort.ts`). */
export const POOL_SORT_REPLAYS = new Map<string, PoolSortReplay>([
  [TILE_SORT_WGSL, fakeTileSort],
  [ROW_SORT_WGSL, fakeRowSort],
])
