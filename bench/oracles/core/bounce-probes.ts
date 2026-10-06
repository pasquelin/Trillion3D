// Oracle of `packages/sdk-core/src/bounce/budget.ts`, rewritten according to the contract: the batch is the ceiling times the fraction,
// rounded, never zero; the fraction follows the target via exponential smoothing, bounded between its
// floor and one, and does not move on a missing, zero, or non-finite sample. Constants come
// from the contract so that the oracle does not silently drift.
import { BOUNCE_SETTINGS } from '../../../packages/sdk-core/src/bounce/contracts.ts';

export function referenceBounceBatch(ceiling: number, load: number) {
  return Math.max(1, Math.round(ceiling * load));
}

/** The fields `referenceBudgetSequence` reproduces from `createBounceBudget`'s `BounceBudget`. */
export interface ReferenceBudget {
  readonly load: number;
  readonly lastMs: number | null;
  readonly samples: number;
  observe(ms: number | null): void;
}

/** Same shape as `createBounceBudget`: a budget that observes and publishes its three fields. */
export function referenceBudgetSequence(budgetMs: number): ReferenceBudget {
  const { budgetSmoothing, budgetFloor } = BOUNCE_SETTINGS;
  const bornee = (f: number) => Math.min(1, Math.max(budgetFloor, f));
  const state: { load: number; lastMs: number | null; samples: number } = {
    load: 1,
    lastMs: null,
    samples: 0,
  };
  return {
    get load() {
      return state.load;
    },
    get lastMs() {
      return state.lastMs;
    },
    get samples() {
      return state.samples;
    },
    observe(ms) {
      if (ms === null || !Number.isFinite(ms) || ms <= 0) return;
      state.lastMs = ms;
      state.samples++;
      const voulue = bornee((state.load * budgetMs) / ms);
      state.load = bornee(state.load + (voulue - state.load) * budgetSmoothing);
    },
  };
}
