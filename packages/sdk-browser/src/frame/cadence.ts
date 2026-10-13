import { GRID_TOLERANCE, SUPPORT } from './refreshClock.ts'
import { HEADROOM } from './scaleTargets.ts'

/** The span a cadence is judged over, ms: a second of images, as the render scale judges its. */
const SECOND_MS = 1000
/** The slowest steady cadence, ms between two images: 60 a second, never fewer by this rule. */
const SLOWEST_MS = 1000 / 60
/** The share of a slower cadence's budget the GPU must fall to before a faster one is tried
 *  again: `HEADROOM²`, a tenth below the headroom a slower cadence is taken at, so a cost between
 *  the two keeps the cadence it has. */
const RISE = HEADROOM * HEADROOM

/**
 * THE STEADY CADENCE. A frame whose GPU work outlasts the display's refresh `R` is shown one
 * refresh after the last, or two, as the work lands: at 9.7 ms on a 120 Hz display, about half
 * and half, and the motion drawn at even steps of time is shown at uneven ones. So, when the
 * GPU cannot hold the cadence, the loop draws on every `divisor`-th refresh alone — a whole
 * number of refreshes, which the world's time already steps by (`worldFrameGrid.ts`) — and each
 * image is shown for the same time.
 *
 * The rule, judged on the moving images drawn (a still image is drawn as its feedback lands,
 * `frameScheduler.ts`, and its interval is no verdict), over a window of a second of them:
 * - slower: two images or more shown later than `divisor` refreshes, and the GPU time of the
 *   window's second costliest image (one spike moves nothing) over `HEADROOM · divisor · R`:
 *   the GPU's own work misses the cadence, not the CPU or a hitch. The divisor grows by one,
 *   while the cadence stays at `SLOWEST_MS` or faster, and only where the render scale cannot
 *   lower the cost any more (fixed, or at its floor: `scaleControl.ts` answers first).
 * - faster: a whole window with one late image at most, `SUPPORT` GPU times, every one whole, and
 *   the second costliest at most `RISE · (divisor − 1) · R`: the faster cadence holds with room.
 *   The divisor falls by one.
 * A GPU time is the span of the passes the timer read (`gpu/timing/sample.ts`): the image's whole,
 * or, where a pass's pair could not be read, a lower bound of it — the image took at least that
 * long. A lower bound over the slower bound proves the miss the GPU's as a whole time does, so it
 * counts for slowing; it proves no room, so a window holding one never speeds up.
 * Between the two bounds the divisor stays: the hysteresis that keeps it from flipping.
 *
 * A scene that holds the refresh never misses it twice a second, so its divisor stays 1 and
 * nothing of its frames changes. A device without GPU times keeps 1: the rule reads the GPU.
 * The divisor goes back to 1 whenever the refresh is not known or moves (`at`).
 *
 * State in an object's fields, stored in place: a frame boxes no number.
 */
export function createCadence() {
  return {
    /** Draws on one display frame in `divisor`. */
    divisor: 1,
    /** The refresh the divisor was learnt at, ms: NaN before any. */
    at: Number.NaN,
    /** When the last display frame the loop drew began, ms (its rAF timestamp). */
    drawnAt: Number.NaN,
    /** The window: moving images, those shown late, GPU times and the two largest. */
    frames: 0,
    late: 0,
    count: 0,
    first: 0,
    second: 0,
    /** A GPU time of the window was a lower bound only: the window proves no room. */
    partial: false,
  }
}

export type Cadence = ReturnType<typeof createCadence>

/** The window starts again: nothing judged since the last verdict. */
function restart(c: Cadence) {
  c.frames = c.late = c.count = c.first = c.second = 0
  c.partial = false
}

/** Back to every refresh, knowing nothing. */
export function resetCadence(c: Cadence) {
  c.divisor = 1
  c.at = Number.NaN
  restart(c)
}

/** A GPU time of an image, ms, as the timer gave it: its whole time where `whole`, else a lower
 *  bound of it (a pass's pair unread). */
export function sampleCadence(c: Cadence, gpuMs: number, whole: boolean) {
  c.count++
  if (!whole) c.partial = true
  if (gpuMs > c.first) {
    c.second = c.first
    c.first = gpuMs
  } else if (gpuMs > c.second) c.second = gpuMs
}

/** What the cadence reads of the refresh clock (`refreshClock.ts`), its fields loaded in place: a
 *  fractional number passed to a call, or returned by one, is a new box each frame. */
type Refresh = { readonly gap: number; readonly display: number; readonly settled: boolean }

/** Whether the display frame that begins at `now` is left out of the cadence: under a divisor
 *  above 1, sooner than `divisor − ½` refreshes of the display (`refresh`, once it is known)
 *  after the last drawn — the half takes the timestamps' jitter —, after a moving image (`still`
 *  false). */
export const skipsDisplayFrame = (c: Cadence, refresh: Refresh, now: number, still: boolean) =>
  c.divisor > 1 &&
  refresh.settled &&
  !still &&
  now - c.drawnAt < (c.divisor - 0.5) * refresh.display

/**
 * A display frame the loop draws began `refresh.gap` ms after the last one it drew (its start
 * written in `drawnAt` by the caller, in place), on the display the refresh clock measured
 * (`refresh.display`, while `settled`). `judged`: the image before it moved, drawn at the GPU's
 * pace, and the interval is no pause (`tickScale`); `floor`: the render scale cannot lower the
 * cost any more — fixed, or at its floor —, the only case the cadence slows in, so a page whose
 * scale is free keeps the scale's own answer. Counts it, and gives the window's verdict. The GPU
 * time the rule reads is the window's second costliest, or its one. Numbers are read from fields
 * and written to fields, none passed nor returned: a frame boxes none.
 */
export function judgeCadence(c: Cadence, refresh: Refresh, judged: boolean, floor: boolean) {
  if (!refresh.settled) {
    resetCadence(c)
    return
  }
  if (!(Math.abs(refresh.display - c.at) <= GRID_TOLERANCE * c.at)) {
    resetCadence(c)
    c.at = refresh.display
  }
  const d = c.divisor,
    period = refresh.display
  if (judged) {
    c.frames++
    if (Math.round(refresh.gap / period) > d) c.late++
  }
  if (
    floor &&
    c.late > 1 &&
    c.count > 1 &&
    c.second > HEADROOM * d * period &&
    (d + 1) * period <= (1 + GRID_TOLERANCE) * SLOWEST_MS
  ) {
    c.divisor++
    restart(c)
    return
  }
  if (c.frames * d * period < SECOND_MS) return
  if (
    d > 1 &&
    c.late <= 1 &&
    c.count >= SUPPORT &&
    !c.partial &&
    c.second <= RISE * (d - 1) * period
  )
    c.divisor--
  restart(c)
}
