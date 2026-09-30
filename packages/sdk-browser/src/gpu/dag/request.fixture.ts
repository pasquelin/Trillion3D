// The CPU mirror of the request kernels (`requestWgsl.ts`, `shader/snapshotWgsl.ts`): what the
// oracle (`oracle/oracle.fixture.ts`) and the Node device replay, on the word layout of `request.ts`.
import {
  AHEAD_ERROR_MAX,
  REQUEST_AHEAD,
  REQUEST_AHEAD_ERROR_BITS,
  REQUEST_AHEAD_SCALE,
  REQUEST_DUE_STEPS,
  REQUEST_PRIORITY_MAX,
  REQUEST_PRIORITY_SCALE,
  REQUEST_STEP_MAX,
  requestPriority,
} from './request.ts';

/** Error step of `pixels` at `scale` steps per doubling, bounded by `max`; `Infinity` takes `max`. */
function errorStep(pixels: number, scale: number, max: number) {
  if (!(pixels > 0)) return 0;
  if (!Number.isFinite(pixels)) return max;
  return Math.min(max, Math.max(0, Math.round(Math.log2(1 + pixels) * scale)));
}

/** Priority of a visible request's error in pixels, monotone increasing and bounded in its tier.
 *  `Infinity` takes the tier's highest step: a cluster nothing replaces is what is missing most. */
export const quantizeRequestPriority = (pixels: number) =>
  errorStep(pixels, REQUEST_PRIORITY_SCALE, REQUEST_STEP_MAX);

/** Priority of a request ahead: needed `due` of the horizon from now (0 now, 1 at the horizon), the
 *  sooner the higher, then its error. A deadline that reads as no number is the latest. */
export function quantizeAheadPriority(pixels: number, due: number) {
  const last = REQUEST_DUE_STEPS - 1,
    late = due > 0 ? Math.min(last, Math.floor(due * REQUEST_DUE_STEPS)) : due <= 0 ? 0 : last;
  return (
    REQUEST_AHEAD |
    ((last - late) << REQUEST_AHEAD_ERROR_BITS) |
    errorStep(pixels, REQUEST_AHEAD_SCALE, AHEAD_ERROR_MAX)
  );
}
/** The order a priority is served in, highest first: the visible tier above the tier ahead. */
export const requestRank = (priority: number) => priority ^ REQUEST_AHEAD;

/** The rank of a request word: what `dagSortRequests` orders by. */
export const requestWordRank = (word: number) => requestRank(requestPriority(word));
/** In `words[start, end)`, sorted by rank, the first request of the view ahead: every visible
 *  request comes before it. */
export function firstAheadRequest(words: ArrayLike<number>, start = 0, end = words.length) {
  let at = start;
  while (at < end && !(requestPriority(words[at]) & REQUEST_AHEAD)) at++;
  return at;
}

/**
 * CPU mirror of `dagSortRequests` (`shader/snapshotWgsl.ts`), what the oracle and the Node device
 * replay: the words by `requestRank`, highest first, in one count and one scatter over the ranks.
 * Within a rank it keeps the order the words came in, one of the orders the kernel's threads give.
 */
export function sortRequestWords(words: ArrayLike<number>) {
  const place = new Uint32Array(REQUEST_PRIORITY_MAX + 1);
  for (let i = 0; i < words.length; i++) place[requestWordRank(words[i])]++;
  for (let rank = REQUEST_PRIORITY_MAX, first = 0; rank >= 0; rank--) {
    const held = place[rank];
    place[rank] = first;
    first += held;
  }
  const sorted = new Uint32Array(words.length);
  for (let i = 0; i < words.length; i++) sorted[place[requestWordRank(words[i])]++] = words[i];
  return sorted;
}
