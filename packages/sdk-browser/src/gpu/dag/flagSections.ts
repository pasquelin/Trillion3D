import { LEVEL_QUEUES } from './shader/levelWgsl.ts'

/** Words of each descent queue of a packing: two an entry, the node then the placement reading it
 *  (`shader/levelWgsl.ts`), for every entry it may hold (`PackedDag.entryCount`), one root slot a
 *  placement at least. */
export const dagQueueWords = (packed: {
  entryCount?: number
  nodeCount?: number
  worldCount?: number
}) => 2 * Math.max(1, packed.entryCount ?? packed.nodeCount ?? 0, packed.worldCount ?? 0)

/** Flag sections behind queue 0: the draw mask, the cone words, the live list, the candidate list
 *  (a light cut's drawn log), each one word per page (`shader/levelWgsl.ts`). */
export const PAGE_SECTIONS = 4

/** Sections of a camera cut's `flags`: queue 0, the four page sections, the other queues, then
 *  each page's last use (`shader/lastUseWgsl.ts`); a light cut has all but the last. */
export const FLAG_SECTIONS = 1 + PAGE_SECTIONS + (LEVEL_QUEUES - 1) + 1
