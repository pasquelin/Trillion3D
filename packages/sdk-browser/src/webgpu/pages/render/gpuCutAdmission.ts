import { coverageBudgetEvent } from '../../../diagnostic/engineDiagnostic.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/**
 * Counts what the frame asks the cache for against the GPU page budget, and says when the verdict
 * changes. It never moves the threshold: the cut stays the host's, and what does not fit stays out
 * of the cache — its surface is drawn by its nearest resident ancestor, which the cache keeps
 * (`../../../page/cut/rule.ts`). Residency does the coarsening.
 *
 * The count comes from the set the previous image left, moved by the pages that entered and left it:
 * no image rebuilds the requested set, whatever the cut is worth.
 */
export function admitGpuCut(rt: WebgpuPagesRuntime) {
  const { run, services } = rt,
    { slots } = rt.setup;
  const sample = run.gpuSelection?.peek();
  if (!sample) return;
  // What the image asks the cache, and what it holds — root cover, cut and drawn ancestors.
  const { requestedCount: requested, keepCount } = services.residencySets;
  const wasLimited = run.coverageBudgetLimited;
  run.coverageBudgetLimited = requested > slots || keepCount > slots;
  if (wasLimited !== run.coverageBudgetLimited)
    run.coverageBudgetEvent = coverageBudgetEvent(
      run.coverageBudgetLimited,
      requested,
      slots,
      rt.services.bootstrapState.ready,
      sample.uniforms.pixelError,
    );
}
