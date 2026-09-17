import { MAX_BUDGET_PIXEL_ERROR } from './webgpuPagesHelpers.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Counts what the frame asks the cache for, and moves the page budget's error floor. A cut wider than
 * the GPU page budget is coarsened, never truncated: truncating a DAG cut punches holes, while a
 * coarser threshold is still an exact partition of the surface.
 *
 * The count comes from the set the previous image left, moved by the pages that entered and left it:
 * no image rebuilds the requested set, whatever the cut is worth. Opaque and transparent clusters
 * are one cut and one budget, so coarsening moves both together instead of starving one.
 */
export function admitGpuCut(rt: WebgpuPagesRuntime, pixelError: number, budgeted: number) {
  const { run, services } = rt,
    { slots } = rt.setup;
  // Ce que l'image demande au cache : la différence de la coupe l'a posé au moment de l'adopter.
  const requested = services.residencySets.requestedCount;
  const wasLimited = run.coverageBudgetLimited;
  run.coverageBudgetLimited = requested > slots;
  // Coarsen until the wanted cut fits, and relax again once it fits with room to spare. Doubling
  // and halving with a gap between the two thresholds keeps the loop from oscillating every frame.
  if (run.coverageBudgetLimited)
    run.budgetPixelError = Math.min(
      MAX_BUDGET_PIXEL_ERROR,
      run.budgetPixelError > 0 ? run.budgetPixelError * 2 : Math.max(1, pixelError * 2),
    );
  else if (run.budgetPixelError > 0 && requested < slots * 0.7)
    run.budgetPixelError = run.budgetPixelError > pixelError * 2 ? run.budgetPixelError / 2 : 0;
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
