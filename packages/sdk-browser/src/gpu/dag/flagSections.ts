import { LEVEL_QUEUES } from './shader/levelWgsl.ts'
import { dagFlagsWords } from './shader/lastUseWgsl.ts'

/** Words of each descent queue of a packing: two an entry, the node then the placement reading it
 *  (`shader/levelWgsl.ts`), for every entry it may hold (`PackedDag.entryCount`), one root slot a
 *  placement at least. */
export const dagQueueWords = (packed: {
  entryCount?: number
  nodeCount?: number
  worldCount?: number
}) => 2 * Math.max(1, packed.entryCount ?? packed.nodeCount ?? 0, packed.worldCount ?? 0)

/** Flag sections behind queue 0: the candidates — the drawn journal in the same words —, then the
 *  live list, `candCap` entries each (`shader/levelWgsl.ts`, `shader/liveWgsl.ts`). */
const LIST_SECTIONS = 2

/** Sections of a camera cut's `flags`: queue 0, the two lists, the other queues, then each content
 *  key's last use (`shader/lastUseWgsl.ts`). */
export const FLAG_SECTIONS = 1 + LIST_SECTIONS + (LEVEL_QUEUES - 1) + 1

/** What a cut's `flags` is laid out for: the words of each queue, the entries of each list, the
 *  content keys. */
export type FlagShape = { queueWords: number; candCap: number; keyCount: number }

/** The words of a `flags` of `shape` (`dagFlagsWords`). */
export const flagShapeWords = (shape: FlagShape) =>
  dagFlagsWords(shape.queueWords, shape.candCap, shape.keyCount)

/** The shape of `packed`'s flags. */
export const dagFlagShape = (packed: {
  entryCount?: number
  nodeCount?: number
  worldCount?: number
  pageCount: number
  candCount?: number
  keyCount?: number
}): FlagShape => ({
  queueWords: dagQueueWords(packed),
  candCap: Math.max(1, packed.candCount ?? packed.pageCount),
  keyCount: Math.max(1, packed.keyCount ?? packed.pageCount),
})
