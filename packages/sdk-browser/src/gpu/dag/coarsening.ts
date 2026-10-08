import { clamp } from '../../../../math/src/scalar/reals.ts'

/** The share of the list a raised cut aims to fill: the law may err by a factor 2 before it
 *  overflows again. */
const COARSE_FILL = 1 / 2
/** The coarsest factor: under the law it divides the ranks by 2³², so a cut still past the list
 *  there is made of its roots and cell stand-ins alone, which no threshold coarsens further. */
const COARSEST = 2 ** 16
/** A view whose cut asks more or less than this share of what it asked at its factor's first
 *  fitting cut has clearly changed: its own threshold is tried again. */
const CHANGED = 1 / 8
/** The images a still coarsened view waits before it tries its own threshold again, the first
 *  time, and at most: each try that overflows doubles the wait. */
const FIRST_WAIT = 64,
  LAST_WAIT = 4096

/**
 * What a view's factor follows: the factor its projected-error threshold is cut under; the list
 * it was set for; what the first cut that fitted under it asked (0: none yet); what its own
 * threshold last asked when it overflowed (`Infinity`: not counted); the images left before its
 * own threshold is tried again, and the wait it was given; whether the cut in flight is such a try.
 */
export type Coarsening = {
  factor: number
  cap: number
  held: number
  over: number
  wait: number
  period: number
  probing: boolean
}

/** A view's factor before its first readout: its own threshold. */
export const createCoarsening = (): Coarsening => ({
  factor: 1,
  cap: 0,
  held: 0,
  over: Infinity,
  wait: 0,
  period: FIRST_WAIT,
  probing: false,
})

/** The view cuts its next image under its own threshold; `probing`: a try a still view waited for. */
function tryOwn(c: Coarsening, probing: boolean) {
  Object.assign(c, { factor: 1, held: 0, probing })
  return true
}

/**
 * THE FACTOR A VIEW'S THRESHOLD IS CUT UNDER, past what one binding lists, after a readout cut
 * under `c.factor` that asked `demand` ranks (`listCap.ts`, `listDemand`, counted past the list)
 * of a list of `cap`; `past`: it overflowed a list that cannot grow (`grownListCap`). True when
 * the factor moved.
 *
 * A cut at threshold τ keeps clusters of about τ² pixels, so its ranks follow D(f) = D(1)/f² under
 * τ·f: past, the factor rises to where the cut fills `COARSE_FILL` of the list — √2 at least,
 * `COARSEST` at most —, and an overflow of the view's own threshold keeps its exact ask (`over`).
 * Only an overflow raises it. The way down cannot trust the law — the levels are steps —, so the
 * view tries its own threshold again: at once when it clearly changed (`CHANGED`), or when its
 * own ask, scaled as its ask at the factor moved, would fit; and, still, after a wait
 * (`coarsenTick`) that each try which overflows doubles, from `FIRST_WAIT` to `LAST_WAIT` images.
 * A try that overflows is never adopted and raises the factor back: one cut more per wait at
 * most, and no image after image flips. A list grown since releases the factor. Below the
 * device's list the factor stays 1: the view's own threshold.
 */
export function coarsenAfter(c: Coarsening, demand: number, cap: number, past: boolean) {
  const f = c.factor,
    grown = c.cap > 0 && cap > c.cap
  c.cap = cap
  if (grown) {
    c.period = FIRST_WAIT
    return tryOwn(c, false) && f !== 1
  }
  if (past) {
    c.over = f === 1 ? demand : Infinity
    c.period = c.probing ? Math.min(LAST_WAIT, 2 * c.period) : FIRST_WAIT
    Object.assign(c, { probing: false, held: 0, wait: c.period })
    c.factor = clamp(f * Math.sqrt(demand / (COARSE_FILL * cap)), f * Math.SQRT2, COARSEST)
    return c.factor !== f
  }
  if (f === 1) {
    // The view's own threshold fits: the next coarsening waits from the start.
    if (c.probing) Object.assign(c, { probing: false, period: FIRST_WAIT })
    return false
  }
  if (!c.held) {
    c.held = demand
    return false
  }
  if (Math.abs(demand - c.held) > CHANGED * c.held) {
    c.period = FIRST_WAIT
    return tryOwn(c, false)
  }
  return (c.over * demand) / c.held <= cap && tryOwn(c, true)
}

/** One image of the view: true when its wait ran out and its next cut tries its own threshold —
 *  the caller cuts again; never below the device's list, where the factor is 1. */
export function coarsenTick(c: Coarsening) {
  if (c.factor === 1 || --c.wait > 0) return false
  return tryOwn(c, true)
}
