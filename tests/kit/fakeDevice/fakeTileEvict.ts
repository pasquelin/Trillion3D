import { shaderRun } from '../../../packages/sdk-browser/src/materials/texture/shaderRun.fixture.ts'
import { boundWords, type BoundBuffer } from './fakeBuffers.ts'
import { sortPool } from '../../../packages/sdk-browser/src/gpu/sort/sort.fixture.ts'
import {
  TILE_BURST,
  TILE_PROTECTED,
  TILE_SORT_WGSL,
} from '../../../packages/sdk-browser/src/materials/virtual/evictSortWgsl.ts'
import {
  TILE_UNRANKED,
  TILE_PLACE_WORD_WGSL,
} from '../../../packages/sdk-browser/src/materials/virtual/slotUse.ts'

/** The shipped `poolRank`, as the tile pools' program ranks (their age step, their protection). */
export const { poolRank } = shaderRun<{
  poolRank: (age: number, tier: number, inUse: number) => number
}>(TILE_SORT_WGSL, ['poolRank'], {})

/** The shipped `tilePlaceWord`, run as the kernels find a place's first word. */
const { tilePlaceWord: tilePlaceWordAt } = shaderRun<{
  tilePlaceWord: (base: number, index: number) => number
}>(TILE_PLACE_WORD_WGSL, ['tilePlaceWord'], {})

/**
 * A tile pool's queue, replayed on its last dispatch (`poolScatter`) over the words the kernels
 * read: each place of the lane at the uniform's dynamic offset ranked on its age at the clock and
 * its tier (`poolRank`), a free or pinned one never, the highest ranks first, at most a burst,
 * written at the uniform's queue word, after the count of every place ranked. `poolCount` and `poolPlace` leave nothing it does not redo.
 */
export function fakeTileSort(entries: readonly BoundBuffer[], offsets: readonly number[] = [0]) {
  const use = boundWords(entries, 0),
    queues = boundWords(entries, 2),
    uni = boundWords(entries, 3).subarray(offsets[0] / 4)
  const [base, slots, clock, queueAt] = uni
  const rankOf = (j: number) => {
    const at = tilePlaceWordAt(base, j)
    if (use[at + 1] === TILE_UNRANKED) return poolRank(0, 0, TILE_PROTECTED)
    return poolRank(clock - Math.min(use[at], clock), use[at + 1], TILE_PROTECTED)
  }
  const { queue, total } = sortPool(slots, rankOf, TILE_BURST)
  queues[queueAt] = total
  queues.set(queue, queueAt + 1)
}
