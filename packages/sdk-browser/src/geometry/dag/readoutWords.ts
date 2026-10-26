import { clamp } from '../../../../math/src/scalar/reals.ts'

/**
 * Readout header, in words, in front of each of its two halves.
 *
 * The first four are the usual — count, trunk reject, reached level, flags. The next
 * two carry the TRIANGLE TOTALS, which only the GPU sums where the verdict is spoken, in
 * `dagWanted`: what the cut rule draws, and its blended share. The last two count the occlusion: the
 * items the previous image's pyramid hid, held for the post pass, and those the post pass's pyramid
 * hid for good (`shader/occlusionWgsl.ts`).
 *
 * That is the condition for the readout to one day stop carrying LISTS: a total
 * held by the GPU survives the disappearance of the list it was the sum of.
 */
export const SELECTION_HEADER_WORDS = 8

/** Words of the drawn list's header past its count: what the cut asked of its lists, the most one
 *  pass asked of each — the nodes it opened, the candidate clusters, the clusters drawn
 *  (`shader/finishWgsl.ts`, `lists/listFeedback.ts`). Its other words are padding. */
export const PEAK_NODES = 1,
  PEAK_CANDIDATES = 2,
  PEAK_VISIBLE = 3

/** Words of a list of `ranks` ranks in `out` or a copy of it: its header, then its ranks. */
export const listWords = (ranks: number) => SELECTION_HEADER_WORDS + ranks

/** Word of `out` where the requests' priorities lie, behind the drawn list and in what the frame
 *  copies: one word a request, at its rank of the first list (`priorityAt` of
 *  `shader/snapshotWgsl.ts`, `request/request.ts`). */
export const priorityWord = (listCap: number) => 2 * listWords(listCap)

/** Word of `out` where the requests' page counts lie, behind their priorities and in what the frame
 *  copies: one word a request, at its rank of the first list — its pages are the `count` packed
 *  pages from the one the first list names (`countAt` of `shader/snapshotWgsl.ts`). */
export const countWord = (listCap: number) => priorityWord(listCap) + listCap

/** Words of `out` the frame copies: every list up to the page counts' end. */
export const copiedWords = (listCap: number) => countWord(listCap) + listCap

/** The ranks being sorted, held from one readback to the next. */
let sorting = new Uint32Array(0)

/** A list the GPU wrote behind a header at word `at`: its count, bounded by the `ranks` it holds —
 *  the kernel counts past them (`shader/finishWgsl.ts`) — and by what the readback holds, then its
 *  ranks, copied into `into` in increasing order. The cut writes the drawn pages in the order its
 *  threads won the lists, which differs from one image to the next though the cut does not; the
 *  host's lists compare their sequences (`../cut/adoption/delta.ts`), so the order it hands them
 *  is the pages' own. */
export function readSortedList(ints: Uint32Array, at: number, into: number[], ranks: number) {
  const count = clamp(ints.length - at - SELECTION_HEADER_WORDS, 0, Math.min(ints[at] ?? 0, ranks))
  if (sorting.length < count) sorting = new Uint32Array(Math.max(count, 2 * sorting.length))
  const start = at + SELECTION_HEADER_WORDS
  const run = sorting.subarray(0, count)
  run.set(ints.subarray(start, start + count))
  run.sort()
  for (let i = 0; i < count; i++) into[i] = run[i]
  into.length = count
  return into
}
