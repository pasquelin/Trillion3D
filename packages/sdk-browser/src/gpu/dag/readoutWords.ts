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
export const SELECTION_HEADER_WORDS = 8;

/** Word of `out` where the eviction queue's header starts, behind the drawn list. */
export const evictionWord = (listCap: number) => 2 * (SELECTION_HEADER_WORDS + listCap);

/** Victims one readback hands the cache, a chosen margin over what one frame's 1 ms admission share
 *  (`STREAMING_FRAME_MS`) commits; the next readback brings the next burst, whatever the pool. */
export const EVICTION_BURST = 1024;

/** Word of `out` where the camera's requests wait for their sort, behind the eviction queue's
 *  burst, outside what the frame copies (`stagedAt` of `shader/snapshotWgsl.ts`). */
export const stagedRequestsWord = (listCap: number) =>
  evictionWord(listCap) + SELECTION_HEADER_WORDS + EVICTION_BURST;
