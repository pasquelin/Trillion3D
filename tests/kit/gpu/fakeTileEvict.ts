import { words } from './fakeBuffers.ts'
import { sortPool } from '../../../packages/sdk-browser/src/gpu/pool/sort.fixture.ts'
import { poolRank } from '../../../packages/sdk-browser/src/gpu/pool/rank.fixture.ts'
import { EVICT_IN_USE } from '../../../packages/sdk-browser/src/gpu/pool/rank.ts'
import { TILE_BURST } from '../../../packages/sdk-browser/src/webgpu/tile/evictSortWgsl.ts'
import {
  TILE_UNRANKED,
  TILE_USE_HEADER,
} from '../../../packages/sdk-browser/src/webgpu/tile/slotUse.ts'

type Bound = { binding: number; resource: { buffer: { data: Uint8Array } } }

/** Whether a dispatch's group is a tile pool sort's (`webgpu/tile/evictSort.ts`): its four
 *  bindings — the places' words, the counts, the queues, the lane's uniform. */
export const isTileSort = (entries: readonly Bound[]) => entries.length === 4

/**
 * A tile pool's queue, replayed on its last dispatch (`poolScatter`) over the words the kernels
 * read: each place of the lane at the uniform's dynamic offset ranked on its age at the clock and
 * its tier (`poolRank`), a free or pinned one never, the highest ranks first, at most a burst,
 * written at the uniform's queue word. `poolCount` and `poolPlace` leave nothing it does not redo.
 */
export function fakeTileSort(entries: readonly Bound[], offsets: readonly number[] = [0]) {
  const of = (binding: number) =>
    words(entries.find((e) => e.binding === binding)!.resource.buffer.data)
  const use = of(0),
    queues = of(2),
    uni = of(3).subarray(offsets[0] / 4)
  const [base, slots, clock, queueAt] = uni
  const rankOf = (j: number) => {
    const at = TILE_USE_HEADER + 2 * (base + j)
    if (use[at + 1] === TILE_UNRANKED) return poolRank(0, 0, EVICT_IN_USE)
    return poolRank(clock - Math.min(use[at], clock), use[at + 1], EVICT_IN_USE)
  }
  const { queue } = sortPool(slots, rankOf, TILE_BURST)
  queues[queueAt] = queue.length
  queues.set(queue, queueAt + 1)
}
