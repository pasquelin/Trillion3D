import { BOUNCE_SETTINGS } from './contracts.ts';

/**
 * Bounce budget in milliseconds.
 *
 * The specification mandates a time duration, not a fixed ray count: frame rate stays constant,
 * while light converges progressively. The engine receives a target frame duration, measures GPU
 * timestamps from the bounce pass, and dynamically adjusts the fraction of workload encoded next.
 *
 * Adjustment is smoothed and bounded: the fraction never exceeds 1 (published ceilings remain
 * strict upper limits) and never drops below the floor (ensuring convergence progress).
 */
export interface BounceBudget {
  /** Fraction of work ceiling to encode: bounded between floor and 1. */
  readonly load: number;
  /** Last observed stage duration, or `null` until recorded. */
  readonly lastMs: number | null;
  /** Retained samples count. Zero means device does not support timestamp queries. */
  readonly samples: number;
  /** Target duration in milliseconds set by host. */
  readonly budgetMs: number;
  /** Records how long the stage took. */
  observe(ms: number | null): void;
}

/**
 * Work batch for a frame: fraction of published ceiling sustainable under budget, non-zero.
 */
export function bounceBatchOf(ceiling: number, load: number) {
  return Math.max(1, Math.round(ceiling * load));
}

/** Keeps the light-bounce work under a time budget, frame after frame. */
export function createBounceBudget(budgetMs: number): BounceBudget {
  const target = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : BOUNCE_SETTINGS.budgetMs;
  const { budgetSmoothing, budgetFloor } = BOUNCE_SETTINGS;
  /** Both loop bounds: never beyond published ceilings, never below the floor. */
  const bounded = (fraction: number) => Math.min(1, Math.max(budgetFloor, fraction));
  let load = 1,
    lastMs: number | null = null,
    samples = 0;
  return {
    get load() {
      return load;
    },
    get lastMs() {
      return lastMs;
    },
    get samples() {
      return samples;
    },
    budgetMs: target,
    observe(ms) {
      // Skipped passes, truncated queries or devices lacking timestamp support produce no data:
      // the fraction remains unchanged rather than reacting to an artificial zero.
      if (ms === null || !Number.isFinite(ms) || ms <= 0) return;
      lastMs = ms;
      samples++;
      const wanted = bounded((load * target) / ms);
      load = bounded(load + (wanted - load) * budgetSmoothing);
    },
  };
}
