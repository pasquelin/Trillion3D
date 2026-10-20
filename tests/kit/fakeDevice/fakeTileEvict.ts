import { shaderRun } from '../../../packages/sdk-browser/src/texture/shaderRun.fixture.ts'
import { boundWords, type BoundBuffer } from './fakeBuffers.ts'
import { sortPool } from '../../../packages/sdk-browser/src/gpu/pool/sort.fixture.ts'
import { poolRank } from '../../../packages/sdk-browser/src/gpu/pool/rank.fixture.ts'
import { EVICT_IN_USE } from '../../../packages/sdk-browser/src/gpu/pool/rank.ts'
import { TILE_BURST } from '../../../packages/sdk-browser/src/webgpu/tile/evictSortWgsl.ts'
import {
  TILE_UNRANKED,
  TILE_PLACE_WORD_WGSL,
} from '../../../packages/sdk-browser/src/webgpu/tile/slotUse.ts'

/** The shipped `tilePlaceWord`, run as the kernels find a place's first word. */
const { tilePlaceWord: tilePlaceWordAt } = shaderRun<{
  tilePlaceWord: (base: number, index: number) => number
}>(TILE_PLACE_WORD_WGSL, ['tilePlaceWord'], {})

/**
 * A tile pool's queue, replayed on its last dispatch (`poolScatter`) over the words the kernels
 * read: each place of the lane at the uniform's dynamic offset ranked on its age at the clock and
 * its tier (`poolRank`), a free or pinned one never, the highest ranks first, at most a burst,
 * written at the uniform's queue word. `poolCount` and `poolPlace` leave nothing it does not redo.
 */
export function fakeTileSort(entries: readonly BoundBuffer[], offsets: readonly number[] = [0]) {
  const use = boundWords(entries, 0),
    queues = boundWords(entries, 2),
    uni = boundWords(entries, 3).subarray(offsets[0] / 4)
  const [base, slots, clock, queueAt] = uni
  const rankOf = (j: number) => {
    const at = tilePlaceWordAt(base, j)
    if (use[at + 1] === TILE_UNRANKED) return poolRank(0, 0, EVICT_IN_USE)
    return poolRank(clock - Math.min(use[at], clock), use[at + 1], EVICT_IN_USE)
  }
  const { queue } = sortPool(slots, rankOf, TILE_BURST)
  queues[queueAt] = queue.length
  queues.set(queue, queueAt + 1)
}
