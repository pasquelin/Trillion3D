import { GRID_TOLERANCE } from '../../frame/refreshClock.ts'

/** Intervals in a row that must sit on the display's grid before a frame's time is put on it: one
 *  interval landing there by chance — a variable-refresh display presenting whenever a frame is
 *  ready — puts nothing on it. */
const RECENT = 3
/** A timer rounded to whole milliseconds strays by up to this much, until a timestamp shows a
 *  fraction: the refresh clock's own reading of the timer (`refreshClock.ts`). */
const COARSE_MS = 1

/**
 * THE WORLD'S TIME ON THE DISPLAY'S GRID. A frame's timestamp is when its display frame began, the
 * rAF timestamp the refresh clock measures the display on (`frameStart`), and an image is shown a
 * whole number of refreshes after the one before: motion advanced by the timestamps' own interval
 * carries their jitter into the image, and a delta that never repeats takes no animation sample
 * ahead (`animationAhead.ts`). So, while the display's refresh is known, a frame's time is
 * `t_n = start + round((now − start) / period) · period` and its delta `t_n − t_{n−1}`, a whole
 * number of periods computed as such — one period on time, two for a frame the display dropped —,
 * the same number bit for bit from frame to frame.
 *
 * The grid is trusted only where the display keeps it. `period` is the display's refresh the scale
 * control measured (`ScaleControl.refreshMs`, `refreshed`), never the budget's slower cadence: a
 * frame the GPU held two refreshes is two periods. A frame's time is put on the grid only while
 * that refresh is known, the last `RECENT` intervals were each a whole number of periods, and the
 * timestamp itself lies on the grid — each within the refresh clock's own tolerance
 * (`GRID_TOLERANCE` of the period, a millisecond on a rounded timer), the one that found the
 * period: what it counted as on the grid is on it here. That tolerance is far below what a
 * variable-refresh display presenting off the grid strays (an interval of 1.2 to 1.8 periods, a
 * cadence between two refreshes), and above the timestamps' own jitter, a few microseconds where
 * the timer is fine. Otherwise a frame takes its own timestamp, its delta the time since the last
 * frame's, and the grid starts again there.
 *
 * No drift: a frame's time is the grid's (`start` plus a whole number of periods, never a sum of
 * deltas) within the tolerance of its own timestamp, or that timestamp itself; a period measured a
 * hair off moves the timestamps off the grid, which then restarts at the frame's own time, its
 * delta taking the difference. The grid restarts likewise when the display changes or the clock
 * lost its refresh (`refreshed` with none), the refresh moves past the tolerance, or the loop was
 * paused (`restart`). A display frame read twice — a still frame whose step is taken again, a host
 * that draws twice in it — is no interval: its delta is 0 and its time stays.
 *
 * State in an object's fields, as the refresh clock keeps it: a number written there is stored in
 * place, never a new box a frame.
 */
export function createFrameGrid() {
  const s: GridState = {
    period: Number.NaN,
    refresh: Number.NaN,
    start: Number.NaN,
    steps: 0,
    seen: Number.NaN,
    run: 0,
    fine: false,
  }
  const grid = {
    /** The last frame's time, ms: on the grid while `snapped`, else its own timestamp. NaN
     *  before the first. */
    time: Number.NaN,
    /** The last frame's time less the one before it, ms: a whole number of periods while
     *  `snapped`; 0 for the first frame and for a display frame read again. */
    delta: 0,
    /** Whether the last frame's time is on the grid. */
    snapped: false,
    /** The display's refresh, ms, as the scale control measured it (`refreshMs`), after a frame;
     *  `null` when it knows none — a new display, a clock that lost its period. One that moved
     *  past the tolerance is a new grid; a hair's change is taken when the grid next restarts,
     *  so the period, and with it the delta, stays the same number while the grid holds. */
    refreshed(ms: number | null | undefined) {
      refreshed(s, ms)
    },
    /** A frame began at `now`, ms: its time and delta are written in `time` and `delta`. */
    frame(now: number) {
      frame(s, grid, now)
    },
    /** The loop was paused (a still scene it slept through, a hidden tab): the intervals before
     *  it are not recent, and the grid starts again at the last frame's own timestamp. */
    restart() {
      s.run = 0
      if (!Number.isNaN(s.seen)) anchor(s, grid, s.seen)
    },
  }
  return grid
}

/** What a grid keeps of the display between frames. */
type GridState = {
  /** The period the grid steps by, ms: NaN while no refresh is known. */
  period: number
  /** The display's refresh last published, ms: NaN when none is known. */
  refresh: number
  /** Where the grid starts, ms, and the steps from there to the last frame's time. */
  start: number
  steps: number
  /** The last frame's own timestamp, ms. */
  seen: number
  /** Intervals in a row on the grid. */
  run: number
  /** Whether a timestamp showed a fraction: the timer is not rounded to milliseconds. */
  fine: boolean
}

/** What a grid publishes of the last frame (`createFrameGrid`). */
type GridTime = { time: number; delta: number; snapped: boolean }

/** The grid starts again at the frame's own `now`, at the last refresh published. */
function anchor(s: GridState, grid: GridTime, now: number) {
  s.start = s.seen = grid.time = now
  s.steps = 0
  grid.snapped = false
  if (s.refresh > 0) s.period = s.refresh
}

function refreshed(s: GridState, ms: number | null | undefined) {
  s.refresh = ms != null && ms > 0 ? ms : Number.NaN
  if (!(s.refresh > 0)) {
    s.period = Number.NaN
    s.run = 0
  } else if (!(s.period > 0) || Math.abs(s.refresh - s.period) > GRID_TOLERANCE * s.period) {
    s.period = s.refresh
    s.run = 0
  }
}

function frame(s: GridState, grid: GridTime, now: number) {
  if (now % 1 !== 0) s.fine = true
  const last = grid.time,
    period = s.period
  if (Number.isNaN(last)) {
    anchor(s, grid, now)
    grid.delta = 0
    return
  }
  if (period > 0) {
    const tolerance = Math.max(GRID_TOLERANCE * period, s.fine ? 0 : COARSE_MS),
      gap = now - s.seen
    // The display frame read again: no time elapsed.
    if (Math.abs(gap) <= tolerance) {
      grid.delta = 0
      return
    }
    s.run = Math.abs(gap - Math.round(gap / period) * period) <= tolerance ? s.run + 1 : 0
    s.seen = now
    if (s.run >= RECENT) {
      const k = Math.round((now - s.start) / period),
        on = s.start + k * period
      if (k > s.steps && Math.abs(now - on) <= tolerance) {
        grid.delta = (k - s.steps) * period
        s.steps = k
        grid.time = on
        grid.snapped = true
        return
      }
    }
  }
  grid.delta = now - last
  anchor(s, grid, now)
}
