import { createRefreshClock, GRID_TOLERANCE, SUPPORT } from './refreshClock.ts';
import { renderScaleBounds, type RenderScale } from './renderScaleOption.ts';
import {
  createTargetCap,
  displayMoved,
  FALLBACK_REFRESH_MS,
  HEADROOM,
  HISTORY,
  INTERVAL_PAUSE_MS,
  PERIOD,
  THRESHOLD,
} from './scaleTargets.ts';

/** The span a frame may miss its refresh once in: one image a second shown two refreshes. */
const SECOND_MS = 1000;

/**
 * THE FRAME LOOP'S RENDER SCALE (#831): one controller, from what the display and the GPU say.
 *
 * - The display's refresh `R`, measured on the rAF timestamps (`refreshClock.ts`, `display`): the
 *   shortest period they were seen to hold. Work only stretches an interval, so that period is the
 *   display's once intervals no work stretched were seen: the interactive loop's first frames are
 *   held, drawing nothing, until `SUPPORT` held intervals in a row agree, the group the clock reads
 *   a period from (`measuring`, `hold`; `PERIOD` at most) — whatever explicit renders came before
 *   them, which always draw. A page heavy from its first frame, whose
 *   every other refresh reads half the display's rate, is measured on frames it did not draw.
 * - Each drawn image's GPU span, as the timer gives it, brought to the current scale by the area
 *   it covers — `t · (s / sᵢ)²`, the cost model of a render that scales with its pixel count. Without GPU times
 *   (no timer, or none of late: `HISTORY` images), an image's cost is its area `s²`, the same model.
 * - Each presented interval: a moving image shown two refreshes or more missed the refresh.
 *
 * A frame meets the refresh while its GPU cost is at most `τ = R − N`, `N` the share of the frame
 * the GPU timer does not see (compositing, the CPU, presentation): `τ` is measured, never assumed.
 * The controller knows it between two costs — `lo`, the largest the frames met the refresh at over
 * a second, at most one of them missing; `hi`, the smallest they missed it at, two or more of them
 * (at most `R` with GPU times: a frame costing a whole refresh on the GPU alone cannot meet it) —
 * and tries a tenth below `hi`, a headroom that keeps the target off the edge of misses, while `lo` is further, then their
 * midpoint until the move it asks is within the noise, and holds `lo`. A miss is judged on the GPU
 * times that arrive after it, its image's among them. A miss at a cost already met is not the GPU's
 * (the CPU, a hitch): it moves nothing, so a page that turns CPU-bound keeps its scale. Not
 * covered: a page CPU-bound from its first frame (nothing met, the misses lower `hi` to the
 * floor).
 *
 * The scale fits the second costliest image since its last move to the target — one image a
 * second may miss, a lone spike moves nothing — by the exact area ratio, `s · √(τ / c₂)`, clamped
 * to the bounds and the memory cap; a move waits `PERIOD` frames after the last, so one move's effect is seen before the next, and
 * is taken past the controller's threshold, a rise only past the noise too: half the measured
 * relative spread of the costs (a scale moves as the root of a cost). At the floor, a frame that
 * cannot meet the refresh keeps the floor: no slower budget raises the scale (#831).
 *
 * At rest: after a still image the scale only lowers (#1343), so a still average closes at one
 * size and the frame is held, encoding nothing (`hold.ts`).
 *
 * One per session. `floor`: the minimum of a page that names none.
 */
export function createScaleControl(option: RenderScale | undefined, floor?: number) {
  const refresh = createRefreshClock(FALLBACK_REFRESH_MS),
    display = { width: 0, height: 0, ratio: 0 };
  displayMoved(display);
  let bounds = renderScaleBounds(option, floor);
  const targets = createTargetCap(bounds.max);
  /** Fields of one object, stored in place: a closure's number is boxed at each write. `s` the
   *  scale, `max` under the memory cap; `lo`/`hi` the costs `τ` lies between, `trial` the one
   *  aimed at, `at` the refresh they were learnt on; the window since the last move: display
   *  frames, moving ones and misses past `PERIOD`, costs (count, mean, sum of squared
   *  deviations, the two largest); the images drawn and when the last time came; the frames the
   *  loop held to measure the refresh; whether costs are GPU times; an image drawn since the last
   *  display frame. */
  const w = {
    s: bounds.max,
    max: bounds.max,
    lo: 0,
    hi: Infinity,
    trial: Infinity,
    /** The bounds and trial of the other cost unit (GPU times, or areas without them), kept
     *  through a timer dropout; NaN: none learnt. */
    otherLo: Number.NaN,
    otherHi: Number.NaN,
    otherTrial: Number.NaN,
    at: Number.NaN,
    frames: 0,
    moving: 0,
    misses: 0,
    count: 0,
    mean: 0,
    m2: 0,
    first: 0,
    second: 0,
    images: 0,
    timedAt: 0,
    held: 0,
    /** The last display frame was held, the last held interval, and the held intervals in a row
     *  that agree with it; whether they made a group (`SUPPORT`): the refresh is measured. */
    holding: false,
    heldGap: Number.NaN,
    agreeing: 0,
    measured: false,
    timed: false,
    fresh: false,
  };
  /** The window's costs start again. */
  const clear = () => {
    w.count = w.mean = w.m2 = w.first = w.second = 0;
  };
  /** A window starts: nothing measured since the last move. */
  const restart = () => {
    w.frames = w.moving = w.misses = 0;
    clear();
  };
  /** The threshold of the current cost unit is known from nothing: `τ` at most the refresh with
   *  GPU times, unbounded in areas. */
  const unknown = () => {
    w.lo = 0;
    w.hi = w.timed ? refresh.display : Infinity;
    w.trial = HEADROOM * w.hi;
  };
  /** The threshold is known again from nothing, in both cost units: another display, refresh or
   *  bounds. */
  const forget = () => {
    unknown();
    w.otherLo = w.otherHi = w.otherTrial = Number.NaN;
    restart();
  };
  /** The costs change unit — the timer gave times again, or none for `HISTORY` images —: the
   *  bounds learnt in the other unit come back, those of this one are kept for its return. */
  const swapUnit = () => {
    const lo = w.otherLo,
      hi = w.otherHi,
      trial = w.otherTrial;
    w.otherLo = w.lo;
    w.otherHi = w.hi;
    w.otherTrial = w.trial;
    if (Number.isNaN(lo)) unknown();
    else {
      w.lo = lo;
      w.hi = hi;
      w.trial = trial;
    }
    restart();
  };
  /** A cost of an image, ms (or area), at the current scale. */
  const sample = (cost: number) => {
    w.count++;
    const d = cost - w.mean;
    w.mean += d / w.count;
    w.m2 += d * (cost - w.mean);
    if (cost > w.first) {
      w.second = w.first;
      w.first = cost;
    } else if (cost > w.second) w.second = cost;
  };
  /** The cost the scale fits: the second costliest of the window, or its one. */
  const fitted = () => (w.count > 1 ? w.second : w.first);
  /** The smallest relative rise of the scale: the threshold, or half the costs' relative spread. */
  const noise = () =>
    Math.max(
      THRESHOLD,
      w.count > 1 && w.mean > 0 ? Math.sqrt(w.m2 / (w.count - 1)) / (2 * w.mean) : 0,
    );
  /** The scale moves to fit the window's cost to `w.trial`; whether it moved. `learn`: a verdict
   *  on the trial was just given, and the next trial is chosen first. */
  const fit = (learn: boolean) => {
    const step = noise();
    if (learn) {
      const mid = (w.lo + w.hi) / 2;
      w.trial =
        w.lo < HEADROOM * w.hi ? HEADROOM * w.hi : mid > w.lo * (1 + step) ** 2 ? mid : w.lo;
    }
    const cost = fitted();
    const fits = w.s * Math.sqrt(w.trial / cost);
    let next = Math.min(w.max, Math.max(bounds.min, fits));
    if (control.still) next = Math.min(next, w.s);
    // A fit a bound clamps goes exactly to the bound, whatever the threshold: the threshold is
    // for the noise, and a scale 0.8 % from the floor would never reach it. Else a drop is taken
    // past the threshold — a cost over the target misses, however the costs spread, a scene that
    // turned heavier spreads them most — and a rise past the noise.
    const bound = fits <= bounds.min || fits >= w.max;
    if (!(bound ? next !== w.s : Math.abs(next / w.s - 1) > (next < w.s ? THRESHOLD : step)))
      return false;
    w.s = next;
    restart();
    return true;
  };
  const control = {
    get bounds() {
      return bounds;
    },
    /** The scale of the last image drawn: 1 before any. */
    drawn: 1,
    /** Whether the last image was drawn at the controller's scale, which its cost then measures. */
    steered: false,
    /** Whether the last image was a still one: the scale then only lowers. */
    still: false,
    /** The display's refresh interval the clock measured, ms; null until it found one. */
    get refreshMs() {
      return refresh.settled ? refresh.display : null;
    },
    /** Whether the interactive loop holds the display frame that began, drawing nothing, to
     *  measure the refresh on it (`hold`): its first frames, until `SUPPORT` held intervals in a
     *  row agree — four frames at the least —, `PERIOD` at most. */
    get measuring() {
      return bounds.auto && !w.measured && w.held < PERIOD;
    },
    /** Whether the display frame that began was held (`hold`): the loop asks the next at once. */
    get held() {
      return w.holding;
    },
    /** The interactive loop held the display frame that began (`measuring`): it draws nothing. */
    hold() {
      w.held++;
      w.holding = true;
    },
    /** The interval from the previous display frame `tick` read to the last, ms; null before two
     *  or after a pause. */
    get frameIntervalMs() {
      const gap = refresh.gap;
      return gap > 0 && gap < INTERVAL_PAUSE_MS ? gap : null;
    },
    /** Asks another scale: the controller restarts at the bounds' maximum, knowing nothing. */
    set(next: RenderScale | undefined) {
      bounds = renderScaleBounds(next, floor);
      targets.reset(bounds.max);
      w.s = w.max = bounds.max;
      forget();
    },
    /** The scale an image is drawn at: the controller's, or the fixed one. */
    wanted: () => (bounds.auto ? w.s : bounds.max),
    /** The scale the render targets of a `view` size are made at (`createTargetCap`). */
    allocated: (view = '') => targets.allocated(bounds.max, view),
    /** The GPU budget refused the targets of the `view` size: they are made one eighth below
     *  (`createTargetCap`), and the scale held there too — above it, an image the targets draw
     *  smaller is not one it measures (`drawFrameAt`). False at the bounds' minimum. */
    capMemory(view = '') {
      const below = targets.lower(bounds.min, view);
      if (Number.isNaN(below)) return false;
      w.max = below;
      if (w.s > below) {
        w.s = below;
        restart();
      }
      return true;
    },
    /** The room the cap stood for came back: the scale may grow to the bounds' maximum. */
    uncapMemory() {
      targets.lift();
      w.max = bounds.max;
    },
    /** Whether the targets are held below the bounds' maximum by the GPU budget. */
    get memoryCapped() {
      return targets.capped;
    },
    /** An image was drawn at `scale`; `steered`, at the controller's; `still`, a still one. */
    drew(scale: number, steered: boolean, still = false) {
      control.drawn = scale;
      control.steered = steered;
      control.still = still;
      w.fresh = true;
      w.images++;
    },
    /**
     * A frame of the display began at `now`, ms, its rAF timestamp; `timed`: the device has a GPU
     * timer. The refresh is measured; the interval since the last frame, where the image before it
     * moved at the controller's scale, says whether it missed the refresh; past `PERIOD` frames
     * since the last move, the window's verdict: two misses lower `hi`, a second with one at most
     * raises `lo`, either chooses the next trial; else the scale follows the scene's cost.
     */
    tick(now: number, timed = false) {
      const gpu = timed && w.images - w.timedAt < HISTORY,
        moved = displayMoved(display);
      if (moved) {
        targets.lift();
        w.max = bounds.max;
        refresh.reset();
      }
      refresh.tick(now);
      const gap = refresh.gap,
        period = refresh.display;
      // An interval after a held frame, nothing drawn in it, is no work's: `SUPPORT` of them in
      // a row that agree are a group the clock reads the display's period from.
      if (gap > 0) {
        const free = w.holding && !w.fresh,
          agrees = Math.abs(gap - w.heldGap) <= GRID_TOLERANCE * w.heldGap;
        w.agreeing = !free ? 0 : agrees ? w.agreeing + 1 : 1;
        w.heldGap = free ? gap : Number.NaN;
        if (w.agreeing >= SUPPORT) w.measured = true;
        w.holding = false;
      }
      if (moved) {
        w.timed = gpu;
        forget();
      } else if (gpu !== w.timed) {
        w.timed = gpu;
        swapUnit();
      }
      if (!(gap > 0)) return;
      // The image drawn before this display frame, read once whatever the bounds.
      const fresh = w.fresh;
      w.fresh = false;
      if (!bounds.auto) return;
      // A display frame began: another call in the same frame (gap 0) counts none.
      if (refresh.settled && !(Math.abs(period - w.at) <= GRID_TOLERANCE * w.at)) {
        w.at = period;
        forget();
      }
      const measured = fresh && control.steered && refresh.settled && gap < INTERVAL_PAUSE_MS;
      if (measured && !w.timed) sample(w.s * w.s);
      // A still image's interval is no verdict: the loop draws it when its feedback lands
      // (`frameScheduler.ts`), not at the GPU's pace.
      if (measured && !control.still && w.frames >= PERIOD) {
        w.moving++;
        // The costs a miss is judged on arrive after it: its image's GPU time comes late.
        if (Math.round(gap / period) > 1 && w.misses++ === 0) clear();
      }
      if (++w.frames <= PERIOD || w.count === 0) return;
      const cost = fitted();
      if (w.misses > 1) {
        if (w.count < 2) return;
        if (cost > w.lo) w.hi = Math.min(w.hi, cost);
      } else if (w.moving >= SECOND_MS / period) {
        w.lo = Math.max(w.lo, cost);
        // A second met above a cost that missed: that miss was not the GPU's.
        if (w.lo >= w.hi) w.hi = w.timed ? Math.max(period, w.lo) : Infinity;
      } else {
        fit(false);
        return;
      }
      if (!fit(true)) restart();
    },
    /**
     * The GPU time of an image drawn at `scale`, as it arrives, a few frames late: a cost of the
     * window, brought to the current scale by its area, where the image was drawn at the
     * controller's scale (`steered`).
     */
    observe(gpuMs: number | null, scale: unknown, steered = true) {
      if (gpuMs === null) return;
      w.timedAt = w.images;
      if (steered && w.timed && bounds.auto && typeof scale === 'number' && scale > 0)
        sample(gpuMs * (w.s / scale) ** 2);
    },
  };
  return control;
}

export type ScaleControl = ReturnType<typeof createScaleControl>;
