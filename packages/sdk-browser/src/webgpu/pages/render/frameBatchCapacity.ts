import { MAX_SHADOW_PAGES } from '../../../gpu/shadow/atlas.ts';
import { lightCutOf } from '../../../gpu/dag/selection.ts';
import { shadowBatchCapacity } from '../../../gpu/shadow/batchBudget.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/**
 * Light views one batch draws in: under the GPU cut, what its light cut runs at once without
 * dropping work (`../../../gpu/dag/lightCutRedraws.ts`); under the CPU cut, as many as its pages.
 */
function batchViews(rt: WebgpuPagesRuntime) {
  const { run } = rt;
  const light = run.gpuFrameActive && run.gpuSelection ? lightCutOf(run.gpuSelection) : undefined;
  return light ? light.redraws.limit.value : MAX_SHADOW_PAGES;
}

/** The views a batch of this frame runs, the batches it may draw and the staging they take, from
 *  the current pool, those views and the device's buffer limit (`shadowBatchCapacity`). */
export function frameBatchCapacity(rt: WebgpuPagesRuntime) {
  const views = batchViews(rt),
    maxBufferSize = rt.gpu.device?.limits.maxBufferSize ?? Infinity;
  return { views, ...shadowBatchCapacity(rt.lights.plan.pool.pages, views, maxBufferSize) };
}
