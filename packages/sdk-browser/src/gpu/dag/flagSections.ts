import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { CAND_LIVE_WORDS } from './shader/levelWgsl.ts'
import { storageBufferCap } from '../../residency/pools.ts'
import { LIST_DROPPED, QUEUE_DROPPED } from './shader/viewsWgsl.ts'
import { dagFlagsWords } from './shader/lastUseWgsl.ts'
import { poolScratchWords } from '../pool/sortWords.ts'
import { selectionListCap } from './layout.ts'
import { EVICTION_BURST } from './readoutWords.ts'

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

/** What a cut's `flags` is laid out for: the words of each queue, the entries of each list. */
export type FlagShape = { queueWords: number; candCap: number }

/** The lists behind queue 0, where each starts, in words of an entry (`shader/levelWgsl.ts`): the
 *  candidates, two; the live list, three; the drawn log and the log being written, one each. */
const LIST_STARTS = [0, 2, 5, 6]

/** First word of section `s` of a `flags` of `shape`: the kernel's `queueBase` and list bases. */
export function flagSectionStart(s: number, { queueWords, candCap }: FlagShape) {
  if (s === 0) return 0
  if (s <= LIST_SECTIONS) return queueWords + LIST_STARTS[s - 1] * candCap
  return (s - LIST_SECTIONS) * queueWords + CAND_LIVE_WORDS * candCap
}

/** The section a cut keeps from one cut to the next: the drawn log of the last cut that ran whole.
 *  The others each cut writes before it reads them. */
export const JOURNAL_SECTION = 3

/** The words of the sections of a `flags` of `shape` (`dagFlagsWords`). */
export const flagShapeWords = (shape: FlagShape) => dagFlagsWords(shape.queueWords, shape.candCap)

/** Words of the eviction sort's scratch behind the sections (`shader/evictWgsl.ts`), for a cut of
 *  `pageCount` pages: over its pool list's keys (`selectionListCap`) and the burst they can take,
 *  no more than those keys — two words a staged key, two a group of `POOL_LANES` keys. Nothing
 *  carries it from one sort to the next, nor from one `flags` to the one it grows into. */
export function evictScratchWords(pageCount: number) {
  const keys = selectionListCap(pageCount)
  return poolScratchWords(keys, Math.min(EVICTION_BURST, keys))
}

/** The most one section of a `flags` holds on a device of `limits`: a queue's words, two an entry,
 *  and a list's entries, the live list's three words each, the widest (`shader/liveWgsl.ts`). A
 *  cut starts within it (`dagFlagShape`) and grows no further (`grownFlagShape`). */
function flagSectionCaps(limits?: Parameters<typeof storageBufferCap>[0]) {
  const words = storageBufferCap(limits) / 4
  return { queueWords: 2 * Math.floor(words / 2), candCap: Math.floor(words / 3) }
}

/** The shape of `packed`'s flags as a cut starts on a device of `limits`: a view's reach, each
 *  section within one binding (`flagSectionCaps`) — a reach past it is grown into on demand, never
 *  refused up front. Queue 0 keeps a root slot a placement (`pack.ts`), past one binding if it
 *  must: the flags are a record table (`cutTables.ts`), never refused for it. */
export function dagFlagShape(
  packed: {
    queueEntries?: number
    entryCount?: number
    nodeCount?: number
    worldCount?: number
    pageCount: number
    candCount?: number
  },
  limits?: Parameters<typeof storageBufferCap>[0],
): FlagShape {
  const cap = flagSectionCaps(limits),
    queueWords = dagQueueWords(packed),
    roots = Math.min(queueWords, 2 * (packed.worldCount ?? 0))
  return {
    queueWords: clampLowWins(queueWords, roots, cap.queueWords),
    candCap: clampLowWins(packed.candCount ?? packed.pageCount, 1, cap.candCap),
  }
}

/**
 * THE QUEUES AND LISTS A CUT GROWS TO. A cut's descent queues and its candidate and live lists are
 * sized for a view's reach when it is made (`layout.ts`, `QUEUE_ENTRIES_START`), never for the
 * world. A cut that passes one drops the work past it and says which (`shader/viewsWgsl.ts`,
 * `QUEUE_DROPPED`, `LIST_DROPPED`): it is not drawn (`shader/commitWgsl.ts`) — the frame draws the
 * last cut that ran whole — and never adopted, and what was full doubles here, the next cut cutting
 * again on it. A queue never holds more than every entry, a list more than every page, nor a
 * section more than one binding: past that, `undefined`, and the view coarsens instead
 * (`coarsening.ts`), as it does past the readout's list (`listCap.ts`).
 */
export function grownFlagShape(
  limits: Parameters<typeof storageBufferCap>[0],
  bounds: { entryCount: number; pageCount: number },
  shape: FlagShape,
  dropped: number,
): FlagShape | undefined {
  const cap = flagSectionCaps(limits)
  const queueWords =
      dropped & QUEUE_DROPPED
        ? Math.min(2 * Math.max(1, bounds.entryCount), 2 * shape.queueWords, cap.queueWords)
        : shape.queueWords,
    candCap =
      dropped & LIST_DROPPED
        ? Math.min(Math.max(1, bounds.pageCount), 2 * shape.candCap, cap.candCap)
        : shape.candCap
  if (queueWords <= shape.queueWords && candCap <= shape.candCap) return undefined
  return { ...shape, queueWords, candCap }
}

/** The wider of two shapes asked, field by field: two views that dropped work ask both. */
export const widerFlagShape = (a: FlagShape | undefined, b: FlagShape): FlagShape =>
  a
    ? {
        queueWords: Math.max(a.queueWords, b.queueWords),
        candCap: Math.max(a.candCap, b.candCap),
      }
    : b
