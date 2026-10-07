// The CPU mirror of the request kernels (`requestWgsl.ts`, `shader/snapshotWgsl.ts`): what the
// oracle (`oracle/oracle.fixture.ts`) and the Node device replay, on the word layout of `request.ts`.
import {
  ADMISSION_ERROR_BITS,
  ADMISSION_ERROR_MAX,
  ADMISSION_FLOOR,
  ADMISSION_LEVEL_MAX,
  ADMISSION_SCALE,
  AHEAD_ERROR_MAX,
  REQUEST_AHEAD,
  REQUEST_AHEAD_ERROR_BITS,
  REQUEST_AHEAD_SCALE,
  REQUEST_DUE_STEPS,
  REQUEST_PRIORITY_MAX,
  REQUEST_PRIORITY_SCALE,
  REQUEST_STEP_MAX,
} from './request.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'

/** A staged request as one number: its priority above its whole-word page, the two words
 *  `dagWanted` stages (`shader/snapshotWgsl.ts`), exact in a double. */
export const stagedRequest = (page: number, priority: number) => priority * 2 ** 32 + page
export const stagedPage = (staged: number) => staged % 2 ** 32
export const stagedPriority = (staged: number) => Math.floor(staged / 2 ** 32)

/** Error step of `pixels` at `scale` steps per doubling, bounded by `max`; `Infinity` takes `max`. */
function errorStep(pixels: number, scale: number, max: number) {
  if (!(pixels > 0)) return 0
  if (!Number.isFinite(pixels)) return max
  return clamp(Math.round(Math.log2(1 + pixels) * scale), 0, max)
}

/** Priority of a visible request's error in pixels, monotone increasing and bounded in its tier.
 *  `Infinity` takes the tier's highest step: a cluster nothing replaces is what is missing most. */
export const quantizeRequestPriority = (pixels: number) =>
  errorStep(pixels, REQUEST_PRIORITY_SCALE, REQUEST_STEP_MAX)

/** Priority of a request ahead: needed `due` of the horizon from now (0 now, 1 at the horizon), the
 *  sooner the higher, then its error. A deadline that reads as no number is the latest. */
export function quantizeAheadPriority(pixels: number, due: number) {
  const last = REQUEST_DUE_STEPS - 1,
    late = due > 0 ? Math.min(last, Math.floor(due * REQUEST_DUE_STEPS)) : due <= 0 ? 0 : last
  return (
    REQUEST_AHEAD |
    ((last - late) << REQUEST_AHEAD_ERROR_BITS) |
    errorStep(pixels, REQUEST_AHEAD_SCALE, AHEAD_ERROR_MAX)
  )
}
/** Priority of a visible request ranked by admission (`admissionPriority`): the minimum capacity's
 *  pages first, then the coarser level, then the larger error. */
export const quantizeAdmission = (level: number, rootChild: boolean, pixels: number) =>
  (rootChild ? ADMISSION_FLOOR : 0) |
  (clamp(level, 0, ADMISSION_LEVEL_MAX) << ADMISSION_ERROR_BITS) |
  errorStep(pixels, ADMISSION_SCALE, ADMISSION_ERROR_MAX)

/** The order a priority is served in, highest first: the visible tier above the tier ahead. */
export const requestRank = (priority: number) => priority ^ REQUEST_AHEAD

/** The rank of a staged request: what `dagSortRequests` orders by. */
export const stagedRank = (staged: number) => requestRank(stagedPriority(staged))
/** In `staged[start, end)`, sorted by rank, the first request of the view ahead: every visible
 *  request comes before it. */
export function firstAheadRequest(staged: ArrayLike<number>, start = 0, end = staged.length) {
  let at = start
  while (at < end && !(stagedPriority(staged[at]) & REQUEST_AHEAD)) at++
  return at
}

/**
 * CPU mirror of `dagSortRequests` (`shader/snapshotWgsl.ts`), what the oracle and the Node device
 * replay: the staged requests by `requestRank`, highest first, in one count and one scatter over
 * the ranks. Within a rank it keeps the order they came in, one of the orders the kernel's threads
 * give. The snapshot keeps their pages (`stagedPage`).
 */
export function sortStaged(staged: ArrayLike<number>) {
  const place = new Uint32Array(REQUEST_PRIORITY_MAX + 1)
  for (let i = 0; i < staged.length; i++) place[stagedRank(staged[i])]++
  for (let rank = REQUEST_PRIORITY_MAX, first = 0; rank >= 0; rank--) {
    const held = place[rank]
    place[rank] = first
    first += held
  }
  const sorted = new Array<number>(staged.length)
  for (let i = 0; i < staged.length; i++) sorted[place[stagedRank(staged[i])]++] = staged[i]
  return sorted
}
