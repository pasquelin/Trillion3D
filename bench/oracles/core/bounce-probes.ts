// Oracle of `packages/sdk-core/src/proxy/budget.ts`'s probe half, rewritten according to the contract: the batch is the ceiling
// times the fraction, rounded, never zero; the fraction follows, via exponential smoothing, what the
// share leaves the probes — the share less the reflection trace's measured time, never past the
// probes' own part of it (`probeShare`) nor under the floor's —, bounded between its floor and one,
// and does not move on a missing, zero, or non-finite sample. Constants come from the contract so
// that the oracle does not silently drift.
import { BOUNCE_SETTINGS } from '../../../packages/sdk-core/src/bounce/contracts.ts'
import { clamp } from '../../../packages/math/src/scalar/reals.ts'

export function referenceBounceBatch(ceiling: number, load: number) {
  return Math.max(1, Math.round(ceiling * load))
}

/** The fields `referenceBudgetSequence` reproduces from `createProxyBudget`'s `ProxyBudget`. */
export interface ReferenceBudget {
  readonly load: number
  readonly lastMs: number | null
  readonly samples: number
  observe(reflectionMs: number | null, ms: number | null): void
}

/** Same shape as `createProxyBudget`'s probe half: a budget that observes and publishes its three fields. */
export function referenceBudgetSequence(budgetMs: number): ReferenceBudget {
  const { budgetSmoothing, budgetFloor, probeShare } = BOUNCE_SETTINGS
  const measured = (ms: number | null): ms is number => ms !== null && Number.isFinite(ms) && ms > 0
  const state: { load: number; lastMs: number | null; samples: number } = {
    load: 1,
    lastMs: null,
    samples: 0,
  }
  return {
    get load() {
      return state.load
    },
    get lastMs() {
      return state.lastMs
    },
    get samples() {
      return state.samples
    },
    observe(reflectionMs, ms) {
      if (!measured(ms)) return
      state.lastMs = ms
      state.samples++
      const spent = measured(reflectionMs) ? reflectionMs : 0
      const left = Math.max(
        Math.min(budgetMs - spent, budgetMs * probeShare),
        budgetMs * budgetFloor,
      )
      const voulue = clamp((state.load * left) / ms, budgetFloor, 1)
      state.load = clamp(state.load + (voulue - state.load) * budgetSmoothing, budgetFloor, 1)
    },
  }
}
