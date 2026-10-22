import { clamp } from '../../../../math/src/scalar/reals.ts'
import type { DYNAMIC_RESOLUTION_RULES } from '../../../../sdk-core/src/contracts/dynamicResolutionOptions.ts'
import type { SettingValues } from '../../../../sdk-core/src/contracts/settingRules.ts'

/** The budgets the heuristic fits, by their place in its history: the render scale, and the cut's
 *  edge scale (`cutEdgeScaleBudgetMs`, `../../../../sdk-core/src/contracts/cutOptions.ts`). */
export const RENDER_SCALE = 0
export const EDGE_SCALE = 1
const BUDGETS = 2

/** A GPU time that is negative is no timing yet: its frame is skipped for that budget. A time of
 *  0 is one, and asks for the most a fraction may be. */
export const NO_TIMING = -1

/** The edge scale's own record, which no setting of the heuristic reaches: its GPU time scales
 *  with the fraction itself, not its square; 5 % of its budget is left free; a change under 1 % is
 *  none; a rise goes 0.9 of the way; its panic waits for the change period. */
const EDGE_HEADROOM = 0.05,
  EDGE_THRESHOLD = 0.01,
  EDGE_AMORTIZATION = 0.9

/** The settings the heuristic reads of the render scale's budget, resolved
 *  (`../../../../sdk-core/src/contracts/dynamicResolutionOptions.ts`). */
export type DynamicResolutionValues = SettingValues<typeof DYNAMIC_RESOLUTION_RULES>

/** The frames in a row over the budget past which the older ones no longer count: no lower than 2. */
const MIN_OVER_BUDGET = 2

/**
 * The dynamic resolution heuristic: one history and one change period for a list of budgets, each
 * fitted to its own GPU time. The render scale is the first, its settings the host's
 * (`DynamicResolutionValues`); the cut's edge scale the second (`EDGE_HEADROOM`, `EDGE_THRESHOLD`,
 * `EDGE_AMORTIZATION`).
 *
 * Each GPU time arrives with the fraction its image was drawn at, for the render scale, and the
 * fraction in force for the edge scale (`recordFrame`): a ring of `dynamicResolutionHistorySize`
 * frames, each with the CPU time of the engine's last image. After each one (`refreshFraction`,
 * called per GPU frame time read back) the heuristic browses them from the newest, each
 * suggesting `fraction · ratio`, the ratio `target / gpuMs` — its square root for the render
 * scale, whose time scales with the square of its fraction —, the target the budget less its
 * headroom, weighed by `dynamicResolutionFrameWeightExponent` per frame back, and stops after
 * `dynamicResolutionMaxOverBudgetFrames` (at least 2) frames in a row over the budget. When the
 * newest frames were all over budget, the history is forgotten (the over-budget panic); else a
 * change under the budget's threshold is none and a rise goes the amortization's share of the way.
 * Each fraction is clamped to its bounds, the render scale's to its throttling maximum too. The
 * fractions change together, at most every `dynamicResolutionChangePeriod` refreshes, a panic of
 * the render scale excepted — it forgets its history and moves them at once. Both directions,
 * whatever the image shows: nothing waits for the image to stand still.
 *
 * State in fields, the rings in typed arrays: a frame makes no object.
 */
export function createDynamicResolution(capacity = 16) {
  return {
    /** The frames a budget's ring holds: `dynamicResolutionHistorySize`. */
    capacity,
    /** Each budget's GPU times and the fractions they were drawn at, `capacity` entries a budget,
     *  a budget's from `budget * capacity`; the CPU time of each entry's frame. */
    gpuMs: new Float64Array(BUDGETS * capacity),
    fractions: new Float64Array(BUDGETS * capacity),
    cpuMs: new Float64Array(capacity),
    /** The newest entry, −1 before any. */
    newest: -1,
    /** The entries held, and each budget's own: one that panicked forgets its own alone. */
    size: 0,
    sizes: new Int32Array(BUDGETS),
    framesSinceChange: 0,
    /** GPU times still ignored after a reset: the next one may
     *  describe an image of before it. */
    ignore: 1,
    /** The render scale's budget, ms: written by the controller, read in place. */
    budgetMs: Number.NaN,
    /** The fractions a refresh gives each budget, applied together; whether it found the render
     *  scale all over its budget; the weights of the browse in hand (sum, total, frames over,
     *  frames counted). */
    next: new Float64Array(BUDGETS),
    panicked: false,
    weighed: new Float64Array(4),
  }
}

export type DynamicResolution = ReturnType<typeof createDynamicResolution>

/** What the heuristic reads and moves: the render scale's fraction `s`, within the bounds, and the
 *  edge scale's `edge`, within `edgeMin` and 1, fitted while its budget `edgeBudgetMs` is above 0;
 *  the settings, and the CPU time of the engine's last image. */
interface Fraction {
  s: number
  bounds: { min: number; max: number }
  edge: number
  edgeBudgetMs: number
  edgeMin: number
  rules: DynamicResolutionValues
  cpuMs: number
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

/** The rings hold `capacity` frames: the newest kept, in their order. */
function resizeHistory(h: DynamicResolution, capacity: number) {
  const { capacity: before } = h,
    kept = Math.min(h.size, capacity),
    gpuMs = new Float64Array(BUDGETS * capacity),
    fractions = new Float64Array(BUDGETS * capacity),
    cpuMs = new Float64Array(capacity)
  for (let i = 0; i < kept; i++) {
    const was = (h.newest - i + before) % before,
      now = kept - 1 - i
    cpuMs[now] = h.cpuMs[was]
    for (let b = 0; b < BUDGETS; b++) {
      gpuMs[b * capacity + now] = h.gpuMs[b * before + was]
      fractions[b * capacity + now] = h.fractions[b * before + was]
    }
  }
  Object.assign(h, { capacity, gpuMs, fractions, cpuMs, newest: kept - 1, size: kept })
  for (let b = 0; b < BUDGETS; b++) h.sizes[b] = Math.min(h.sizes[b], kept)
}

/** A frame's GPU busy time, `gpuMs`, drawn at `fraction`, and the time of the edge scale's passes,
 *  `edgeMs` — `NO_TIMING` where they were not timed —, at the edge fraction now, with the CPU time
 *  of the engine's last image, into the history; the frames after a reset ignored. */
export function recordFrame(
  h: DynamicResolution,
  f: Fraction,
  gpuMs: number,
  fraction: number,
  edgeMs = NO_TIMING,
) {
  if (h.ignore > 0) {
    h.ignore--
    return
  }
  const capacity = f.rules.dynamicResolutionHistorySize
  if (capacity !== h.capacity) resizeHistory(h, capacity)
  const at = (h.newest = (h.newest + 1) % capacity)
  h.gpuMs[RENDER_SCALE * capacity + at] = gpuMs
  h.fractions[RENDER_SCALE * capacity + at] = fraction
  h.gpuMs[EDGE_SCALE * capacity + at] = edgeMs
  h.fractions[EDGE_SCALE * capacity + at] = f.edge
  h.cpuMs[at] = f.cpuMs
  h.size = Math.min(h.size + 1, capacity)
  for (let b = 0; b < BUDGETS; b++) h.sizes[b] = Math.min(h.sizes[b] + 1, capacity)
}

/** The newest `size` entries of budget `b`, browsed from the newest, weighed into `h.weighed`:
 *  the sum of their suggestions, the sum of their weights, the frames over the budget in a row
 *  and the frames counted. A frame the CPU alone made late is not over budget when the settings
 *  say so. */
function weigh(h: DynamicResolution, f: Fraction, b: number, size: number) {
  const { rules } = f,
    render = b === RENDER_SCALE,
    budgetMs = render ? h.budgetMs : f.edgeBudgetMs,
    headroom = render ? rules.dynamicResolutionHeadroomPercent / 100 : EDGE_HEADROOM,
    target = budgetMs * (1 - headroom),
    cpuLate = h.budgetMs * (1 - rules.dynamicResolutionHeadroomPercent / 100),
    last = Math.max(rules.dynamicResolutionMaxOverBudgetFrames, MIN_OVER_BUDGET)
  let sum = 0,
    total = 0,
    weight = 1,
    over = 0,
    count = 0
  for (let back = 0; back < size; back++) {
    const slot = (h.newest - back + h.capacity) % h.capacity,
      ms = h.gpuMs[b * h.capacity + slot]
    if (ms < 0) continue
    const cpu = h.cpuMs[slot],
      cpuBound = rules.dynamicResolutionUseCpuTimeLogic && (cpu > h.budgetMs || cpu > cpuLate)
    if (!cpuBound && ms > budgetMs) over++
    else over = 0
    const ratio = target / ms
    sum += (render ? Math.sqrt(ratio) : ratio) * h.fractions[b * h.capacity + slot] * weight
    total += weight
    count++
    weight *= rules.dynamicResolutionFrameWeightExponent
    if (over === last) break
  }
  h.weighed[0] = sum
  h.weighed[1] = total
  h.weighed[2] = over
  h.weighed[3] = count
}

/** Budget `b`'s fraction after the history, written to `h.next[b]`: the one it has where the history
 *  holds none or it is not asked for, within its bounds. A budget that `panics` and whose newest
 *  times were all over its budget forgets the history (`h.panicked`). Fields only: a frame boxes
 *  no number. */
function fitBudget(h: DynamicResolution, f: Fraction, b: number, canChange: boolean) {
  const render = b === RENDER_SCALE,
    { rules } = f,
    budgetMs = render ? h.budgetMs : f.edgeBudgetMs,
    current = render ? f.s : f.edge,
    size = Math.min(h.size, h.sizes[b])
  h.next[b] = current
  // The render scale is always fitted, another budget while it is asked for.
  if (size === 0 || (!render && !(budgetMs > 0))) return
  weigh(h, f, b, size)
  const { weighed } = h,
    sum = weighed[0],
    total = weighed[1],
    over = weighed[2],
    count = weighed[3],
    min = render ? f.bounds.min : f.edgeMin,
    max = render ? f.bounds.max : 1,
    throttle = rules.dynamicResolutionThrottlingMaxPercent / 100,
    top = render && throttle > 0 ? clamp(throttle, min, max) : max
  let next = current
  if (count > 0) {
    next = sum / total
    if (over === count) {
      h.sizes[b] = 0
      if (render) {
        h.size = 0
        h.panicked = true
      }
    } else {
      const threshold = render
          ? rules.dynamicResolutionChangePercentThreshold / 100
          : EDGE_THRESHOLD,
        enough =
          threshold === 0 ||
          (canChange &&
            (next > current * (1 + threshold) ||
              next < current * (1 - threshold) ||
              (next !== current && (next === min || next === max))))
      if (!enough) next = current
      if (next > current) {
        const share = render ? rules.dynamicResolutionIncreaseAmortization : EDGE_AMORTIZATION
        next = current + (next - current) * share
      }
    }
  }
  h.next[b] = clamp(next, min, top)
}

/** The fractions of the next frame written into `f.s` and `f.edge`, on the frame time budget
 *  `h.budgetMs` and `f.edgeBudgetMs`; whether one changed. The render scale last: its panic
 *  forgets the history (`h.size`) at the next refresh, and the other budgets browse their own
 *  entries, at least the newest, before and after it. Numbers read from fields and written to
 *  fields: a frame boxes none. */
export function refreshFraction(h: DynamicResolution, f: Fraction) {
  const canChange = h.framesSinceChange >= f.rules.dynamicResolutionChangePeriod
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
