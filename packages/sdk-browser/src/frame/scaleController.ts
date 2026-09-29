/**
 * Dynamic resolution, after the reference's controller (`r.DynamicRes.*`): the render scale `s`
 * per display axis follows the whole-frame GPU time so the frame holds its budget, the display
 * refresh interval. Cost goes as `s²`, so the scale that meets the target `T` from a time `t` is
 * `s · √(T / t)`. The target keeps a tenth of headroom (`TargetedGPUHeadRoom`); a step is taken
 * only when it moves the scale by 5 % (`ChangePercentageThreshold`) and 30 frames passed since the
 * last (`MinResolutionChangePeriod`); the scale goes up only when the filtered time is under 80 %
 * of the target, a dead band against oscillation; a frame over 1.25 budgets drops at once
 * (`MaxConsecutiveOverbudgetGPUFrameCount` of one).
 */
interface ScaleController {
  /** The scale frames are drawn at, in `[min, max]`. */
  s: number;
  min: number;
  max: number;
  /** The frame budget, ms: the display's refresh interval. */
  budget: number;
  /** Filtered whole-frame GPU time, ms. */
  ema: number;
  /** Frames measured since the last change. */
  since: number;
}

/** Share of the budget the controller aims at, and of the target under which it may go up. */
const HEADROOM = 0.9,
  DEAD_BAND = 0.8;
/** Relative change below which no step is taken, and frames between two steps. */
const THRESHOLD = 0.05,
  PERIOD = 30;
/** A frame over this many budgets drops the scale at once. */
const PANIC = 1.25;
/** Weight of a new sample in the filtered time. */
const FILTER = 0.2;

/** A controller in `[min, max]`, starting at `max`, its filtered time on the target. */
export function createScaleController(min: number, max: number, budget: number): ScaleController {
  return { s: max, min, max, budget, ema: HEADROOM * budget, since: 0 };
}

/** One controller step; `gpuMs` = whole-frame GPU time of a frame drawn at the current scale. */
export function nextScale(c: ScaleController, gpuMs: number) {
  const target = HEADROOM * c.budget;
  c.ema += FILTER * (gpuMs - c.ema);
  c.since++;
  const panic = gpuMs > PANIC * c.budget,
    measured = panic ? gpuMs : c.ema;
  const wanted = Math.min(c.max, Math.max(c.min, c.s * Math.sqrt(target / measured)));
  const down = wanted < c.s,
    up = wanted > c.s && c.ema < DEAD_BAND * target;
  if (
    (panic && down) ||
    (Math.abs(wanted - c.s) >= THRESHOLD * c.s && c.since >= PERIOD && (down || up))
  ) {
    // The filtered time restarts from what the new scale is expected to cost, as `s²`.
    c.ema = measured * (wanted / c.s) ** 2;
    c.s = wanted;
    c.since = 0;
  }
  return c.s;
}

/** Frame intervals the refresh is measured over, and the ones read as a pause, not a frame. */
const REFRESH_WINDOW = 120,
  PAUSE_MS = 100;

/**
 * The display's refresh interval, measured: the shortest interval between two consecutive frames
 * over the last `REFRESH_WINDOW`, which a frame that met the display's cadence gives exactly. A
 * pause longer than `PAUSE_MS` is no frame interval. `fallback` until a frame was measured.
 */
export function createRefreshClock(fallback: number) {
  const intervals = new Float64Array(REFRESH_WINDOW).fill(Infinity);
  let last = Number.NaN,
    next = 0,
    interval = fallback;
  return {
    /** The measured interval, ms. */
    get interval() {
      return interval;
    },
    /** A frame began at `now`, ms. */
    tick(now: number) {
      const gap = now - last;
      last = now;
      if (!(gap > 0 && gap < PAUSE_MS)) return;
      intervals[next] = gap;
      next = (next + 1) % REFRESH_WINDOW;
      let shortest = Infinity;
      for (const value of intervals) shortest = Math.min(shortest, value);
      interval = shortest;
    },
  };
}
