import { clamp } from '../../../../math/src/scalar/reals.ts'

/**
 * Readout header, in words, in front of each of its two halves.
 *
 * The first four are the usual — count, trunk reject, reached level, flags. The next
 * two carry the TRIANGLE TOTALS, which only the GPU sums where the verdict is spoken, in
 * `dagMask`: what the cut rule draws, and its blended share. The last two count the occlusion: the
 * items the previous image's pyramid hid, held for the post pass, and those the post pass's pyramid
 * hid for good (`shader/occlusionWgsl.ts`).
 *
 * That is the condition for the readout to one day stop carrying LISTS: a total
 * held by the GPU survives the disappearance of the list it was the sum of.
 */
export const SELECTION_HEADER_WORDS = 8

/** Words of the drawn list's header past its count: what the cut asked of its lists, the most one
 *  pass asked of each — the nodes it opened, the candidate clusters, the clusters drawn
 *  (`shader/commitWgsl.ts`, `lists/listFeedback.ts`). Its other words are padding. */
export const PEAK_NODES = 1,
  PEAK_CANDIDATES = 2,
  PEAK_VISIBLE = 3

/** Words of a list of `ranks` ranks in `out` or a copy of it: its header, then its ranks. */
export const listWords = (ranks: number) => SELECTION_HEADER_WORDS + ranks

/** Word of `out` where the cut's difference starts, behind the drawn list and in what the frame
 *  copies (`shader/differenceWgsl.ts`): for each rank of the camera's requests then of the drawn
 *  pages, a list of `listCap` each, the rank its page held in the kept list. */
export const differenceWord = (listCap: number) => 2 * listWords(listCap)

/** Victims one readback hands the row cache at most (`../rows/rowEvictSortWgsl.ts`): the
 *  most rows the table hands out between two readbacks, 64 KiB of readback. */
export const ROW_BURST = 16384

/** The burst of a readout of `listCap` ranks: never more victims than the cut's pages, which bound
 *  its rows, so a small scene's readout stays small. */
export const rowBurst = (listCap: number) => Math.min(ROW_BURST, listCap)

/** Word of `out` where the rows' victim queue lies, behind the difference and in what the frame
 *  copies: its count, the rows the GPU ranked, the frame it was ranked at plus one — 0 when no cut
 *  ranked it —, then `rowBurst` pages (`../rows/rowEvictSortWgsl.ts`). */
export const rowQueueWord = (listCap: number) => differenceWord(listCap) + 2 * listCap

/** Words of the rows' victim queue: its header, then its burst. */
const rowQueueWords = (listCap: number) => SELECTION_HEADER_WORDS + rowBurst(listCap)

/** Word of `out` where the requests' priorities lie, behind the rows' queue and in what the frame
 *  copies: one word a request, at its rank of the first list (`priorityAt` of
 *  `shader/snapshotWgsl.ts`, `request/request.ts`). */
export const priorityWord = (listCap: number) => rowQueueWord(listCap) + rowQueueWords(listCap)

/** Word of `out` where the requests' page counts lie, behind their priorities and in what the frame
 *  copies: one word a request, at its rank of the first list — its pages are the `count` packed
 *  pages from the one the first list names (`countAt` of `shader/snapshotWgsl.ts`). */
export const countWord = (listCap: number) => priorityWord(listCap) + listCap

/** Words of `out` the frame copies: every list up to the page counts' end. */
export const copiedWords = (listCap: number) => countWord(listCap) + listCap

/** A list the GPU wrote behind a header at word `at`: its count, bounded by the `ranks` it holds —
 *  the kernel counts past them (`shader/compactWgsl.ts`) — and by what the readback holds, then its
 *  ranks, copied into `into`. */
export function readCountedList(ints: Uint32Array, at: number, into: number[], ranks: number) {
  const count = clamp(ints.length - at - SELECTION_HEADER_WORDS, 0, Math.min(ints[at] ?? 0, ranks))
  for (let i = 0; i < count; i++) into[i] = ints[at + SELECTION_HEADER_WORDS + i]
  into.length = count
  return into
}
