import { coverageBudgetEvent } from '../../diagnostic/engineDiagnostic.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * Counts what the frame asks the cache for against the GPU page budget, and says when the verdict
 * changes. It never moves the threshold: the cut stays the host's, and what does not fit stays out
 * of the cache — its surface is drawn by its nearest resident ancestor, which the cache keeps
 * (`../../geometry/cut/rule.ts`). Residency does the coarsening. The budget limits the image only
 * while it draws above the finest level: an image whose every cluster is a finest one has lost no
 * detail to it, whatever the cut asks of the pool beside them (their ancestors, which the closure
 * holds).
 *
 * The count comes from the set the previous image left, moved by the pages that entered and left it:
 * no image rebuilds the requested set, whatever the cut is worth.
 */
export function admitGpuCut(rt: WebgpuPagesRuntime) {
  const { run, services } = rt,
    { slots } = rt.setup
  // Before the first readback the image asks for the root cover alone: nothing to count yet.
  if (!run.gpuSelection?.peek()) return
  // What the image asks the cache, and what it holds — root cover, cut and drawn ancestors.
  const { requestedCount: requested, keepCount, drawnCoarse } = services.residencySets
  const wasLimited = run.coverageBudgetLimited
  run.coverageBudgetLimited = (requested > slots || keepCount > slots) && drawnCoarse > 0
  if (wasLimited !== run.coverageBudgetLimited)
    run.coverageBudgetEvent = coverageBudgetEvent(
      run.coverageBudgetLimited,
      requested,
      slots,
      rt.services.bootstrapState.ready,
      run.selectionUniforms.pixelError,
    )
}
