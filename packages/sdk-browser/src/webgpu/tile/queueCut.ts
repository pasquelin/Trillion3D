import { PREVIEW_LAYOUT_NAMES } from '../../../../sdk-core/src/texture/previewFormat.ts'
import { TILE_BURST } from './evictSortWgsl.ts'
import type { WebgpuTilePool } from './pool.ts'

/** Words of one lane's queue: its count, then its places. */
export const TILE_QUEUE_WORDS = 1 + TILE_BURST
/** Queues the sort fills: a lane of each of the two atlases. */
export const TILE_QUEUES = 2 * PREVIEW_LAYOUT_NAMES.length
/** Bytes of every lane's queue: what the sort writes and a readback copies. */
export const TILE_QUEUE_BYTES = TILE_QUEUES * TILE_QUEUE_WORDS * 4
/** Cut records in turn: more than the feedback readbacks in flight (`feedback.ts`). */
const CUTS = 4

/** The queues a frame cut, carried by the feedback readback that copies `buffer`'s
 *  `TILE_QUEUE_BYTES` (`feedback.ts`): `read` hands each lane sorted its queue. */
export type TileQueueCut = {
  readonly buffer: GPUBuffer
  read(words: Uint32Array): void
}

type Cut = TileQueueCut & {
  pools: (WebgpuTilePool | undefined)[]
  arrivals: Uint32Array
}

/** The cut records over the queues' `buffer`, of `TILE_QUEUE_BYTES`, taken in turn: each the pools
 *  a frame sorted and their arrivals at the cut. */
export function createQueueCuts(buffer: GPUBuffer) {
  const cut = (): Cut => {
    const made: Cut = {
      buffer,
      pools: new Array(TILE_QUEUES).fill(undefined),
      arrivals: new Uint32Array(TILE_QUEUES),
      read(queueWords) {
        for (let q = 0; q < TILE_QUEUES; q++)
          made.pools[q]?.follow(
            queueWords.subarray(q * TILE_QUEUE_WORDS, (q + 1) * TILE_QUEUE_WORDS),
            made.arrivals[q],
          )
      },
    }
    return made
  }
  const cuts = Array.from({ length: CUTS }, cut)
  let turn = 0
  return {
    /** The record the next cut fills. */
    next: () => cuts[turn],
    /** The record filled is carried: the next cut takes the next. */
    turn() {
      turn = (turn + 1) % CUTS
    },
  }
}
