import { LIGHT_SETTINGS } from '../light/contracts.ts';

/**
 * Shadows-stage budget, in GPU milliseconds per frame (RX3, X4).
 *
 * The "four lights per frame" ceiling was a count, not a duration: four 1024² maps
 * cost thirty times four 128² pages. Here work is counted in pages and its price comes from
 * the pass's own timer — the timestamp sample the profile already publishes — smoothed from one
 * frame to the next. The fixed cost of a region (reject, clear to far, indirect call) is not
 * distinguished from the cost of a page: it is blended into the average, named approximation (P5).
 *
 * As long as no sample has come — device without timestamps, first frames — there is no
 * budget at all: only the region ceiling the buffers publish applies, which is
 * exactly the behaviour from before this batch.
 */
export function createShadowBudget() {
  let budgetMs: number = LIGHT_SETTINGS.shadowBudgetMs,
    msPerPage = 0,
    samples = 0,
    // The pose barrier drains the queue with no duration cap: the 1 ms budget is for the
    // measured loop. A GPU timestamp arriving during the drain tightened admission mid-flush,
    // and two runs left different pages (#25).
    suspended = false;
  return {
    get budgetMs() {
      return budgetMs;
    },
    /** Budget published by the host; a non-finite or negative value is rejected, not rounded. */
    setBudgetMs(value: number) {
      if (Number.isFinite(value) && value > 0) budgetMs = value;
    },
    /** Average cost of a page, in milliseconds, or `null` as long as nothing has been measured. */
    get msPerPage() {
      return samples ? msPerPage : null;
    },
    /** The next admission ignores the budget; the buffers' region cap still applies. */
    suspend() {
      suspended = true;
    },
    resume() {
      suspended = false;
    },
    /**
     * A sample of the pass timer, reported to the pages that frame had redrawn.
     * A frame with no redrawn page learns nothing and does not enter the average.
     */
    observe(gpuMs: number | null, pages: number) {
      if (gpuMs === null || !Number.isFinite(gpuMs) || gpuMs <= 0 || pages <= 0) return;
      const value = gpuMs / pages;
      msPerPage = samples
        ? msPerPage + (value - msPerPage) * LIGHT_SETTINGS.shadowCostBlend
        : value;
      samples++;
    },
    /** Estimated duration of `pages` pages, or `null` until a sample exists — and during a
     *  barrier, where the drain must not depend on the GPU clock. */
    estimate(pages: number) {
      return suspended || !samples ? null : msPerPage * pages;
    },
    reset() {
      msPerPage = 0;
      samples = 0;
      suspended = false;
    },
  };
}

export type ShadowBudget = ReturnType<typeof createShadowBudget>;
