import { MAX_SHADOW_PAGES } from '../../../gpu/shadow/atlas.ts';
import { lightCutOf } from '../../../gpu/dag/selection.ts';
import { shadowBatchWrites } from '../../../gpu/shadow/batchWrites.ts';
import { MAX_SHADOW_BATCHES } from '../../../gpu/shadow/batchBudget.ts';
import { pageModes, writeShadowPages } from '../../shadow/pages.ts';
import { encodeShadowAtlas } from './encodeShadowPass.ts';
import { encodeShadowRequests } from '../../shadow/casters.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/**
 * Light views one batch draws in: under the GPU cut, what its light cut runs at once without
 * dropping work (`../../../gpu/dag/lightCutRedraws.ts`); under the CPU cut, as many as its pages.
 */
function batchViews(rt: WebgpuPagesRuntime) {
  const { run } = rt;
  const light = run.gpuFrameActive && run.gpuSelection ? lightCutOf(run.gpuSelection) : undefined;
  return light ? light.redraws.viewLimit : MAX_SHADOW_PAGES;
}

/**
 * Hands every batch of the frame's pages to `visit` — pages `[from, to)` of the plan's list, and
 * the runs of the batches before it —, in order, until it returns false. Returns where it stopped:
 * the frame's page count when every batch was visited.
 *
 * The pages up to the frame's budget (`admission.end`: every page at rest, a batch's pages
 * while the camera moves), in at most `MAX_SHADOW_BATCHES`: the largest pool's pages in full
 * batches, what the batches' memory is sized for (`../../../gpu/shadow/batchBudget.ts`); only a
 * view limit bisected after a light cut dropped work cuts batches short enough to need more. The
 * pages past the last are pending, drawn the next frame, the oldest first (`admit.ts`).
 */
export function forEachShadowBatch(
  rt: WebgpuPagesRuntime,
  visit: (from: number, to: number, runBase: number) => boolean,
) {
  const { plan, runs } = rt.lights,
    { admission } = plan,
    end = admission.end,
    views = batchViews(rt);
  let runBase = 0,
    from = 0;
  for (let batch = 0; from < end && batch < MAX_SHADOW_BATCHES; batch++) {
    const to = admission.batchEnd(from, Math.min(MAX_SHADOW_PAGES, end - from), views);
    if (!visit(from, to, runBase)) break;
    runBase += runs.count;
    from = to;
  }
  return from;
}

/**
 * THE FRAME'S SHADOW PAGES, AS MANY AS ITS BUDGET HOLDS. The plan lists every stale page the image
 * reads, the coarsest first (`admit.ts`); the per-batch buffers hold `MAX_SHADOW_PAGES` pages and
 * one light cut's views, so the list is drawn batch after batch in the frame's command buffer, each
 * batch's writes landing in command order (`../../../gpu/shadow/batchWrites.ts`), and each batch's
 * pages committed once encoded, up to the frame's budget (`forEachShadowBatch`). What the frame
 * does not draw — past its budget, or a batch that cannot be encoded, a resource missing — stays
 * stale, pending, for the next frame.
 *
 * Returns whether the whole list was drawn: never for a moving frame whose list passes its budget.
 */
export function encodeShadowBatches(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  eye: ArrayLike<number>,
) {
  const { lights } = rt,
    { plan } = lights,
    count = plan.admission.count,
    writes = shadowBatchWrites(device);
  let drawn: number;
  try {
    drawn = forEachShadowBatch(rt, (from, to, runBase) => {
      if (from) writes.stage(encoder);
      const regions = writeShadowPages(lights, eye, from, to);
      if (!encodeShadowAtlas(rt, device, encoder, regions, from, to, runBase)) return false;
      lights.shadowFaces += lights.runs.count;
      plan.commit(pageModes, from, to);
      return true;
    });
  } finally {
    writes.end();
    encodeShadowRequests(rt, encoder);
  }
  lights.shadowPages = drawn;
  if (drawn < count) plan.reissue(drawn);
  return drawn === count;
}
