import { clamp } from '../../../../math/src/scalar/reals.ts'

/** The frames kept: 16, enough to smooth a GPU time's noise, few enough to follow a new view. */
const HISTORY_SIZE = 16
/** Frame n − 1's weight against frame n's: 0.9, the newest frames count most. */
const FRAME_WEIGHT_EXPONENT = 0.9
/** The fewest frames between two changes, 8, which keeps the temporal upsampling's jitter from
 *  interfering. */
const CHANGE_PERIOD = 8
/** How far a rise goes at once: 0.9, a rise is cautious, a drop is not. */
const INCREASE_AMORTIZATION = 0.9
/** Frames in a row over the budget past which the older ones no longer count: 2. */
const MAX_OVER_BUDGET = 2

/** The budgets the heuristic fits, by their place in its history: the render scale, and the cut's
 *  edge scale (`cutEdgeScaleBudgetMs`, `../../../../sdk-core/src/contracts/cutOptions.ts`). */
export const RENDER_SCALE = 0
export const EDGE_SCALE = 1

/**
 * What differs from one budget to the next: `quadratic`, whether its GPU time scales with the
 * square of its fraction — the render scale, a fraction of each axis — or with the fraction itself
 * — the edge scale, the cut's screen error —; `headroom`, the share of the budget left free, the
 * margin for a frame's noise; `threshold`, the change under which a fraction does not move, which
 * would cost the history a resample for no visible gain; `panics`, whether a history all over its
 * budget moves every fraction at once, whatever the change period — the render scale's alone does.
 */
const MODELS = [
  { quadratic: true, headroom: 0.1, threshold: 0.02, panics: true },
  { quadratic: false, headroom: 0.05, threshold: 0.01, panics: false },
] as const
const BUDGETS = MODELS.length

/**
 * The dynamic resolution heuristic: one history and one change period for a list of budgets
 * (`MODELS`), each fitted to its own GPU time.
 *
 * Each GPU time arrives with the fraction its image was drawn at, for each budget (`recordFrame`):
 * a ring of `HISTORY_SIZE` frames. After each one (`refreshFraction`, called per GPU frame time
 * read back) the heuristic browses them from the newest, each suggesting `fraction · ratio`, the
 * ratio `target / gpuMs` — its square root for a quadratic model —, the target the budget less its
 * headroom, weighed by `FRAME_WEIGHT_EXPONENT` per frame back, and stops after `MAX_OVER_BUDGET`
 * frames in a row over the budget. When the newest frames were all over budget, the history is
 * forgotten (the over-budget panic); else a change under the budget's threshold is none and a rise
 * goes `INCREASE_AMORTIZATION` of the way. Each fraction is clamped to its bounds. The fractions
 * change together, at most every `CHANGE_PERIOD` refreshes, a panic of a budget that `panics`
 * excepted — it forgets its history and moves them at once. Both directions, whatever the image
 * shows: nothing waits for the image to stand still. A time that is not positive is no timing: its
 * frame is skipped for that budget, which has none while it is not asked for.
 *
 * State in fields, the rings in typed arrays: a frame makes no object.
 */
export function createDynamicResolution() {
  return {
    /** Each budget's GPU times and the fractions they were drawn at, `HISTORY_SIZE` entries a
     *  budget, a budget's from `budget * HISTORY_SIZE`. */
    gpuMs: new Float64Array(BUDGETS * HISTORY_SIZE),
    fractions: new Float64Array(BUDGETS * HISTORY_SIZE),
    /** The newest entry, −1 before any. */
    newest: -1,
    /** The entries held, and each budget's own: one that panicked forgets its own alone. */
    size: 0,
    sizes: new Int32Array(BUDGETS),
    framesSinceChange: 0,
    /** GPU times still ignored after a reset: the next one may
     *  describe an image of before it. */
    ignore: 1,
    /** The frame time budget, ms: written by the controller,
     *  read in place. */
    budgetMs: Number.NaN,
    /** The fractions a refresh gives each budget, applied together, and whether it found a budget
     *  that `panics` all over its budget. */
    next: new Float64Array(BUDGETS),
    panicked: false,
  }
}

export type DynamicResolution = ReturnType<typeof createDynamicResolution>

/** What the heuristic moves: the render scale's fraction `s`, within the bounds, and the edge
 *  scale's `edge`, within `edgeMin` and 1, fitted while its budget `edgeBudgetMs` is above 0. */
interface Fraction {
  s: number
  bounds: { min: number; max: number }
  edge: number
  edgeBudgetMs: number
  edgeMin: number
}

/** The history is forgotten: every fraction back to 1, the next GPU time ignored, since it may
 *  describe an image drawn before the reset. */
export function resetDynamicResolution(h: DynamicResolution, f: Fraction) {
  h.newest = -1
  h.size = 0
  h.sizes.fill(0)
  h.framesSinceChange = 0
  h.ignore = 1
  f.s = 1
  f.edge = 1
}

/** A frame's GPU busy time, `gpuMs`, drawn at `fraction`, and the time of the edge scale's passes,
 *  `edgeMs` — not a number where they were not timed —, drawn at `edge`, into the history; the
 *  frames after a reset ignored. */
export function recordFrame(
  h: DynamicResolution,
  gpuMs: number,
  fraction: number,
  edgeMs = Number.NaN,
  edge = 1,
) {
  if (h.ignore > 0) {
    h.ignore--
    return
  }
  h.newest = (h.newest + 1) % HISTORY_SIZE
  h.gpuMs[RENDER_SCALE * HISTORY_SIZE + h.newest] = gpuMs
  h.fractions[RENDER_SCALE * HISTORY_SIZE + h.newest] = fraction
  h.gpuMs[EDGE_SCALE * HISTORY_SIZE + h.newest] = edgeMs
  h.fractions[EDGE_SCALE * HISTORY_SIZE + h.newest] = edge
  h.size = Math.min(h.size + 1, HISTORY_SIZE)
  for (let b = 0; b < BUDGETS; b++) h.sizes[b] = Math.min(h.sizes[b] + 1, HISTORY_SIZE)
}

/** Budget `b`'s fraction after the history, written to `h.next[b]`: the one it has where the history
 *  holds none or it is not asked for, within its bounds. A GPU time that is not positive is no
 *  timing and is skipped; a budget that `panics` and whose newest times were all over its budget
 *  forgets the history (`h.panicked`). Fields only: a frame boxes no number. */
function fitBudget(h: DynamicResolution, f: Fraction, b: number, canChange: boolean) {
  const render = b === RENDER_SCALE,
    model = MODELS[b],
    budgetMs = render ? h.budgetMs : f.edgeBudgetMs,
    current = render ? f.s : f.edge,
    size = Math.min(h.size, h.sizes[b])
  h.next[b] = current
  // The render scale is always fitted, another budget while it is asked for.
  if (size === 0 || (!render && !(budgetMs > 0))) return
  const min = render ? f.bounds.min : f.edgeMin,
    max = render ? f.bounds.max : 1,
    target = budgetMs * (1 - model.headroom)
  let sum = 0,
    total = 0,
    weight = 1,
    over = 0,
    count = 0
  for (let back = 0; back < size; back++) {
    const at = b * HISTORY_SIZE + ((h.newest - back + HISTORY_SIZE) % HISTORY_SIZE),
      ms = h.gpuMs[at]
    if (!(ms > 0)) continue
    if (ms > budgetMs) over++
    else over = 0
    const ratio = target / ms
    sum += (model.quadratic ? Math.sqrt(ratio) : ratio) * h.fractions[at] * weight
    total += weight
    count++
    weight *= FRAME_WEIGHT_EXPONENT
    if (over === MAX_OVER_BUDGET) break
  }
  let next = current
  if (count > 0) {
    next = sum / total
    if (over === count) {
      h.sizes[b] = 0
      if (model.panics) {
        h.size = 0
        h.panicked = true
      }
    } else {
      const enough =
        canChange &&
        (next > current * (1 + model.threshold) ||
          next < current * (1 - model.threshold) ||
          (next !== current && (next === min || next === max)))
      if (!enough) next = current
      if (next > current) next = current + (next - current) * INCREASE_AMORTIZATION
    }
  }
  h.next[b] = clamp(next, min, max)
}

/** The fractions of the next frame written into `f.s` and `f.edge`, on the frame time budget
 *  `h.budgetMs` and `f.edgeBudgetMs`; whether one changed. The render scale last: its panic
 *  forgets the history (`h.size`) at the next refresh, and the other budgets browse their own
 *  entries, at least the newest, before and after it. Numbers read from fields and written to
 *  fields: a frame boxes none. */
export function refreshFraction(h: DynamicResolution, f: Fraction) {
  const canChange = h.framesSinceChange >= CHANGE_PERIOD
  h.panicked = false
  fitBudget(h, f, EDGE_SCALE, canChange)
  fitBudget(h, f, RENDER_SCALE, canChange)
  const worth = h.next[EDGE_SCALE] !== f.edge || h.next[RENDER_SCALE] !== f.s
  if ((worth && canChange) || h.panicked) {
    h.framesSinceChange = 0
    f.s = h.next[RENDER_SCALE]
    f.edge = h.next[EDGE_SCALE]
    return worth
  }
  h.framesSinceChange++
  return false
}
