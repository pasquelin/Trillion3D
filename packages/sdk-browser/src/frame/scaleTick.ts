import { resetFrameCap, type FrameCap } from './cadence.ts'
import { samePeriod, type createRefreshClock } from './refreshClock.ts'
import { displayMoved, HISTORY } from './scaleTargets.ts'
import type { createScaleMemory } from './scaleMemory.ts'
import { forgetHistory, type ScaleWindow } from './scaleWindow.ts'

/** What a tick reads and moves: the controller's state, the display's clock and size, the
 *  render targets' memory cap and the frame cap (`cadence.ts`). */
export interface ScaleParts {
  w: ScaleWindow
  refresh: ReturnType<typeof createRefreshClock>
  display: { width: number; height: number; ratio: number }
  memory: ReturnType<typeof createScaleMemory>
  cap: FrameCap
}

/**
 * A frame of the display the loop draws began at `now`, ms, its rAF timestamp; `timed`: the device
 * has a GPU timer. The refresh is measured; another display or refresh reads the frame cap again
 * and forgets the dynamic resolution's history. A timer silent for `HISTORY` images is none: the
 * dynamic resolution has nothing to record, its history forgotten and its fraction back to 1 —
 * the frame drawn at the bounds' maximum, since without a cost to fit there is no reason to draw
 * below it.
 */
export function tickScale(p: ScaleParts, now: number, timed: boolean) {
  const { w, refresh, cap } = p,
    moved = displayMoved(p.display)
  if (moved) {
    p.memory.uncap()
    refresh.reset()
  }
  refresh.tick(now)
  const period = refresh.display
  if (moved || (refresh.settled && !samePeriod(period, w.at))) {
    w.at = refresh.settled ? period : Number.NaN
    resetFrameCap(cap, period)
    forgetHistory(w)
  }
  const gpu = timed && w.images - w.timedAt < HISTORY
  if (w.timed && !gpu) forgetHistory(w)
  w.timed = gpu
  // A display frame began: another call in the same frame (gap 0) moves nothing.
  if (!(refresh.gap > 0)) return
  w.holding = false
  cap.drawnAt = now
}
