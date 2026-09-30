/** Frame intervals the refresh is measured over, at most, and the time they span: a period no
 *  interval of the last second stands for is gone (a window moved, a browser that slowed the
 *  page). An interval longer than `PAUSE_MS` is a pause, not a frame (under 10 fps). */
const REFRESH_WINDOW = 120,
  WINDOW_MS = 1000,
  PAUSE_MS = 100;
/** Share of the period an interval may stray from a whole number of periods (timer jitter), and
 *  the shortest period sought: no display refreshes faster than 500 Hz. */
const GRID_TOLERANCE = 0.1,
  SHORTEST_PERIOD_MS = 2;
/** Intervals that must sit together for their value to be a period — a lone late or early frame
 *  is none —, and the share of the window a period must hold on its grid. */
const SUPPORT = 3,
  ON_GRID = 0.9;

/** Whether `gap` is a whole number of `period`s, within the tolerance. */
export function onGrid(gap: number, period: number) {
  const n = Math.max(1, Math.round(gap / period));
  return Math.abs(gap - n * period) <= GRID_TOLERANCE * period;
}

/** Whether nine in ten of the ascending `gaps` are a whole number of `period`s. */
function holds(gaps: Float64Array, period: number) {
  let on = 0;
  for (let i = 0; i < gaps.length; i++) if (onGrid(gaps[i], period)) on++;
  return on >= ON_GRID * gaps.length;
}

/** The period of the ascending `gaps`: from the shortest group of `SUPPORT` intervals within the
 *  tolerance of each other, its median over the smallest divisor whose grid holds the window;
 *  the next group where none does. Null where no group gives one. */
function gridPeriod(gaps: Float64Array) {
  for (let i = 0, j = 0; i < gaps.length; i = j) {
    while (j < gaps.length && gaps[j] <= gaps[i] * (1 + GRID_TOLERANCE)) j++;
    if (j - i < SUPPORT) continue;
    const base = gaps[(i + j - 1) >> 1];
    for (let k = 1; base / k >= SHORTEST_PERIOD_MS; k++) if (holds(gaps, base / k)) return base / k;
  }
  return null;
}

/**
 * The display's refresh interval, measured on the vsync grid rAF timestamps land on (#1343): the
 * longest period nine in ten of the last second's frame intervals are a whole number of, from a
 * value several of them share. A frame that met the cadence gives it exactly; a device that never
 * meets it still does, from its missed frames — at 16 fps on a 120 Hz display its frames take 7
 * and 8 refreshes, 58.3 and 66.7 ms, whose grid is 8.3 ms —, so slow frames never pass for a slow
 * display. A lone late frame sets nothing. The whole window is searched again at every frame, so
 * the period also rises once the shorter intervals are a second old. A steady cadence of two
 * refreshes from the first frame is read as the display's: `cadenceProbe.ts` tells them apart.
 * `fallback` until a period is found.
 */
export function createRefreshClock(fallback: number) {
  const gaps = new Float64Array(REFRESH_WINDOW),
    ends = new Float64Array(REFRESH_WINDOW),
    live = new Float64Array(REFRESH_WINDOW);
  let last = Number.NaN,
    next = 0,
    count = 0,
    interval = fallback,
    settled = false;
  return {
    /** The measured interval, ms. */
    get interval() {
      return interval;
    },
    /** Whether a period was found since the clock began or was reset. */
    get settled() {
      return settled;
    },
    /** Another display: the window restarts, the interval held until a new one is found. */
    reset() {
      last = Number.NaN;
      next = count = 0;
      settled = false;
    },
    /** A frame began at `now`, ms (the rAF timestamp); returns the interval since the last. */
    tick(now: number) {
      const gap = now - last;
      last = now;
      if (!(gap > 0 && gap < PAUSE_MS)) return gap;
      gaps[next] = gap;
      ends[next] = now;
      next = (next + 1) % REFRESH_WINDOW;
      count = Math.min(count + 1, REFRESH_WINDOW);
      let n = 0;
      for (let i = 0; i < count; i++) if (ends[i] > now - WINDOW_MS) live[n++] = gaps[i];
      const period = gridPeriod(live.subarray(0, n).sort());
      if (period !== null) {
        interval = period;
        settled = true;
      }
      return gap;
    },
  };
}
