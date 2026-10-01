import { RUN_WORDS } from './planLayout.ts';
import { planPipeline, planShared } from './plan.ts';

/**
 * Writes the runs of the sorted plan and returns their count.
 *
 * `out` belongs to the scene and is `RUN_WORDS` words per plan entry — the worst case — so nothing
 * is allocated per frame. `runs` and `first` resume it at a run boundary (`resliceBlendRuns`).
 */
export function buildBlendRuns(order: Uint32Array, out: Uint32Array, runs = 0, first = 0) {
  while (first < order.length) {
    const pipeline = planPipeline(order[first]);
    const shared = planShared(order[first]);
    // An entry extends the run when it sets the same pipeline AND carries the share bit: both are
    // in its low bits, and the plan is walked without ever following a rank. Its cull mode may
    // differ: the vertex stage reads it per instance.
    let end = first + 1;
    if (shared)
      while (end < order.length && planShared(order[end]) && planPipeline(order[end]) === pipeline)
        end++;
    const base = runs * RUN_WORDS;
    out[base] = first;
    out[base + 1] = end - first;
    runs++;
    first = end;
  }
  return runs;
}
