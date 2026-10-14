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
import { VSM_POOL_SORT_WGSL } from '../../../packages/sdk-browser/src/vsm/freePagesWgsl.ts'

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
const POOL_SORT_REPLAYS = new Map<string, PoolSortReplay>([
  [TILE_SORT_WGSL, fakeTileSort],
  [ROW_SORT_WGSL, fakeRowSort],
])

/** The shadow pool's queue (`vsm/freePagesWgsl.ts`), on its own group: the double runs none of the
 *  shadow kernels that pop it (`pmPop`), so nothing it would write is read — replayed as nothing,
 *  by name, never a sort the double does not know. */
const shadowPoolSort: PoolSortReplay = () => {}

/** The replay of the pool sort a module of `code` runs: the tile pools', the rows' (their programs
 *  whole), the shadow pool's (a program its layout writes, holding the shadow pool's sort). */
export const poolSortReplayOf = (code: string) =>
  POOL_SORT_REPLAYS.get(code) ??
  (code.includes(VSM_POOL_SORT_WGSL.text) ? shadowPoolSort : undefined)
