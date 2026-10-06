/** Frame intervals the refresh is measured over, at most, and the time they span: a period no
 *  interval of the last second stands for is gone (a window moved, a browser that slowed the
 *  page). An interval longer than `PAUSE_MS` is a pause, not a frame (under 10 fps). */
const REFRESH_WINDOW = 120,
  WINDOW_MS = 1000,
  PAUSE_MS = 100
/** Share of the period an interval may stray from a whole number of periods (timer jitter), and
 *  the shortest period sought: no display refreshes faster than 500 Hz. */
export const GRID_TOLERANCE = 0.1
const SHORTEST_PERIOD_MS = 2
/** A timer rounded to whole milliseconds (Safari, a page not cross-origin isolated) strays by up
 *  to this much, 8 or 9 ms at 120 Hz; a period under this many roundings is not sought, since
 *  its grid would then cover almost any interval. */
const COARSE_MS = 1,
  COARSE_PERIODS = 4
/** Intervals that must sit together for their value to be a period — a lone late or early frame
 *  is none —, and the share of the window a period must hold on its grid. */
export const SUPPORT = 3
const ON_GRID = 0.9

/** How far an interval may stray from a whole number of `period`s, a timer rounded to
 *  `resolution` ms. */
const slack = (period: number, resolution: number) => Math.max(GRID_TOLERANCE * period, resolution)

/**
 * The period the first `length` ascending `gaps` hold, near `period`: where nine in ten of them are
 * a whole number of it, the one that fits them best (their sum over the refreshes they span), which
 * a rounded timer's 8 and 9 ms bring back to 8.33; NaN otherwise. A wrong period stops at its
 * first misses past the tenth, so a window no grid holds costs little.
 */
function fit(gaps: Float64Array, length: number, period: number, resolution: number) {
  const tolerance = slack(period, resolution)
  let misses = (1 - ON_GRID) * length,
    time = 0,
    refreshes = 0
  for (let i = 0; i < length; i++) {
    const n = Math.max(1, Math.round(gaps[i] / period))
    if (Math.abs(gaps[i] - n * period) <= tolerance) {
      time += gaps[i]
      refreshes += n
    } else if (--misses < 0) return Number.NaN
  }
  return time / refreshes
}

/** Writes into `into.cadence` the period of the first `length` ascending `gaps`: from the shortest
 *  group of `SUPPORT` intervals within the tolerance of each other, its median over the smallest
 *  divisor whose grid holds the window; the next group where none does. False where no group
 *  gives one. A number written in a field, never returned: a call boxes the number it returns. */
function gridPeriod(
  gaps: Float64Array,
  length: number,
  resolution: number,
  into: { cadence: number },
) {
  const shortest = Math.max(SHORTEST_PERIOD_MS, COARSE_PERIODS * resolution)
  for (let i = 0, j = 0; i < length; i = j) {
    while (j < length && gaps[j] <= gaps[i] + slack(gaps[i], resolution)) j++
    if (j - i < SUPPORT) continue
    const base = gaps[(i + j - 1) >> 1]
    for (let k = 1; base / k >= shortest; k++) {
      const period = fit(gaps, length, base / k, resolution)
      if (!Number.isNaN(period)) {
        into.cadence = period
        return true
      }
    }
  }
  return false
}

/**
 * The display's refresh interval, measured on the vsync grid rAF timestamps land on: the
 * longest period nine in ten of the last second's frame intervals are a whole number of, from a
 * value several of them share. A frame that met the cadence gives it exactly; a device that never
 * meets it still does, from its missed frames — at 16 fps on a 120 Hz display its frames take 7
 * and 8 refreshes, 58.3 and 66.7 ms, whose grid is 8.3 ms —, so slow frames never pass for a slow
 * display. A lone late frame sets nothing. The whole window is searched again at every frame: that
 * period is the cadence, which rises once the shorter intervals are a second old.
 *
 * The refresh is not the cadence: every interval is a whole number of refreshes, so the
 * refresh is at most the shortest period the display was seen to hold, and a cadence of two
 * refreshes — a page whose frames the GPU holds that long — says nothing of a slower display. The
 * refresh falls at once to a shorter cadence, follows one within the tolerance, and holds above a
 * longer one. A steady cadence of two refreshes from the first frame is read as the display's,
 * there being no shorter period yet: the frames held to measure it draw nothing (`scaleControl.ts`).
 * `fallback` until a period is found.
 *
 * The window is kept sorted as it moves — the intervals past a second or past `REFRESH_WINDOW`
 * taken out, the new one put in its place —, so a frame sorts nothing and allocates nothing. The
 * timestamps only move forward (rAF, the document timeline, `performance.now()`): an interval
 * past a second never comes back, and the oldest is the one that ended first.
 */
export function createRefreshClock(fallback: number) {
  /** The window's intervals, ascending, the first `count`, and when each ended. */
  const gaps = new Float64Array(REFRESH_WINDOW),
    ends = new Float64Array(REFRESH_WINDOW),
    /** The last frame's timestamp and the timer's rounding — whole milliseconds until a
     *  timestamp shows a fraction —, ms. */
    at = { last: Number.NaN, resolution: COARSE_MS }
  let count = 0
  /** What the clock reads, as fields its readers load in place: a number read through a getter
   *  or a return is boxed anew at each read. */
  const clock = {
    /** The display's refresh interval, ms: the fallback until a period is found, never raised by
     *  a cadence the frames hold — what the page reads as the display's refresh. */
    display: fallback,
    /** The period the last second's intervals hold, ms: NaN until one is found. */
    cadence: Number.NaN,
    /** The interval from the frame before the last `tick` to it, ms: NaN after the first. */
    gap: Number.NaN,
    /** Whether a period was found since the clock began or was reset. */
    settled: false,
    /** Another display: the window restarts, the refresh held until a new one is found. */
    reset() {
      at.last = Number.NaN
      count = 0
      clock.cadence = Number.NaN
      clock.settled = false
    },
    /** A frame began at `now`, ms (the rAF timestamp); `gap` the interval since the last. */
    tick(now: number) {
      const gap = (clock.gap = now - at.last)
      at.last = now
      if (now % 1 !== 0) at.resolution = 0
      if (!(gap > 0 && gap < PAUSE_MS)) return
      // Out: the intervals that ended a second ago or more, then, the window full, the oldest.
      let n = 0,
        oldest = -1
      for (let i = 0; i < count; i++)
        if (ends[i] > now - WINDOW_MS) {
          gaps[n] = gaps[i]
          ends[n] = ends[i]
          if (oldest < 0 || ends[n] < ends[oldest]) oldest = n
          n++
        }
      if (n === REFRESH_WINDOW) {
        n--
        gaps.copyWithin(oldest, oldest + 1, REFRESH_WINDOW)
        ends.copyWithin(oldest, oldest + 1, REFRESH_WINDOW)
      }
      // In: the new interval, after the ones not longer.
      let i = n
      for (; i > 0 && gaps[i - 1] > gap; i--) {
        gaps[i] = gaps[i - 1]
        ends[i] = ends[i - 1]
      }
      gaps[i] = gap
      ends[i] = now
      count = n + 1
      if (!gridPeriod(gaps, count, at.resolution, clock)) return
      if (!clock.settled || clock.cadence <= (1 + GRID_TOLERANCE) * clock.display)
        clock.display = clock.cadence
      clock.settled = true
    },
  }
  // Read-only to its readers: only `tick` and `reset` write it.
  return clock as Readonly<typeof clock>
}
