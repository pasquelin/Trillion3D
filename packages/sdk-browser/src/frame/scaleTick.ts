import { GRID_TOLERANCE, SUPPORT, type createRefreshClock } from './refreshClock.ts'
import {
  displayMoved,
  HISTORY,
  INTERVAL_PAUSE_MS,
  PERIOD,
  type createTargetCap,
} from './scaleTargets.ts'
import {
  clearCosts,
  fitScale,
  fittedCost,
  forgetThreshold,
  restartWindow,
  sampleCost,
  swapUnit,
  type ScaleWindow,
} from './scaleWindow.ts'

/** The span a frame may miss its refresh once in: one image a second shown two refreshes. */
const SECOND_MS = 1000

/** What a tick reads and moves: the controller's state, the display's clock and size, and the
 *  render targets' memory cap. */
export interface ScaleParts {
  w: ScaleWindow
  refresh: ReturnType<typeof createRefreshClock>
  display: { width: number; height: number; ratio: number }
  targets: ReturnType<typeof createTargetCap>
}

/** The last image drawn, as the controller was told (`drew`). */
export interface DrawnImage {
  steered: boolean
  still: boolean
}

/** An interval after a held frame, nothing drawn in it, is no work's: `SUPPORT` of them in a row
 *  that agree are a group the clock reads the display's period from. The interval is read from
 *  the clock, never passed: a fractional number an optimised call passes is a new object each
 *  frame. */
function readHeldInterval(w: ScaleWindow, refresh: ScaleParts['refresh']) {
  const gap = refresh.gap,
    free = w.holding && !w.fresh,
    agrees = Math.abs(gap - w.heldGap) <= GRID_TOLERANCE * w.heldGap
  w.agreeing = !free ? 0 : agrees ? w.agreeing + 1 : 1
  w.heldGap = free ? gap : Number.NaN
  if (w.agreeing >= SUPPORT) w.measured = true
  w.holding = false
}

/** The window's verdict, `PERIOD` frames after the last move: two misses lower `hi`, a second with
 *  one at most raises `lo`, either chooses the next trial; else the scale follows the scene's cost. */
function settleWindow(w: ScaleWindow, refresh: ScaleParts['refresh'], still: boolean) {
  const period = refresh.display,
    cost = fittedCost(w)
  if (w.misses > 1) {
    if (w.count < 2) return
    if (cost > w.lo) w.hi = Math.min(w.hi, cost)
  } else if (w.moving >= SECOND_MS / period) {
    w.lo = Math.max(w.lo, cost)
    // A second met above a cost that missed: that miss was not the GPU's.
    if (w.lo >= w.hi) w.hi = w.timed ? Math.max(period, w.lo) : Infinity
  } else {
    fitScale(w, false, still)
    return
  }
  if (!fitScale(w, true, still)) restartWindow(w)
}

/** A display frame of the auto controller began, `gap` ms after the last: the image drawn before it
 *  (`fresh`) is measured, and the window judged once `PERIOD` frames passed. */
function judgeFrame(p: ScaleParts, image: DrawnImage, fresh: boolean) {
  const { w, refresh } = p,
    gap = refresh.gap,
    period = refresh.display
  if (refresh.settled && !(Math.abs(period - w.at) <= GRID_TOLERANCE * w.at)) {
    w.at = period
    forgetThreshold(w, refresh.display)
  }
  const measured = fresh && image.steered && refresh.settled && gap < INTERVAL_PAUSE_MS
  if (measured && !w.timed) sampleCost(w, w.s * w.s)
  // A still image's interval is no verdict: the loop draws it when its feedback lands
  // (`frameScheduler.ts`), not at the GPU's pace.
  if (measured && !image.still && w.frames >= PERIOD) {
    w.moving++
    // The costs a miss is judged on arrive after it: its image's GPU time comes late.
    if (Math.round(gap / period) > 1 && w.misses++ === 0) clearCosts(w)
  }
  if (++w.frames <= PERIOD || w.count === 0) return
  settleWindow(w, refresh, image.still)
}

/**
 * A frame of the display began at `now`, ms, its rAF timestamp; `timed`: the device has a GPU
 * timer. The refresh is measured; the interval since the last frame, where the image before it
 * moved at the controller's scale, says whether it missed the refresh; past `PERIOD` frames
 * since the last move, the window's verdict (`settleWindow`).
 */
export function tickScale(p: ScaleParts, image: DrawnImage, now: number, timed: boolean) {
  const { w, refresh } = p,
    gpu = timed && w.images - w.timedAt < HISTORY,
    moved = displayMoved(p.display)
  if (moved) {
    p.targets.lift()
    w.max = w.bounds.max
    refresh.reset()
  }
  refresh.tick(now)
  const gap = refresh.gap
  if (gap > 0) readHeldInterval(w, refresh)
  if (moved) {
    w.timed = gpu
    forgetThreshold(w, refresh.display)
  } else if (gpu !== w.timed) {
    w.timed = gpu
    swapUnit(w, refresh.display)
  }
  if (!(gap > 0)) return
  // The image drawn before this display frame, read once whatever the bounds.
  const fresh = w.fresh
  w.fresh = false
  // A display frame began: another call in the same frame (gap 0) counts none.
  if (w.bounds.auto) judgeFrame(p, image, fresh)
}
