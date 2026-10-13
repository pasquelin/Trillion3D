import { GRID_TOLERANCE, SUPPORT } from './refreshClock.ts'
import { HEADROOM } from './scaleTargets.ts'
import { gpuCosts, restartWindow, type ScaleWindow } from './scaleWindow.ts'

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
 * The rule reads the render scale's window (`scaleWindow.ts`), the one record of the frames and
 * their GPU times — its moving images, those it shows later than `divisor` refreshes (its misses),
 * the second costliest GPU time (one spike moves nothing) — and the refresh `R`:
 * - slower: two misses or more, and the second costliest GPU time over `HEADROOM · divisor · R`:
 *   the GPU's own work misses the cadence, not the CPU or a hitch. The divisor grows by one,
 *   while the cadence stays at `SLOWEST_MS` or faster, and only where the render scale cannot
 *   lower the cost any more (fixed, or at its floor: `scaleControl.ts` answers first).
 * - faster: a window of a second of the frames drawn, one miss at most, `SUPPORT` GPU times,
 *   every one whole, and the second costliest at most `RISE · (divisor − 1) · R`: the faster
 *   cadence holds with room. The divisor falls by one.
 * A GPU time is the span of the passes the timer read (`gpu/timing/sample.ts`): the image's whole,
 * or, where a pass's pair could not be read, a lower bound of it — the image took at least that
 * long. A lower bound over the slower bound proves the miss the GPU's as a whole time does, so it
 * counts for slowing; it proves no room, so a window it marks (`partial`) never speeds up.
 * Between the two bounds the divisor stays: the hysteresis that keeps it from flipping. A verdict
 * that moves the divisor starts the window again; under a fixed scale, or a slower cadence, where
 * the scale judges nothing (`tickScale`), so does each second's.
 *
 * A scene that holds the refresh never misses it twice a second, so its divisor stays 1 and
 * nothing of its frames changes. A device without GPU times keeps 1: the rule reads the GPU.
 * The divisor goes back to 1 whenever the refresh is not known or moves (the window's `at`).
 *
 * State in an object's fields, stored in place: a frame boxes no number.
 */
export function createCadence() {
  return {
    /** Draws on one display frame in `divisor`. */
    divisor: 1,
    /** When the last display frame the loop drew began, ms (its rAF timestamp). */
    drawnAt: Number.NaN,
  }
}

export type Cadence = ReturnType<typeof createCadence>

/** Back to every refresh. */
export function resetCadence(c: Cadence) {
  c.divisor = 1
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
 * A display frame the loop draws began, on the display the refresh clock measured
 * (`refresh.display`, while `settled`), and the window `w` counted it (`tickScale`). `floor`: the
 * render scale cannot lower the cost any more — fixed, or at its floor —, the only case the
 * cadence slows in, so a page whose scale is free keeps the scale's own answer. Gives the window's
 * verdict. Numbers are read from fields and written to fields, none passed nor returned: a frame
 * boxes none.
 */
export function judgeCadence(c: Cadence, w: ScaleWindow, refresh: Refresh, floor: boolean) {
  if (!refresh.settled) {
    resetCadence(c)
    return
  }
  const d = c.divisor,
    period = refresh.display,
    gpu = gpuCosts(w)
  if (
    floor &&
    gpu &&
    w.misses > 1 &&
    w.count > 1 &&
    w.second > HEADROOM * d * period &&
    (d + 1) * period <= (1 + GRID_TOLERANCE) * SLOWEST_MS
  ) {
    c.divisor++
    restartWindow(w)
    return
  }
  // Under the auto scale at every refresh, the scale's verdicts start the window again (`tickScale`).
  if (w.frames * d * period < SECOND_MS || (w.bounds.auto && d === 1)) return
  if (
    d > 1 &&
    gpu &&
    w.misses <= 1 &&
    w.count >= SUPPORT &&
    !w.partial &&
    w.second <= RISE * (d - 1) * period
  )
    c.divisor--
  restartWindow(w)
}
