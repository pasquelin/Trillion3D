import { clamp } from '../../../math/src/scalar/reals.ts'

/** The frames kept: 16, enough to smooth a GPU time's noise, few enough to follow a new view. */
const HISTORY_SIZE = 16
/** Frame n − 1's weight against frame n's: 0.9, the newest frames count most. */
const FRAME_WEIGHT_EXPONENT = 0.9
/** The fewest frames between two changes, 8, which keeps the temporal upsampling's jitter from
 *  interfering. */
const CHANGE_PERIOD = 8
/** How far a rise goes at once: 0.9, a rise is cautious, a drop is not. */
const INCREASE_AMORTIZATION = 0.9
/** A change under 2 % is none: it would cost the history a resample for no visible gain. */
const CHANGE_THRESHOLD = 0.02
/** Frames in a row over the budget past which the older ones no longer count: 2. */
const MAX_OVER_BUDGET = 2
/** The share of the budget the heuristic leaves free, 10 %: the margin for a frame's noise. */
const TARGETED_HEADROOM = 0.1

/**
 * The dynamic resolution heuristic, a quadratic model: a frame's GPU time scales with the square
 * of its resolution fraction — here the render scale, a fraction of each axis.
 *
 * Each GPU time arrives with the scale its image was drawn at (`recordFrame`): a ring of
 * `HISTORY_SIZE` frames. After each one (`refreshFraction`, called per GPU frame time read back)
 * the heuristic browses them from the newest, each suggesting `fraction · √(target / gpuMs)`, the
 * target the budget less `TARGETED_HEADROOM`, weighed by `FRAME_WEIGHT_EXPONENT` per
 * frame back, and stops after `MAX_OVER_BUDGET` frames in a row over the budget. When the newest
 * frames were all over budget, the suggestion is taken at once and the history forgotten (the
 * over-budget panic); else a change under `CHANGE_THRESHOLD` is none
 * and a rise goes `INCREASE_AMORTIZATION` of the way. The fraction is clamped to the bounds and
 * changes at most every `CHANGE_PERIOD` refreshes, a panic excepted. Both directions, whatever the
 * image shows: nothing waits for the image to stand still.
 *
 * State in fields, the ring in typed arrays: a frame makes no object.
 */
export function createDynamicResolution() {
  return {
    gpuMs: new Float64Array(HISTORY_SIZE),
    fractions: new Float64Array(HISTORY_SIZE),
    /** The newest entry, −1 before any. */
    newest: -1,
    size: 0,
    framesSinceChange: 0,
    /** GPU times still ignored after a reset: the next one may
     *  describe an image of before it. */
    ignore: 1,
    /** The frame time budget, ms: written by the controller,
     *  read in place. */
    budgetMs: Number.NaN,
  }
}

export type DynamicResolution = ReturnType<typeof createDynamicResolution>

/** What the heuristic moves: the resolution fraction `s`, within the bounds. */
interface Fraction {
  s: number
  bounds: { min: number; max: number }
}

/** The history is forgotten: the fraction back to 1, the next GPU time ignored, since it may
 *  describe an image drawn before the reset. */
export function resetDynamicResolution(h: DynamicResolution, f: Fraction) {
  h.newest = -1
  h.size = 0
  h.framesSinceChange = 0
  h.ignore = 1
  f.s = 1
}

/** A frame's GPU busy time, `gpuMs`, drawn at `fraction`, into the history; the frames after a
 *  reset ignored. */
export function recordFrame(h: DynamicResolution, gpuMs: number, fraction: number) {
  if (h.ignore > 0) {
    h.ignore--
    return
  }
  h.newest = (h.newest + 1) % HISTORY_SIZE
  h.gpuMs[h.newest] = gpuMs
  h.fractions[h.newest] = fraction
  h.size = Math.min(h.size + 1, HISTORY_SIZE)
}

/** The resolution fraction of the next frame written into `f.s`, on the frame time budget
 *  `h.budgetMs`; whether it changed. A GPU time that is not positive is no timing and is
 *  skipped. Numbers read from fields and written to fields: a frame boxes none. */
export function refreshFraction(h: DynamicResolution, f: Fraction) {
  const budgetMs = h.budgetMs,
    canChange = h.framesSinceChange >= CHANGE_PERIOD,
    current = f.s,
    { min, max } = f.bounds
  let next = current,
    panic = false
  if (h.size > 0) {
    const target = budgetMs * (1 - TARGETED_HEADROOM)
    let sum = 0,
      total = 0,
      weight = 1,
      over = 0,
      count = 0
    for (let back = 0; back < h.size; back++) {
      const at = (h.newest - back + HISTORY_SIZE) % HISTORY_SIZE,
        ms = h.gpuMs[at]
      if (!(ms > 0)) continue
      if (ms > budgetMs) over++
      else over = 0
      sum += Math.sqrt(target / ms) * h.fractions[at] * weight
      total += weight
      count++
      weight *= FRAME_WEIGHT_EXPONENT
      if (over === MAX_OVER_BUDGET) break
    }
    if (count > 0) {
      next = sum / total
      panic = over === count
    }
    if (panic) h.size = 0
    else {
      const enough =
        canChange &&
        (next > current * (1 + CHANGE_THRESHOLD) ||
          next < current * (1 - CHANGE_THRESHOLD) ||
          (next !== current && (next === min || next === max)))
      if (!enough) next = current
      if (next > current) next = current + (next - current) * INCREASE_AMORTIZATION
    }
    next = clamp(next, min, max)
  }
  if ((next !== current && canChange) || panic) {
    h.framesSinceChange = 0
    f.s = next
    return next !== current
  }
  h.framesSinceChange++
  return false
}
