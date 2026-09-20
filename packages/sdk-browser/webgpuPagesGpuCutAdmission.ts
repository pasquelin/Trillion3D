import { MAX_BUDGET_PIXEL_ERROR } from './webgpuPagesHelpers.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Share of the slots under which a coarsened cut asks for the next finer threshold again. */
export const BUDGET_RELAX_RATIO = 0.7;
/** Finest rung of the budget ladder, in pixels: below it the cut is the one the host asked for. */
export const MIN_BUDGET_PIXEL_ERROR = 0.125;

/**
 * Counts what the frame asks the cache for, and moves the page budget's error floor. A cut wider than
 * the GPU page budget is coarsened, never truncated: truncating a DAG cut punches holes, while a
 * coarser threshold is still an exact partition of the surface.
 *
 * The count comes from the set the previous image left, moved by the pages that entered and left it:
 * no image rebuilds the requested set, whatever the cut is worth. Opaque and transparent clusters
 * are one cut and one budget, so coarsening moves both together instead of starving one.
 *
 * Two rules keep the floor from oscillating, since the count the frame reads is the readback of a
 * cut sampled several frames earlier:
 * - the floor moves only on a sample cut at the threshold the frame currently asks for. Between two
 *   samples the verdict is the previous one, and a step is never taken on the count of another
 *   threshold — doubling on a count the last doubling has already answered, or halving five times
 *   before the first halving has been seen;
 * - a threshold that overflowed the pool for this view is not asked for again while the view stays:
 *   relaxing to it would only reproduce the overflow, then the coarsening, every few frames. A view
 *   change forgets it, since another view may fit it.
 */
export function admitGpuCut(rt: WebgpuPagesRuntime, pixelError: number, budgeted: number) {
  const { run, services } = rt,
    { slots } = rt.setup;
  const sample = run.gpuSelection?.peek();
  if (!sample || sample.uniforms.pixelError !== budgeted) return;
  const view = run.gate.revisions.view;
  if (run.budgetOverflowView !== view) {
    run.budgetOverflowView = view;
    run.budgetOverflowError = -1;
  }
  // What the image asks the cache: the cut's delta posted it at the moment of adopting.
  const { requestedCount: requested, keepCount } = services.residencySets;
  const wasLimited = run.coverageBudgetLimited;
  // What the image holds — root coverage, cut and drawn ancestors — must fit in the slots the same
  // way the cut does: without that, ancestors holding the slots would wait for children that cannot
  // enter. The CPU cut applies the same rule.
  run.coverageBudgetLimited = requested > slots || keepCount > slots;
  // The ladder is the powers of two: a first overflow climbs to one pixel — or twice the host's
  // threshold —, every rung above doubles, and relaxing halves down to the finest rung, below
  // which the floor is given up.
  if (run.coverageBudgetLimited) {
    run.budgetOverflowError = budgeted;
    run.budgetPixelError = Math.min(
      MAX_BUDGET_PIXEL_ERROR,
      run.budgetPixelError > 0 ? run.budgetPixelError * 2 : Math.max(1, pixelError * 2),
    );
  } else if (run.budgetPixelError > 0 && requested < slots * BUDGET_RELAX_RATIO) {
    let next = run.budgetPixelError / 2;
    if (next <= pixelError || next < MIN_BUDGET_PIXEL_ERROR) next = 0;
    if (Math.max(pixelError, next) > run.budgetOverflowError) run.budgetPixelError = next;
  }
  if (wasLimited !== run.coverageBudgetLimited)
    run.coverageBudgetEvent = {
      version: 1,
      limited: run.coverageBudgetLimited,
      requiredSlots: requested,
      slots,
      fallbackRetained: rt.services.bootstrapState.ready,
      pixelError: budgeted,
    };
}
