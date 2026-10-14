import { ADMISSION_BUCKETS } from './request.ts'

/**
 * Readout header, in words, in front of each of its two halves.
 *
 * The first four are the usual — count, trunk reject, reached level, flags. The next
 * two carry the TRIANGLE TOTALS, which only the GPU sums where the verdict is spoken, in
 * `dagMask`: what the cut rule draws, and its blended share. The last two count the requests ahead of
 * the camera: those asked for, and those the snapshot holds.
 *
 * That is the condition for the readout to one day stop carrying LISTS: a total
 * held by the GPU survives the disappearance of the list it was the sum of.
 */
export const SELECTION_HEADER_WORDS = 8

/** Word of `out` where the eviction queue's header starts, behind the drawn list. */
export const evictionWord = (listCap: number) => 2 * (SELECTION_HEADER_WORDS + listCap)

/** Victims one readback hands the cache, a chosen margin over what one frame's main-thread share
 *  (`MAIN_THREAD_FRAME_MS`) commits; the next readback brings the next burst, whatever the pool. */
export const EVICTION_BURST = 1024

/** Word of `out` where the camera's requests are counted by admission bucket, behind the eviction
 *  queue's burst and in what the frame copies (`shader/snapshotWgsl.ts`): bucket `b` at word `b`,
 *  its level in the low bits, the minimum capacity's bit above (`ADMISSION_BUCKETS`). A list ranked
 *  by admission is merged by them, no request's level read again
 *  (`../../webgpu/residency/readbackMerge.ts`). */
export const levelCountsWord = (listCap: number) =>
  evictionWord(listCap) + SELECTION_HEADER_WORDS + EVICTION_BURST

/** Word of `out` where the cut's difference starts, behind the level counts and in what the frame
 *  copies (`shader/differenceWgsl.ts`): for each rank of the camera's requests then of the drawn
 *  pages, a list of `listCap` each, the rank its page held in the kept list. */
export const differenceWord = (listCap: number) => levelCountsWord(listCap) + ADMISSION_BUCKETS

/** Victims one readback hands the row cache at most (`../../webgpu/row/rowEvictSortWgsl.ts`): the
 *  most rows the table hands out between two readbacks, 64 KiB of readback. */
export const ROW_BURST = 16384

/** The burst of a readout of `listCap` ranks: never more victims than the cut's pages, which bound
 *  its rows, so a small scene's readout stays small. */
export const rowBurst = (listCap: number) => Math.min(ROW_BURST, listCap)

/** Word of `out` where the rows' victim queue lies, behind the difference and in what the frame
 *  copies: its count, the rows the GPU ranked, the frame it was ranked at plus one — 0 when no cut
 *  ranked it —, then `rowBurst` pages (`../../webgpu/row/rowEvictSortWgsl.ts`). */
export const rowQueueWord = (listCap: number) => differenceWord(listCap) + 2 * listCap

/** Words of the rows' victim queue: its header, then its burst. */
const rowQueueWords = (listCap: number) => SELECTION_HEADER_WORDS + rowBurst(listCap)

/** Word of `out` where the camera's requests wait for their sort, behind the rows' queue, outside
 *  what the frame copies (`stagedAt` of `shader/snapshotWgsl.ts`). */
export const stagedRequestsWord = (listCap: number) =>
  rowQueueWord(listCap) + rowQueueWords(listCap)
