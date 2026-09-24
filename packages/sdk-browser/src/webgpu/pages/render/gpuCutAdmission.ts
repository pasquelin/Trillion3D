import { MAX_BUDGET_PIXEL_ERROR } from '../helpers.ts';
import { coverageBudgetEvent } from '../../../diagnostic/engineDiagnostic.ts';
import { MIN_BUDGET_PIXEL_ERROR } from '../../../residency/pools.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** Share of the slots under which a coarsened cut asks for the next finer threshold again. */
export const BUDGET_RELAX_RATIO = 0.7;

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
 * - while a floor rules, it moves only on a sample cut at that floor. Between two samples the
 *   verdict is the previous one, and a step is never taken on the count of another threshold —
 *   doubling on a count the last doubling has already answered, or halving five times before the
 *   first halving has been seen. The sample carries the threshold it was dispatched at: an adaptive
 *   host threshold that moves every frame is not what the floor is matched on;
 * - a threshold whose REQUESTED cut overflowed the pool for this view is not asked for again while
 *   the view and the pool stay: relaxing to it would only reproduce the overflow, then the
 *   coarsening, every few frames. A view change or a pool resize forgets it, since either may fit
 *   it. What the image still draws from the previous cut is held with the requested one, and can
 *   overflow the slots for a few frames right after a coarsening: that transient coarsens once more
 *   but is not memorised, or a still camera would settle one rung too coarse.
 */
export function admitGpuCut(rt: WebgpuPagesRuntime, pixelError: number) {
  const { run, services } = rt,
    { slots } = rt.setup;
  // A floor the host's own threshold has passed no longer decides anything: it is given up, so
  // what is published is what the cut is drawn at.
  if (run.budgetPixelError > 0 && run.budgetPixelError <= pixelError) run.budgetPixelError = 0;
  const sample = run.gpuSelection?.peek();
  if (!sample) return;
  // The threshold the sample was cut at: the floor when one rules, the host's otherwise.
  const sampled = sample.uniforms.pixelError;
  if (run.budgetPixelError > 0 && sampled !== run.budgetPixelError) return;
  const view = run.gate.revisions.view;
  if (run.budgetOverflowView !== view || run.budgetOverflowSlots !== slots) {
    run.budgetOverflowView = view;
    run.budgetOverflowSlots = slots;
    run.budgetOverflowError = -1;
  }
  // What the image asks the cache: the cut's delta posted it at the moment of adopting.
  const { requestedCount: requested, keepCount } = services.residencySets;
  const wasLimited = run.coverageBudgetLimited;
  // What the image holds — root coverage, cut and drawn ancestors — must fit in the slots the same
  // way the cut does: without that, ancestors holding the slots would wait for children that cannot
  // enter. The CPU cut applies the same rule.
  run.coverageBudgetLimited = requested > slots || keepCount > slots;
  // The ladder doubles what the image was drawn at — one pixel at least on a first overflow —,
  // and relaxing halves down to the finest rung, below which the floor is given up.
  if (run.coverageBudgetLimited) {
    if (requested > slots) run.budgetOverflowError = sampled;
    run.budgetPixelError = Math.min(MAX_BUDGET_PIXEL_ERROR, Math.max(1, sampled * 2));
  } else if (run.budgetPixelError > 0 && requested < slots * BUDGET_RELAX_RATIO) {
    let next = run.budgetPixelError / 2;
    if (next <= pixelError || next < MIN_BUDGET_PIXEL_ERROR) next = 0;
    if (Math.max(pixelError, next) > run.budgetOverflowError) run.budgetPixelError = next;
  }
  if (wasLimited !== run.coverageBudgetLimited)
    run.coverageBudgetEvent = coverageBudgetEvent(
      run.coverageBudgetLimited,
      requested,
      slots,
      rt.services.bootstrapState.ready,
      sampled,
    );
}
