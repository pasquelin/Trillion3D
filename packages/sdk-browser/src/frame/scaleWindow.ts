import type { RenderScaleBounds } from './renderScaleOption.ts';
import { HEADROOM, THRESHOLD } from './scaleTargets.ts';

/**
 * The state of the render scale controller (`scaleControl.ts`), fields of one object stored in
 * place: a closure's number is boxed at each write. `s` the scale, `max` under the memory cap;
 * `lo`/`hi` the costs `τ` lies between, `trial` the one aimed at, `at` the refresh they were learnt
 * on; the window since the last move: display frames, moving ones and misses past `PERIOD`, costs
 * (count, mean, sum of squared deviations, the two largest); the images drawn and when the last
 * time came; the frames the loop held to measure the refresh; whether costs are GPU times; an image
 * drawn since the last display frame.
 */
export function createScaleWindow(bounds: RenderScaleBounds) {
  return {
    bounds,
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
}

export type ScaleWindow = ReturnType<typeof createScaleWindow>;

/** The interactive loop held the display frame that began: it draws nothing. */
export function holdFrame(w: ScaleWindow) {
  w.held++;
  w.holding = true;
}

/** The window's costs start again. */
export function clearCosts(w: ScaleWindow) {
  w.count = w.mean = w.m2 = w.first = w.second = 0;
}

/** A window starts: nothing measured since the last move. */
export function restartWindow(w: ScaleWindow) {
  w.frames = w.moving = w.misses = 0;
  clearCosts(w);
}

/** The threshold of the current cost unit is known from nothing: `τ` at most the refresh with
 *  GPU times, unbounded in areas. */
function unknownThreshold(w: ScaleWindow, refreshMs: number) {
  w.lo = 0;
  w.hi = w.timed ? refreshMs : Infinity;
  w.trial = HEADROOM * w.hi;
}

/** The threshold is known again from nothing, in both cost units: another display, refresh or
 *  bounds. */
export function forgetThreshold(w: ScaleWindow, refreshMs: number) {
  unknownThreshold(w, refreshMs);
  w.otherLo = w.otherHi = w.otherTrial = Number.NaN;
  restartWindow(w);
}

/** The costs change unit — the timer gave times again, or none for `HISTORY` images —: the
 *  bounds learnt in the other unit come back, those of this one are kept for its return. */
export function swapUnit(w: ScaleWindow, refreshMs: number) {
  const lo = w.otherLo,
    hi = w.otherHi,
    trial = w.otherTrial;
  w.otherLo = w.lo;
  w.otherHi = w.hi;
  w.otherTrial = w.trial;
  if (Number.isNaN(lo)) unknownThreshold(w, refreshMs);
  else {
    w.lo = lo;
    w.hi = hi;
    w.trial = trial;
  }
  restartWindow(w);
}

/** A cost of an image, ms (or area), at the current scale. */
export function sampleCost(w: ScaleWindow, cost: number) {
  w.count++;
  const d = cost - w.mean;
  w.mean += d / w.count;
  w.m2 += d * (cost - w.mean);
  if (cost > w.first) {
    w.second = w.first;
    w.first = cost;
  } else if (cost > w.second) w.second = cost;
}

/** The cost the scale fits: the second costliest of the window, or its one. */
export const fittedCost = (w: ScaleWindow) => (w.count > 1 ? w.second : w.first);

/** The smallest relative rise of the scale: the threshold, or half the costs' relative spread. */
const noiseOf = (w: ScaleWindow) =>
  Math.max(
    THRESHOLD,
    w.count > 1 && w.mean > 0 ? Math.sqrt(w.m2 / (w.count - 1)) / (2 * w.mean) : 0,
  );

/** The scale moves to fit the window's cost to `w.trial`; whether it moved. `learn`: a verdict
 *  on the trial was just given, and the next trial is chosen first. `still`: the last image was a
 *  still one, the scale then only lowers. */
export function fitScale(w: ScaleWindow, learn: boolean, still: boolean) {
  const step = noiseOf(w);
  if (learn) {
    const mid = (w.lo + w.hi) / 2;
    w.trial = w.lo < HEADROOM * w.hi ? HEADROOM * w.hi : mid > w.lo * (1 + step) ** 2 ? mid : w.lo;
  }
  const cost = fittedCost(w);
  const fits = w.s * Math.sqrt(w.trial / cost);
  let next = Math.min(w.max, Math.max(w.bounds.min, fits));
  if (still) next = Math.min(next, w.s);
  // A fit a bound clamps goes exactly to the bound, whatever the threshold: the threshold is
  // for the noise, and a scale 0.8 % from the floor would never reach it. Else a drop is taken
  // past the threshold — a cost over the target misses, however the costs spread, a scene that
  // turned heavier spreads them most — and a rise past the noise.
  const bound = fits <= w.bounds.min || fits >= w.max;
  if (!(bound ? next !== w.s : Math.abs(next / w.s - 1) > (next < w.s ? THRESHOLD : step)))
    return false;
  w.s = next;
  restartWindow(w);
  return true;
}
