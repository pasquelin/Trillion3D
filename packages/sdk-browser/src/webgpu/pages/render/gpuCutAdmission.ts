import { releasePassedFloor, stepPageBudgetLadder } from '../../residency/budgetState.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/**
 * Counts what the frame asks the cache for, and moves the page budget's error floor by the ladder
 * both engines share (`stepPageBudgetLadder`).
 *
 * The count comes from the set the previous image left, moved by the pages that entered and left it:
 * no image rebuilds the requested set, whatever the cut is worth. Opaque and transparent clusters
 * are one cut and one budget, so coarsening moves both together instead of starving one.
 *
 * The count the frame reads is the readback of a cut sampled several frames earlier, so the ladder
 * moves only on a sample cut at the floor in force. The sample carries the threshold it was
 * dispatched at: an adaptive host threshold that moves every frame is not what the floor is matched
 * on.
 */
export function admitGpuCut(rt: WebgpuPagesRuntime, pixelError: number) {
  const { run, services } = rt,
    { slots } = rt.setup;
  releasePassedFloor(run, pixelError);
  const sample = run.gpuSelection?.peek();
  if (!sample) return;
  // The threshold the sample was cut at: the floor when one rules, the host's otherwise.
  const sampled = sample.uniforms.pixelError;
  // What the image asks the cache: the cut's delta posted it at the moment of adopting.
  const { requestedCount: requested, keepCount } = services.residencySets;
  const wasLimited = run.coverageBudgetLimited;
  const view = run.gate.revisions.view;
  stepPageBudgetLadder(run, pixelError, sampled, view, slots, requested, keepCount);
  if (wasLimited !== run.coverageBudgetLimited)
    run.coverageBudgetEvent = {
      version: 1,
      limited: run.coverageBudgetLimited,
      requiredSlots: requested,
      slots,
      fallbackRetained: rt.services.bootstrapState.ready,
      pixelError: sampled,
    };
}
