import { LEVEL_QUEUES } from './shader/levelWgsl.ts'
import { dagFlagsWords } from './shader/lastUseWgsl.ts'

/** Words of each descent queue of a packing: two an entry, the node then the placement reading it
 *  (`shader/levelWgsl.ts`), for every entry it may hold (`PackedDag.entryCount`), one root slot a
 *  placement at least. */
export const dagQueueWords = (packed: {
  queueEntries?: number
  entryCount?: number
  nodeCount?: number
}) => 2 * Math.max(1, packed.queueEntries ?? packed.entryCount ?? packed.nodeCount ?? 0)

/** Flag sections behind queue 0: the candidates, the live list, the drawn log and the log the
 *  running cut writes, `candCap` entries each (`shader/levelWgsl.ts`, `shader/liveWgsl.ts`). */
const LIST_SECTIONS = 4

/** Sections of a camera cut's `flags`: queue 0, the lists, then the other queues. */
export const FLAG_SECTIONS = 1 + LIST_SECTIONS + (LEVEL_QUEUES - 1)

/** What a cut's `flags` is laid out for: the words of each queue, the entries of each list. */
export type FlagShape = { queueWords: number; candCap: number }

/** The words of a `flags` of `shape` (`dagFlagsWords`). */
export const flagShapeWords = (shape: FlagShape) => dagFlagsWords(shape.queueWords, shape.candCap)

/** The shape of `packed`'s flags. */
export const dagFlagShape = (packed: {
  queueEntries?: number
  entryCount?: number
  nodeCount?: number
  pageCount: number
  candCount?: number
}): FlagShape => ({
  queueWords: dagQueueWords(packed),
  candCap: Math.max(1, packed.candCount ?? packed.pageCount),
})
